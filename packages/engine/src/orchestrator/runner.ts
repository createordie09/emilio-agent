import {
  AppError,
  serializeError,
  type AgentRole,
  type MissionSummary,
  type Phase,
} from '@emilio/shared';
import type { Db } from '../storage/db';
import type { MissionRepo } from '../storage/missions';
import type { QueueAdapter, QueuedTask } from '../queue/queue';
import type { EventJournal } from '../events/journal';
import type { CheckpointRepo } from './checkpoints';
import { taskContext, type ModelCaller } from '../llm/call-model';
import { clampParallelism, type MissionExecConfig } from '../llm/exec-config';
import type { AgentRegistry } from '../agents/registry';
import { roleLabelFr } from '../agents/registry';
import { executeAgentTask } from '../agents/execute';
import { isPaused } from './transitions';

export type RunnerConfig = {
  tickMs: number;
  /** Après une pause utilisateur, les tâches en cours terminent ; au-delà, elles sont interrompues (§8.6 : 60 s). */
  pauseGraceMs: number;
  /** Sans réseau pendant ce délai → `paused_network` (§8.6 : 10 min). */
  networkGiveUpMs: number;
  networkBackoffBaseMs: number;
  networkBackoffMaxMs: number;
  /** Fréquence de vérification du crédit (§8.6 : 15 min) et du réseau (30 s). */
  creditCheckMs: number;
  networkCheckMs: number;
  /** Erreurs 429 consécutives avant de ramener le parallélisme à 1 (§8.5). */
  rateLimitHitsBeforeThrottle: number;
  /** Succès consécutifs pour remonter le parallélisme d'un cran. */
  successesToRaise: number;
  /** Reprise automatique des missions `running` au redémarrage (§8.6). */
  autoResumeOnStart: boolean;
};

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  tickMs: 500,
  pauseGraceMs: 60_000,
  networkGiveUpMs: 10 * 60_000,
  networkBackoffBaseMs: 2_000,
  networkBackoffMaxMs: 5 * 60_000,
  creditCheckMs: 15 * 60_000,
  networkCheckMs: 30_000,
  rateLimitHitsBeforeThrottle: 3,
  successesToRaise: 5,
  autoResumeOnStart: true,
};

export type RunnerDeps = {
  db: Db;
  missions: MissionRepo;
  queue: QueueAdapter;
  journal: EventJournal;
  checkpoints: CheckpointRepo;
  caller: ModelCaller;
  agents: AgentRegistry;
  /** Exécuteurs de tâches locales (sans LLM), par nom de tâche. */
  localHandlers?: Record<string, (task: QueuedTask) => Promise<unknown> | unknown>;
  /** Sondes de reprise automatique : vrai si le service est de nouveau utilisable. */
  probes: {
    credit: (missionId: string) => Promise<boolean>;
    network: (missionId: string) => Promise<boolean>;
  };
  now?: () => number;
  config?: Partial<RunnerConfig>;
  /** Reprise automatique autorisée (préférence de l'utilisateur, §8.6) ; vrai par défaut. */
  autoResume?: () => boolean | undefined;
  /** Journal technique : cause réelle d'une erreur de tâche (le message affiché à l'utilisateur ne la contient pas). */
  techLog?: (line: string) => void;
  onMissionUpdated?: (m: MissionSummary) => void;
};

const PHASE_ORDER: Phase[] = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'];

type InFlight = { missionId: string; abort: AbortController; promise: Promise<void> };

/**
 * Planificateur de missions (CdC §8.2) : prend les tâches `ready` par priorité puis ancienneté, dans la limite
 * du parallélisme, pose un bail, exécute, enregistre. Toute l'information durable vit en SQLite.
 */
export class MissionRunner {
  private readonly cfg: RunnerConfig;
  private readonly now: () => number;
  private inFlight = new Map<string, InFlight>();
  private notBefore = new Map<string, number>(); // backoff réseau / 429 par tâche (mémoire seule, sans conséquence en cas de perte)
  private netDownSince = new Map<string, number>();
  private rateLimitHits = new Map<string, number>();
  private successStreak = new Map<string, number>();
  private throttled = new Map<string, number>(); // parallélisme réduit par mission
  private timers: NodeJS.Timeout[] = [];
  private pauseTimers = new Map<string, NodeJS.Timeout>();
  private ticking = false;

  constructor(private readonly d: RunnerDeps) {
    this.cfg = { ...DEFAULT_RUNNER_CONFIG, ...d.config };
    this.now = d.now ?? Date.now;
  }

  /** Démarrage du moteur : libère les tâches orphelines et reprend (ou met en pause) les missions `running`. */
  recoverOnStart(): { orphans: number; resumed: string[] } {
    const orphans = this.d.queue.recoverOrphans({ all: true });
    const running = this.d.missions.idsByStatus('running');
    if (!(this.d.autoResume?.() ?? this.cfg.autoResumeOnStart)) {
      for (const id of running) {
        this.d.missions.transition(id, 'paused', {
          reason: 'Application relancée : mission mise en pause. Cliquez sur Reprendre.',
        });
      }
      return { orphans, resumed: [] };
    }
    for (const id of running) {
      this.d.journal.record({
        missionId: id,
        level: 'info',
        messageFr: `Mission reprise après redémarrage (${orphans} tâche(s) interrompue(s) relancée(s)).`,
      });
    }
    return { orphans, resumed: running };
  }

  startLoop(): void {
    this.timers.push(setInterval(() => void this.tick(), this.cfg.tickMs));
    this.timers.push(
      setInterval(
        () => void this.checkAutoResume(),
        Math.min(this.cfg.networkCheckMs, this.cfg.creditCheckMs),
      ),
    );
  }

  /** Arrêt propre : plus de nouvelle tâche ; les tâches en cours sont interrompues et libérées sans pénalité. */
  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.pauseTimers.forEach(clearTimeout);
    this.pauseTimers.clear();
    for (const f of this.inFlight.values()) f.abort.abort();
    await Promise.allSettled([...this.inFlight.values()].map((f) => f.promise));
  }

  /** Simule un crash : les tâches restent `running` en base (aucune libération), comme après une coupure brutale. */
  async crashForTest(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    const pending = [...this.inFlight.values()];
    this.inFlight.clear(); // on « oublie » les tâches sans les libérer
    for (const f of pending) f.abort.abort();
    this.crashed = true;
    await Promise.allSettled(pending.map((f) => f.promise));
  }
  private crashed = false;

  // ---------------------------------------------------------------- commandes utilisateur

  start(missionId: string, reason?: string): void {
    this.d.missions.transition(missionId, 'running', { reason: reason ?? 'Mission lancée.' });
    this.touch(missionId);
  }

  pause(missionId: string): void {
    this.d.missions.transition(missionId, 'paused', { reason: 'Mission mise en pause.' });
    this.touch(missionId);
    // Les tâches en cours terminent ; interrompues après le délai de grâce (§8.6).
    const t = setTimeout(() => {
      for (const f of this.inFlight.values()) if (f.missionId === missionId) f.abort.abort();
      this.pauseTimers.delete(missionId);
    }, this.cfg.pauseGraceMs);
    this.pauseTimers.set(missionId, t);
  }

  resume(missionId: string): void {
    const t = this.pauseTimers.get(missionId);
    if (t) {
      clearTimeout(t);
      this.pauseTimers.delete(missionId);
    }
    this.netDownSince.delete(missionId);
    this.d.missions.transition(missionId, 'running', { reason: 'Mission reprise.' });
    this.touch(missionId);
  }

  cancel(missionId: string): void {
    this.d.missions.transition(missionId, 'cancelled', {
      reason: 'Mission annulée. Vos données sont conservées.',
    });
    for (const f of this.inFlight.values()) if (f.missionId === missionId) f.abort.abort();
    this.touch(missionId);
  }

  /** « Réessayer à partir de cette étape » après un échec. */
  retry(missionId: string): void {
    const n = this.d.queue.retryFailed(missionId);
    this.d.missions.transition(missionId, 'running', {
      reason: `Nouvelle tentative : ${n} tâche(s) relancée(s).`,
    });
    this.touch(missionId);
  }

  // ---------------------------------------------------------------- boucle

  /** Un passage du planificateur ; appelable directement (tests) ou par la boucle. */
  async tick(): Promise<void> {
    if (this.ticking || this.crashed) return;
    this.ticking = true;
    try {
      for (const id of this.d.missions.idsByStatus('running')) {
        this.d.queue.promote(id);
        if (this.maybeComplete(id)) continue;
        const cfg = this.d.missions.config<MissionExecConfig>(id);
        const limit = this.throttled.get(id) ?? clampParallelism(cfg.parallelism);
        const mine = [...this.inFlight.values()].filter((f) => f.missionId === id).length;
        const skip = new Set([...this.notBefore].filter(([, t]) => t > this.now()).map(([k]) => k));
        for (const task of this.d.queue.claim(id, limit - mine, skip)) this.launch(task);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Pour les tests : avance jusqu'à ce que la mission quitte l'état `running` (ou que la limite de passes soit atteinte). */
  async runUntilSettled(missionId: string, maxTicks = 500): Promise<MissionSummary> {
    for (let i = 0; i < maxTicks; i++) {
      await this.tick();
      if (this.d.missions.status(missionId) !== 'running' && this.inFlight.size === 0) break;
      await Promise.race([
        ...[...this.inFlight.values()].map((f) => f.promise),
        new Promise((r) => setTimeout(r, 2)),
      ]);
    }
    return this.d.missions.summary(missionId);
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  private launch(task: QueuedTask): void {
    const abort = new AbortController();
    const promise = this.execute(task, abort.signal)
      .catch(() => undefined)
      .finally(() => this.inFlight.delete(task.id));
    this.inFlight.set(task.id, { missionId: task.missionId, abort, promise });
  }

  private async execute(task: QueuedTask, signal: AbortSignal): Promise<void> {
    const { queue, journal } = this.d;
    const label = String(task.input.label ?? task.agentRole);
    const roleFr =
      task.agentRole === 'local' ? 'préparation' : roleLabelFr(task.agentRole as AgentRole);
    const who = roleFr.charAt(0).toUpperCase() + roleFr.slice(1);
    try {
      let output: unknown;
      let cost = { costUsd: 0, tokensIn: 0, tokensOut: 0, model: null as string | null };
      if (task.agentRole === 'local') {
        const h = this.d.localHandlers?.[String(task.input.handler ?? '')];
        output = h ? await taskContext.run(task.id, () => Promise.resolve(h(task))) : { ok: true };
        const agg = this.d.db
          .prepare(
            'SELECT COALESCE(SUM(cost_usd),0) AS c, COALESCE(SUM(prompt_tokens),0) AS i, COALESCE(SUM(completion_tokens),0) AS o FROM llm_calls WHERE task_id=?',
          )
          .get(task.id) as { c: number; i: number; o: number };
        cost = { costUsd: agg.c, tokensIn: agg.i, tokensOut: agg.o, model: null };
      } else {
        const agent = this.d.agents.get(task.agentRole as AgentRole);
        const r = await executeAgentTask(this.d.caller, agent, task, signal);
        if (signal.aborted) throw new DOMException('Interrompu', 'AbortError');
        output = r.output;
        cost = {
          costUsd: r.call.costUsd,
          tokensIn: r.call.tokensIn,
          tokensOut: r.call.tokensOut,
          model: r.call.model,
        };
      }
      // Effets + événement dans UNE transaction ; ne s'applique que si la tâche est encore `running`.
      this.d.db.transaction(() => {
        if (!queue.complete(task.id, { output, ...cost })) return;
        journal.record({
          missionId: task.missionId,
          level: 'success',
          agentRole: task.agentRole,
          messageFr: `${who} : « ${label} » terminé.`,
        });
      })();
      this.onSuccess(task.missionId);
      this.afterTask(task);
    } catch (e) {
      this.handleError(task, e, who, label);
    }
  }

  private onSuccess(missionId: string): void {
    this.netDownSince.delete(missionId);
    this.rateLimitHits.set(missionId, 0);
    const n = (this.successStreak.get(missionId) ?? 0) + 1;
    this.successStreak.set(missionId, n);
    const cur = this.throttled.get(missionId);
    if (cur !== undefined && n >= this.cfg.successesToRaise) {
      this.successStreak.set(missionId, 0);
      const max = clampParallelism(
        this.d.missions.config<MissionExecConfig>(missionId).parallelism,
      );
      if (cur + 1 >= max) this.throttled.delete(missionId);
      else this.throttled.set(missionId, cur + 1);
    }
  }

  private handleError(task: QueuedTask, e: unknown, who: string, label: string): void {
    const { missions, queue, journal } = this.d;
    const id = task.missionId;
    if (this.crashed) return; // crash simulé : on ne touche à rien, comme si le processus était mort
    const aborted =
      (e instanceof DOMException && e.name === 'AbortError') || (e as Error)?.name === 'AbortError';
    if (aborted) {
      queue.release(task.id);
      return;
    }
    const err = e instanceof AppError ? e : new AppError('E_INTERNAL', (e as Error)?.message);
    this.d.techLog?.(
      `erreur de tâche ${task.id} (${label}) : ${err.code} ${err.detail ?? ''} ${e instanceof Error && !(e instanceof AppError) ? (e.stack ?? '').split('\n').slice(0, 4).join(' | ') : ''}`,
    );
    const pause = (
      to: 'paused' | 'paused_no_credit' | 'paused_network' | 'paused_budget',
      msg: string,
    ) => {
      queue.release(task.id);
      if (missions.status(id) === 'running') missions.transition(id, to, { reason: msg });
      this.touch(id);
    };
    switch (err.code) {
      case 'E_NO_CREDIT':
        return pause(
          'paused_no_credit',
          err.messageFr + ' La mission reprendra automatiquement dès que le crédit sera rechargé.',
        );
      case 'E_BUDGET':
        return pause(
          'paused_budget',
          `Le budget de ${missions.config<MissionExecConfig>(id).budgetMaxUsd} $ est atteint.`,
        );
      case 'E_KEY_INVALID':
      case 'E_KEY_MISSING':
        return pause('paused', err.messageFr + ' Ouvrez les Paramètres pour la corriger.');
      case 'E_NETWORK': {
        queue.release(task.id);
        const since = this.netDownSince.get(id) ?? this.now();
        this.netDownSince.set(id, since);
        const k = Math.floor((this.now() - since) / this.cfg.networkBackoffBaseMs);
        const wait = Math.min(
          this.cfg.networkBackoffBaseMs * 2 ** Math.min(k, 20),
          this.cfg.networkBackoffMaxMs,
        );
        this.notBefore.set(task.id, this.now() + wait);
        if (this.now() - since >= this.cfg.networkGiveUpMs) {
          if (missions.status(id) === 'running') {
            missions.transition(id, 'paused_network', {
              reason: 'Connexion Internet perdue, reprise automatique dès son retour.',
            });
            this.touch(id);
          }
        }
        return;
      }
      case 'E_RATE_LIMIT': {
        queue.release(task.id);
        this.notBefore.set(task.id, this.now() + this.cfg.networkBackoffBaseMs);
        const hits = (this.rateLimitHits.get(id) ?? 0) + 1;
        this.rateLimitHits.set(id, hits);
        this.successStreak.set(id, 0);
        if (hits >= this.cfg.rateLimitHitsBeforeThrottle && this.throttled.get(id) !== 1) {
          this.throttled.set(id, 1);
          journal.record({
            missionId: id,
            level: 'info',
            messageFr: 'Limite de débit atteinte : un seul agent à la fois pour le moment.',
          });
        }
        return;
      }
      default: {
        const { retried } = queue.fail(task.id, serializeError(err));
        if (retried) {
          journal.record({
            missionId: id,
            level: 'warning',
            agentRole: task.agentRole,
            messageFr: `${who} : « ${label} » a échoué (${err.messageFr}), nouvel essai.`,
          });
          return;
        }
        missions.transition(id, 'failed', {
          reason: `${who} : « ${label} » a échoué après ${task.maxAttempts} essais. ${err.messageFr}`,
          error: { code: err.code, messageFr: err.messageFr },
        });
        this.touch(id);
      }
    }
  }

  /** Après une tâche : phase courante, checkpoint de fin de phase, fin de mission. */
  private afterTask(task: QueuedTask): void {
    const id = task.missionId;
    const { db, missions, checkpoints, journal, queue } = this.d;
    const rows = db.prepare('SELECT phase, status FROM tasks WHERE mission_id=?').all(id) as {
      phase: Phase;
      status: string;
    }[];
    const byPhase = new Map<Phase, { total: number; done: number }>();
    for (const r of rows) {
      const p = byPhase.get(r.phase) ?? { total: 0, done: 0 };
      p.total++;
      if (r.status === 'done') p.done++;
      byPhase.set(r.phase, p);
    }
    const current = PHASE_ORDER.find(
      (p) => (byPhase.get(p)?.done ?? 0) < (byPhase.get(p)?.total ?? 0),
    );
    if (current) missions.setPhase(id, current);
    const done = rows.filter((r) => r.status === 'done').length;
    for (const [phase, c] of byPhase) {
      if (c.done !== c.total) continue;
      const exists = db
        .prepare('SELECT 1 FROM checkpoints WHERE mission_id=? AND phase=?')
        .get(id, phase);
      if (exists) continue;
      checkpoints.create(id, {
        phase,
        tasksDone: done,
        tasksTotal: rows.length,
        costSpentUsd: missions.costSpent(id),
      });
      journal.record({
        missionId: id,
        level: 'info',
        messageFr: `Phase ${phase} terminée — point de reprise enregistré.`,
      });
    }
    void queue;
    this.touch(id);
  }

  private maybeComplete(id: string): boolean {
    const c = this.d.queue.counts(id);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    if (total > 0 && c.done + c.skipped === total && this.inFlight.size === 0) {
      const stop = this.d.missions.config<MissionExecConfig>(id).stopAfterPhase;
      this.d.missions.transition(id, 'completed', {
        reason: stop ? `Étapes disponibles terminées (jusqu'à ${stop}).` : 'Mission terminée.',
      });
      this.touch(id);
      return true;
    }
    return false;
  }

  /** Reprise automatique après crédit épuisé / coupure réseau (§8.6). */
  async checkAutoResume(): Promise<string[]> {
    const resumed: string[] = [];
    if (this.d.autoResume?.() === false) return resumed;
    for (const id of this.d.missions.idsByStatus('paused_no_credit')) {
      if (await this.d.probes.credit(id).catch(() => false)) {
        this.resume(id);
        this.d.journal.record({
          missionId: id,
          level: 'success',
          messageFr: 'Crédit rechargé : la mission reprend automatiquement.',
        });
        resumed.push(id);
      }
    }
    for (const id of this.d.missions.idsByStatus('paused_network')) {
      if (await this.d.probes.network(id).catch(() => false)) {
        this.resume(id);
        this.d.journal.record({
          missionId: id,
          level: 'success',
          messageFr: 'Connexion rétablie : la mission reprend automatiquement.',
        });
        resumed.push(id);
      }
    }
    return resumed;
  }

  private touch(id: string): void {
    this.d.onMissionUpdated?.(this.d.missions.summary(id));
  }

  isPausedStatus(id: string): boolean {
    return isPaused(this.d.missions.status(id));
  }
}
