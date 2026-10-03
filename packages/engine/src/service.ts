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
import { dirname } from 'node:path';
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
import { IngestService } from './kb/ingest';
import { KbStore } from './kb/store';
import { resolveEmbedder, type EmbeddingAdapter } from './kb/embeddings';
import { LocalFileAdapter } from './storage/file-adapter';
import { DraftService } from './wizard/drafts';
import { loadNormsProfiles, loadPresets, seedNormsProfiles } from './wizard/catalog';
import {
  OpenRouterClient,
  DEFAULT_OPENROUTER_CONFIG,
  type FetchLike,
  type OpenRouterConfig,
} from './llm/openrouter';

export const ENGINE_VERSION = '0.3.0';

export type EngineOptions = {
  dbPath: string;
  fetch?: FetchLike;
  openrouter?: Partial<OpenRouterConfig>;
  /** Client simulé (injectable pour les tests). */
  mock?: MockLlmClient;
  mockOptions?: MockOptions;
  runner?: Partial<RunnerConfig>;
  agents?: AgentRegistry;
  /** Dossier de données utilisateur (missions/<id>/uploads…). Défaut : dossier de la base. */
  dataDir?: string;
  /** Dossier des modèles embarqués (multilingual-e5-small). Absent → embeddeur de repli lexical. */
  modelsDir?: string;
  embedder?: EmbeddingAdapter;
  /** Fichiers de configuration (préréglages de modèles, profils de normes). */
  presetsPath?: string;
  normsProfilesPath?: string;
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
  readonly store: KbStore;
  readonly ingest: IngestService;
  readonly drafts: DraftService;
  readonly embedder: EmbeddingAdapter;
  private readonly opts: EngineOptions;
  private live = new Set<(e: EngineLiveEvent) => void>();

  constructor(opts: EngineOptions) {
    this.opts = opts;
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
    const dataDir = opts.dataDir ?? dirname(opts.dbPath);
    this.embedder = opts.embedder ?? resolveEmbedder(opts.modelsDir);
    this.store = new KbStore(this.db);
    this.ingest = new IngestService({
      db: this.db,
      files: new LocalFileAdapter(),
      store: this.store,
      embedder: () => this.embedder,
      dataDir,
      journal: this.journal,
      emit: (missionId, file) => this.emit({ kind: 'file.updated', missionId, file }),
    });
    seedNormsProfiles(this.db, loadNormsProfiles(opts.normsProfilesPath));
    this.drafts = new DraftService(
      this.db,
      this.missions,
      this.ingest,
      this.store,
      this.journal,
      dataDir,
      () => this.presets(),
    );
    this.journal.subscribe((event) => this.emit({ kind: 'mission.event', event }));
  }

  /** Démarre la boucle d'orchestration et reprend les missions interrompues (§8.6). */
  start(): void {
    this.runner.recoverOnStart();
    this.ingest.recover();
    this.runner.startLoop();
  }

  onLive(cb: (e: EngineLiveEvent) => void): () => void {
    this.live.add(cb);
    return () => this.live.delete(cb);
  }

  private emit(e: EngineLiveEvent): void {
    this.live.forEach((l) => l(e));
  }

  private presets() {
    const cache = this.settings.get<{ models: import('@emilio/shared').ModelInfo[] }>(
      'openrouter_models_cache',
    );
    return loadPresets(this.opts.presetsPath, cache?.models ?? null);
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
      case 'listDrafts':
        return this.drafts.list();
      case 'createDraft':
        return this.drafts.create({
          workType: p.workType as never,
          titre: p.titre as string | undefined,
        });
      case 'getDraft':
        return this.drafts.get(id());
      case 'saveDraft':
        return this.drafts.save(id(), p.brief as never);
      case 'deleteDraft':
        await this.drafts.remove(id());
        return null;
      case 'finalizeDraft':
        return this.drafts.finalize(id(), { confirmNoFieldData: Boolean(p.confirmNoFieldData) });
      case 'addFiles':
        return this.ingest.add(id(), p.items as { path: string; kind: never }[]);
      case 'removeFile':
        return this.ingest.remove(id(), String(p.fileId));
      case 'listFiles':
        return this.ingest.list(id());
      case 'listPresets':
        return this.presets();
      case 'listNormsProfiles':
        return loadNormsProfiles(this.opts.normsProfilesPath);
      case 'searchKb':
        return this.store.search(this.embedder, {
          missionId: id(),
          query: String(p.query),
          limit: p.limit as number | undefined,
        });
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
    await this.ingest.idle();
    this.db.close();
  }
}
