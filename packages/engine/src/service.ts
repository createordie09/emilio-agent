import {
  AppError,
  serializeError,
  type EngineLiveEvent,
  type EngineMethod,
  type EnginePing,
  type MissionDetail,
  type MissionEvent,
  type MissionSummary,
  type Result,
} from '@emilio/shared';
import { openDatabase, schemaVersion, type Db } from './storage/db';
import { SettingsRepo } from './storage/settings';
import { MissionRepo } from './storage/missions';
import { EventJournal } from './events/journal';
import { SqliteQueue, type QueueAdapter } from './queue/queue';
import { CheckpointRepo } from './orchestrator/checkpoints';
import { MissionRunner, type RunnerConfig } from './orchestrator/runner';
import { createDemoMission } from './orchestrator/demo';
import { ModelCaller } from './llm/call-model';
import { MockLlmClient, type MockOptions } from './llm/mock';
import { demoRegistry, type AgentRegistry } from './agents/registry';
import {
  OpenRouterClient,
  DEFAULT_OPENROUTER_CONFIG,
  type FetchLike,
  type OpenRouterConfig,
} from './llm/openrouter';

export const ENGINE_VERSION = '0.2.0';

export type EngineOptions = {
  dbPath: string;
  fetch?: FetchLike;
  openrouter?: Partial<OpenRouterConfig>;
  /** Client simulé (injectable pour les tests). */
  mock?: MockLlmClient;
  mockOptions?: MockOptions;
  runner?: Partial<RunnerConfig>;
  agents?: AgentRegistry;
};

/** Façade du moteur : indépendante d'Electron (CdC §4.6), pilotée par le process utilitaire ou par les tests. */
export class EngineService {
  readonly db: Db;
  readonly settings: SettingsRepo;
  readonly llm: OpenRouterClient;
  readonly mock: MockLlmClient;
  readonly journal: EventJournal;
  readonly missions: MissionRepo;
  readonly queue: QueueAdapter;
  readonly checkpoints: CheckpointRepo;
  readonly runner: MissionRunner;
  private live = new Set<(e: EngineLiveEvent) => void>();

  constructor(opts: EngineOptions) {
    this.db = openDatabase(opts.dbPath);
    this.settings = new SettingsRepo(this.db);
    this.llm = new OpenRouterClient(this.settings, opts.fetch, {
      ...DEFAULT_OPENROUTER_CONFIG,
      ...opts.openrouter,
    });
    this.mock =
      opts.mock ?? new MockLlmClient({ delayMs: 400, costPerCallUsd: 0.002, ...opts.mockOptions });
    this.journal = new EventJournal(this.db);
    this.missions = new MissionRepo(this.db, this.journal);
    this.queue = new SqliteQueue(this.db);
    this.checkpoints = new CheckpointRepo(this.db);
    const caller = new ModelCaller(
      this.db,
      this.missions,
      this.journal,
      (mode) => (mode === 'mock' ? this.mock : this.llm),
      (model) => this.priceOf(model),
    );
    this.runner = new MissionRunner({
      db: this.db,
      missions: this.missions,
      queue: this.queue,
      journal: this.journal,
      checkpoints: this.checkpoints,
      caller,
      agents: opts.agents ?? demoRegistry(),
      localHandlers: { 'demo.ingest': () => ({ fichiers: 0 }) },
      probes: {
        credit: async (id) =>
          this.isMock(id) ? !this.mock.creditExhausted : this.creditAvailable(),
        network: async (id) =>
          this.isMock(id)
            ? !this.mock.offline
            : this.llm.ping().then(
                () => true,
                () => false,
              ),
      },
      config: opts.runner,
      onMissionUpdated: (m) => this.emit({ kind: 'mission.updated', mission: m }),
    });
    this.journal.subscribe((event) => this.emit({ kind: 'mission.event', event }));
  }

  /** Démarre la boucle d'orchestration et reprend les missions interrompues (§8.6). */
  start(): void {
    this.runner.recoverOnStart();
    this.runner.startLoop();
  }

  onLive(cb: (e: EngineLiveEvent) => void): () => void {
    this.live.add(cb);
    return () => this.live.delete(cb);
  }

  private emit(e: EngineLiveEvent): void {
    this.live.forEach((l) => l(e));
  }

  private isMock(missionId: string): boolean {
    return this.missions.config<{ llmMode: string }>(missionId).llmMode === 'mock';
  }

  private async creditAvailable(): Promise<boolean> {
    const info = await this.llm.testKey();
    const left = info.accountCreditRemaining ?? info.limitRemaining;
    return left === null || left > 0;
  }

  private priceOf(model: string): { prompt: number; completion: number } | null {
    const cache = this.settings.get<{
      models: { id: string; promptPrice: number | null; completionPrice: number | null }[];
    }>('openrouter_models_cache');
    const m = cache?.models.find((x) => x.id === model);
    return m && m.promptPrice !== null && m.completionPrice !== null
      ? { prompt: m.promptPrice, completion: m.completionPrice }
      : null;
  }

  ping(): EnginePing {
    return { ok: true, engineVersion: ENGINE_VERSION, schemaVersion: schemaVersion(this.db) };
  }

  /** Point d'entrée unique des requêtes main → moteur. */
  async handle(method: EngineMethod, params: unknown): Promise<Result<unknown>> {
    try {
      return { ok: true, value: await this.dispatch(method, params) };
    } catch (e) {
      return { ok: false, error: serializeError(e) };
    }
  }

  private async dispatch(method: EngineMethod, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    const id = () => String(p.id);
    switch (method) {
      case 'ping':
        return this.ping();
      case 'getSetting':
        return this.settings.get(String(p.key)) ?? null;
      case 'setSetting':
        this.settings.set(String(p.key), p.value);
        return null;
      case 'deleteSetting':
        this.settings.delete(String(p.key));
        return null;
      case 'setApiKey':
        this.llm.setApiKey((p.key as string | null) ?? null);
        return null;
      case 'testKey':
        return this.llm.testKey();
      case 'listModels':
        return this.llm.listModels({ refresh: Boolean(p.refresh) });
      case 'listMissions':
        return this.missions.list();
      case 'getMission':
        return this.missions.detail(id()) satisfies MissionDetail;
      case 'createDemoMission': {
        const mid = createDemoMission(this, { budgetUsd: p.budgetUsd as number | undefined });
        this.runner.start(mid, 'Plan validé : la mission démarre en autonomie.');
        return this.missions.summary(mid) satisfies MissionSummary;
      }
      case 'startMission':
        this.runner.start(id());
        return this.missions.summary(id());
      case 'pauseMission':
        this.runner.pause(id());
        return this.missions.summary(id());
      case 'resumeMission':
        this.runner.resume(id());
        return this.missions.summary(id());
      case 'cancelMission':
        this.runner.cancel(id());
        return this.missions.summary(id());
      case 'retryMission':
        this.runner.retry(id());
        return this.missions.summary(id());
      case 'listEvents':
        return this.journal.list(
          (p.id as string | null) ?? null,
          (p.limit as number | undefined) ?? 200,
        ) satisfies MissionEvent[];
      case 'simulate': {
        // Mode développeur : pannes simulées pour le client factice.
        const kind = String(p.kind);
        if (kind === 'no_credit') this.mock.creditExhausted = true;
        else if (kind === 'recharge') this.mock.creditExhausted = false;
        else if (kind === 'offline') this.mock.offline = true;
        else if (kind === 'online') this.mock.offline = false;
        else throw new AppError('E_BAD_REQUEST', `Simulation inconnue : ${kind}`);
        // Confort de démonstration : on n'attend pas la prochaine vérification périodique.
        if (kind === 'recharge' || kind === 'online') void this.runner.checkAutoResume();
        return null;
      }
      default:
        throw new AppError('E_INTERNAL', `Méthode inconnue : ${String(method)}`);
    }
  }

  async close(): Promise<void> {
    await this.runner.stop();
    this.db.close();
  }
}
