import type { AgentRole, Phase, TaskStatus } from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';

export type NewTask = {
  /** Clé naturelle stable : rejouer l'insertion d'une même clé ne duplique pas la tâche (§8.3 idempotence). */
  key: string;
  phase: Phase;
  agentRole: AgentRole | 'local';
  label: string;
  input?: unknown;
  dependsOnKeys?: string[];
  priority?: number;
  maxAttempts?: number;
};

export type QueuedTask = {
  id: string;
  missionId: string;
  phase: Phase;
  agentRole: AgentRole | 'local';
  input: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/**
 * Interface abstraite de file de tâches (CdC §4.6 `QueueAdapter`).
 * Implémentation V1 : table SQLite `tasks` — aucune file en mémoire seule (§8.2).
 */
export interface QueueAdapter {
  enqueue(missionId: string, tasks: NewTask[]): void;
  promote(missionId: string): number;
  claim(missionId: string, limit: number, skipIds?: ReadonlySet<string>): QueuedTask[];
  heartbeat(taskId: string): void;
  complete(
    taskId: string,
    r: {
      output: unknown;
      costUsd: number;
      tokensIn: number;
      tokensOut: number;
      model: string | null;
    },
  ): boolean;
  fail(taskId: string, error: unknown): { retried: boolean };
  release(taskId: string): void;
  recoverOrphans(opts?: { all?: boolean }): number;
  retryFailed(missionId: string): number;
  counts(missionId: string): Record<TaskStatus, number>;
}

type Row = {
  id: string;
  mission_id: string;
  phase: Phase;
  agent_role: QueuedTask['agentRole'];
  input_json: string | null;
  attempts: number;
  max_attempts: number;
};

export class SqliteQueue implements QueueAdapter {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly leaseMs = 10 * 60_000,
  ) {}

  private iso(ms = this.now()): string {
    return new Date(ms).toISOString();
  }

  enqueue(missionId: string, tasks: NewTask[]): void {
    this.db.transaction(() => {
      const keyToId = new Map<string, string>();
      const existing = this.db
        .prepare('SELECT id, input_json FROM tasks WHERE mission_id = ?')
        .all(missionId) as { id: string; input_json: string | null }[];
      for (const e of existing) {
        const k = (JSON.parse(e.input_json ?? '{}') as { _key?: string })._key;
        if (k) keyToId.set(k, e.id);
      }
      const t = this.iso();
      for (const task of tasks) {
        if (keyToId.has(task.key)) continue; // idempotent
        const id = newId();
        keyToId.set(task.key, id);
        const deps = (task.dependsOnKeys ?? []).map((k) => {
          const dep = keyToId.get(k);
          if (!dep) throw new Error(`Dépendance inconnue : ${k}`);
          return dep;
        });
        this.db
          .prepare(
            `INSERT INTO tasks(id,mission_id,phase,agent_role,depends_on_json,status,priority,input_json,max_attempts,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            missionId,
            task.phase,
            task.agentRole,
            JSON.stringify(deps),
            deps.length ? 'pending' : 'ready',
            task.priority ?? 0,
            JSON.stringify({ ...(task.input as object), label: task.label, _key: task.key }),
            task.maxAttempts ?? 3,
            t,
            t,
          );
      }
    })();
  }

  /** `pending` → `ready` quand toutes les dépendances sont `done` ; `blocked` si une dépendance a échoué. */
  promote(missionId: string): number {
    return this.db.transaction(() => {
      const pending = this.db
        .prepare(
          "SELECT id, depends_on_json FROM tasks WHERE mission_id=? AND status IN ('pending','blocked')",
        )
        .all(missionId) as { id: string; depends_on_json: string }[];
      const status = new Map(
        (
          this.db.prepare('SELECT id, status FROM tasks WHERE mission_id=?').all(missionId) as {
            id: string;
            status: TaskStatus;
          }[]
        ).map((r) => [r.id, r.status]),
      );
      let n = 0;
      for (const p of pending) {
        const deps = JSON.parse(p.depends_on_json) as string[];
        const sts = deps.map((d) => status.get(d));
        const next: TaskStatus = sts.every((s) => s === 'done' || s === 'skipped')
          ? 'ready'
          : sts.some((s) => s === 'failed' || s === 'blocked')
            ? 'blocked'
            : 'pending';
        if (next !== (status.get(p.id) ?? 'pending')) {
          this.db
            .prepare('UPDATE tasks SET status=?, updated_at=? WHERE id=?')
            .run(next, this.iso(), p.id);
          if (next === 'ready') n++;
        }
      }
      return n;
    })();
  }

  /** Prend jusqu'à `limit` tâches `ready` (priorité, puis ancienneté) et pose un bail. */
  claim(missionId: string, limit: number, skipIds: ReadonlySet<string> = new Set()): QueuedTask[] {
    if (limit <= 0) return [];
    return this.db.transaction(() => {
      const rows = (
        this.db
          .prepare(
            `SELECT id, mission_id, phase, agent_role, input_json, attempts, max_attempts FROM tasks
           WHERE mission_id=? AND status='ready' ORDER BY priority DESC, created_at ASC, id ASC`,
          )
          .all(missionId) as Row[]
      )
        .filter((r) => !skipIds.has(r.id))
        .slice(0, limit);
      const t = this.iso();
      const lease = this.iso(this.now() + this.leaseMs);
      for (const r of rows) {
        this.db
          .prepare(
            `UPDATE tasks SET status='running', lease_until=?, started_at=COALESCE(started_at,?), updated_at=? WHERE id=?`,
          )
          .run(lease, t, t, r.id);
      }
      return rows.map((r) => ({
        id: r.id,
        missionId: r.mission_id,
        phase: r.phase,
        agentRole: r.agent_role,
        input: JSON.parse(r.input_json ?? '{}') as Record<string, unknown>,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
      }));
    })();
  }

  heartbeat(taskId: string): void {
    this.db
      .prepare("UPDATE tasks SET lease_until=?, updated_at=? WHERE id=? AND status='running'")
      .run(this.iso(this.now() + this.leaseMs), this.iso(), taskId);
  }

  /** Marque `done` seulement si la tâche est encore `running` (un rejeu tardif ne duplique rien). */
  complete(
    taskId: string,
    r: {
      output: unknown;
      costUsd: number;
      tokensIn: number;
      tokensOut: number;
      model: string | null;
    },
  ): boolean {
    const res = this.db
      .prepare(
        `UPDATE tasks SET status='done', output_json=?, cost_usd=cost_usd+?, tokens_in=tokens_in+?, tokens_out=tokens_out+?,
           model=?, lease_until=NULL, error_json=NULL, finished_at=?, updated_at=? WHERE id=? AND status='running'`,
      )
      .run(
        JSON.stringify(r.output),
        r.costUsd,
        r.tokensIn,
        r.tokensOut,
        r.model,
        this.iso(),
        this.iso(),
        taskId,
      );
    return res.changes === 1;
  }

  /** Échec imputable à la tâche : `attempts` +1 ; nouvel essai tant que `max_attempts` n'est pas atteint. */
  fail(taskId: string, error: unknown): { retried: boolean } {
    return this.db.transaction(() => {
      const r = this.db
        .prepare('SELECT attempts, max_attempts FROM tasks WHERE id=?')
        .get(taskId) as {
        attempts: number;
        max_attempts: number;
      };
      const attempts = r.attempts + 1;
      const retried = attempts < r.max_attempts;
      this.db
        .prepare(
          `UPDATE tasks SET attempts=?, status=?, lease_until=NULL, error_json=?, updated_at=?,
             finished_at = CASE WHEN ? THEN NULL ELSE ? END WHERE id=?`,
        )
        .run(
          attempts,
          retried ? 'ready' : 'failed',
          JSON.stringify(error),
          this.iso(),
          retried ? 1 : 0,
          this.iso(),
          taskId,
        );
      return { retried };
    })();
  }

  /** Remet la tâche en `ready` SANS incrémenter `attempts` (pause, crédit épuisé, réseau, arrêt). */
  release(taskId: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET status='ready', lease_until=NULL, updated_at=? WHERE id=? AND status='running'",
      )
      .run(this.iso(), taskId);
  }

  /**
   * Récupération des tâches orphelines (§8.2). Au démarrage du moteur (`all: true`) aucune tâche ne peut
   * réellement tourner : on libère toutes les `running`. Sinon, seulement celles dont le bail a expiré.
   */
  recoverOrphans(opts: { all?: boolean } = {}): number {
    const res = opts.all
      ? this.db
          .prepare(
            "UPDATE tasks SET status='ready', lease_until=NULL, updated_at=? WHERE status='running'",
          )
          .run(this.iso())
      : this.db
          .prepare(
            "UPDATE tasks SET status='ready', lease_until=NULL, updated_at=? WHERE status='running' AND lease_until < ?",
          )
          .run(this.iso(), this.iso());
    return res.changes;
  }

  /** « Réessayer à partir de cette étape » : tâches échouées et bloquées → relancées. */
  retryFailed(missionId: string): number {
    return this.db.transaction(() => {
      const f = this.db
        .prepare(
          "UPDATE tasks SET status='ready', attempts=0, error_json=NULL, finished_at=NULL, updated_at=? WHERE mission_id=? AND status='failed'",
        )
        .run(this.iso(), missionId).changes;
      this.db
        .prepare(
          "UPDATE tasks SET status='pending', updated_at=? WHERE mission_id=? AND status='blocked'",
        )
        .run(this.iso(), missionId);
      this.promote(missionId);
      return f;
    })();
  }

  counts(missionId: string): Record<TaskStatus, number> {
    const out: Record<TaskStatus, number> = {
      pending: 0,
      ready: 0,
      running: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
    };
    for (const r of this.db
      .prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE mission_id=? GROUP BY status')
      .all(missionId) as { status: TaskStatus; n: number }[]) {
      out[r.status] = r.n;
    }
    return out;
  }
}

export const _nowIso = nowIso;
