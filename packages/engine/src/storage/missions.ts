import {
  AppError,
  type MissionDetail,
  type MissionStatus,
  type MissionSummary,
  type Phase,
  type TaskSummary,
} from '@emilio/shared';
import { newId, nowIso, type Db } from './db';
import { assertTransition } from '../orchestrator/transitions';
import type { EventJournal } from '../events/journal';

type MissionRow = {
  id: string;
  title: string;
  status: MissionStatus;
  current_phase: Phase | null;
  config_json: string | null;
  cost_spent_usd: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  error_json: string | null;
};

const STATUS_LABEL_FR: Record<MissionStatus, string> = {
  draft: 'brouillon',
  briefing: 'préparation du brief',
  planning: 'planification',
  awaiting_plan_validation: 'en attente de validation du plan',
  running: 'en cours',
  paused: 'en pause',
  paused_no_credit: 'en pause (crédit épuisé)',
  paused_network: 'en pause (réseau)',
  paused_budget: 'en pause (budget atteint)',
  failed: 'en échec',
  completed: 'terminée',
  cancelled: 'annulée',
};
export const statusLabelFr = (s: MissionStatus): string => STATUS_LABEL_FR[s];

export class MissionRepo {
  constructor(
    private readonly db: Db,
    private readonly journal: EventJournal,
    private readonly now: () => string = nowIso,
  ) {}

  create(input: { title: string; config?: unknown; status?: MissionStatus }): string {
    const id = newId();
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO missions(id,title,status,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(id, input.title, input.status ?? 'draft', JSON.stringify(input.config ?? {}), t, t);
    return id;
  }

  private row(id: string): MissionRow {
    const r = this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as
      MissionRow | undefined;
    if (!r) throw new AppError('E_INTERNAL', `Mission introuvable : ${id}`);
    return r;
  }

  status(id: string): MissionStatus {
    return this.row(id).status;
  }

  config<T>(id: string): T {
    return JSON.parse(this.row(id).config_json ?? '{}') as T;
  }

  setConfig(id: string, config: unknown): void {
    this.db
      .prepare('UPDATE missions SET config_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(config), this.now(), id);
  }

  /**
   * Transition d'état explicite (table §8.1), journalisée dans `events`.
   * Idempotente si la mission est déjà dans l'état cible.
   */
  transition(
    id: string,
    to: MissionStatus,
    opts: { reason?: string; error?: { code: string; messageFr: string } | null } = {},
  ): MissionStatus {
    return this.db.transaction(() => {
      const from = this.row(id).status;
      if (from === to) return from;
      assertTransition(from, to);
      const t = this.now();
      this.db
        .prepare(
          `UPDATE missions SET status=?, updated_at=?,
             started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
             finished_at = CASE WHEN ? IN ('completed','cancelled','failed') THEN ? ELSE finished_at END,
             error_json = ?
           WHERE id=?`,
        )
        .run(to, t, to, t, to, t, opts.error ? JSON.stringify(opts.error) : null, id);
      this.journal.record({
        missionId: id,
        level:
          to === 'completed'
            ? 'success'
            : to === 'failed'
              ? 'error'
              : to.startsWith('paused')
                ? 'warning'
                : 'info',
        messageFr: opts.reason ?? `Mission ${statusLabelFr(to)}.`,
        data: { from, to },
      });
      return from;
    })();
  }

  setPhase(id: string, phase: Phase): void {
    this.db
      .prepare('UPDATE missions SET current_phase=?, updated_at=? WHERE id=?')
      .run(phase, this.now(), id);
  }

  addCost(id: string, usd: number): number {
    this.db
      .prepare('UPDATE missions SET cost_spent_usd = cost_spent_usd + ?, updated_at=? WHERE id=?')
      .run(usd, this.now(), id);
    return this.row(id).cost_spent_usd;
  }

  costSpent(id: string): number {
    return this.row(id).cost_spent_usd;
  }

  idsByStatus(status: MissionStatus): string[] {
    return (
      this.db.prepare('SELECT id FROM missions WHERE status=?').all(status) as { id: string }[]
    ).map((r) => r.id);
  }

  summary(id: string): MissionSummary {
    const m = this.row(id);
    const c = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM tasks WHERE mission_id=?`,
      )
      .get(id) as { total: number; done: number | null };
    const cfg = JSON.parse(m.config_json ?? '{}') as { budgetMaxUsd?: number; llmMode?: string };
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      currentPhase: m.current_phase,
      costSpentUsd: m.cost_spent_usd,
      budgetMaxUsd: cfg.budgetMaxUsd ?? null,
      simulated: cfg.llmMode === 'mock',
      tasksTotal: c.total,
      tasksDone: c.done ?? 0,
      startedAt: m.started_at,
      finishedAt: m.finished_at,
      createdAt: m.created_at,
      error: m.error_json ? (JSON.parse(m.error_json) as MissionSummary['error']) : null,
    };
  }

  list(): MissionSummary[] {
    return (
      this.db
        .prepare(
          "SELECT id FROM missions WHERE status != 'draft' ORDER BY created_at DESC, id DESC",
        )
        .all() as {
        id: string;
      }[]
    ).map((r) => this.summary(r.id));
  }

  detail(id: string): MissionDetail {
    const tasks = (
      this.db
        .prepare(
          'SELECT id, phase, agent_role, input_json, status, attempts, cost_usd, model FROM tasks WHERE mission_id=? ORDER BY created_at, id',
        )
        .all(id) as {
        id: string;
        phase: Phase;
        agent_role: TaskSummary['agentRole'];
        input_json: string | null;
        status: TaskSummary['status'];
        attempts: number;
        cost_usd: number;
        model: string | null;
      }[]
    ).map((t) => ({
      id: t.id,
      phase: t.phase,
      agentRole: t.agent_role,
      label: (JSON.parse(t.input_json ?? '{}') as { label?: string }).label ?? t.agent_role,
      status: t.status,
      attempts: t.attempts,
      costUsd: t.cost_usd,
      model: t.model,
    }));
    return { ...this.summary(id), tasks };
  }
}
