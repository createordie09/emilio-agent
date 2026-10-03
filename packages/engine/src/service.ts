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
import { createDemoMission, MOCK_MODEL_ID } from './orchestrator/demo';
import { ModelCaller } from './llm/call-model';
import { MockLlmClient, type MockOptions } from './llm/mock';
import type { MissionExecConfig } from './llm/exec-config';
import { ResearchService } from './research/research-service';
import { researchMockRespond } from './research/mock-responder';
import { planningMockRespond } from './planning/mock-responder';
import { getSource, listSources } from './research/catalog';
import { SourceHttp, DEFAULT_HTTP_CONFIG } from './sources/http';
import {
  SourceRegistry,
  DEFAULT_ENABLED,
  CONNECTOR_LABELS,
  type SourcesConfig,
} from './sources/registry';
import { mockConnectors, MockSourceConnector } from './sources/mock';
import { mockBooks, mockFullTextHttp, mockPageHttp } from './sources/mock-pdf';
import { loadQualityWeights } from './sources/score';
import { demoRegistry, type AgentRegistry } from './agents/registry';
import { IngestService } from './kb/ingest';
import { PlanningService } from './planning/service';
import { OutlineRepo } from './planning/outline';
import { loadEstimation, loadPlanConfig, loadStructures } from './planning/config';
import { BriefSchema, WORK_TYPE_LABEL_FR } from '@emilio/shared';
import type { Brief } from '@emilio/shared';
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

export const ENGINE_VERSION = '0.5.0';

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
  qualityWeightsPath?: string;
  /** Dossier `resources/` : gabarits de structure, réglages du plan et de l'estimation. */
  resourcesDir?: string;
  /** Substitut de `fetch` pour les connecteurs de sources (tests). */
  sourcesFetch?: FetchLike;
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
  readonly sourceHttp: SourceHttp;
  readonly sources: SourceRegistry;
  readonly research: ResearchService;
  readonly outline: OutlineRepo;
  readonly planning: PlanningService;
  readonly mockSources: MockSourceConnector[] = mockConnectors();
  private sourceKeys = new Map<string, string>();
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
      opts.mock ??
      new MockLlmClient({
        delayMs: 400,
        costPerCallUsd: 0.002,
        respond: (req) => researchMockRespond(req) ?? planningMockRespond(req),
        ...opts.mockOptions,
      });
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
      localHandlers: {
        'demo.ingest': () => ({ fichiers: 0 }),
        'p3.research': (task) => this.researchNode(task.missionId, String(task.input.nodeId)),
      },
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
    this.sourceHttp = new SourceHttp(
      this.db,
      opts.sourcesFetch,
      { ...DEFAULT_HTTP_CONFIG, appVersion: ENGINE_VERSION },
      () => this.sourcesConfig().contactEmail,
    );
    this.sources = new SourceRegistry(
      this.sourceHttp,
      () => this.sourcesConfig(),
      (id) => this.sourceKeys.get(id),
    );
    this.research = new ResearchService({
      db: this.db,
      missions: this.missions,
      journal: this.journal,
      caller,
      store: this.store,
      ingest: this.ingest,
      embedder: () => this.embedder,
      files: new LocalFileAdapter(),
      dataDir,
      weights: loadQualityWeights(opts.qualityWeightsPath),
      connectors: (mode, extra) =>
        mode === 'mock' ? this.mockSources : this.sources.enabled(extra),
      connector: (mode, id) =>
        mode === 'mock' ? this.mockSources.find((c) => c.id === id) : this.sources.get(id),
      verifyDeps: (mode) =>
        mode === 'mock'
          ? { books: mockBooks, http: mockPageHttp }
          : { books: this.sources.books, http: this.sourceHttp },
      fullTextHttp: (mode) => (mode === 'mock' ? mockFullTextHttp : this.sourceHttp),
    });
    this.outline = new OutlineRepo(this.db);
    this.planning = new PlanningService({
      db: this.db,
      missions: this.missions,
      journal: this.journal,
      caller,
      queue: this.queue,
      ingest: this.ingest,
      research: this.research,
      outline: this.outline,
      config: loadPlanConfig(opts.resourcesDir),
      estimation: loadEstimation(opts.resourcesDir),
      structures: loadStructures(opts.resourcesDir),
      price: (model) => this.priceOf(model),
      onUpdated: (id) => this.emit({ kind: 'mission.updated', mission: this.missions.summary(id) }),
    });
    this.journal.subscribe((event) => this.emit({ kind: 'mission.event', event }));
  }

  /** Démarre la boucle d'orchestration et reprend les missions interrompues (§8.6). */
  start(): void {
    this.runner.recoverOnStart();
    this.ingest.recover();
    this.planning.recover();
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

  /** Réglages « Sources documentaires » (adresse de contact, activation par connecteur). */
  sourcesConfig(): SourcesConfig {
    return this.settings.get<SourcesConfig>('sources_config') ?? {};
  }

  private sourcesConfigInfo(masks: Record<string, string | null> = {}) {
    const cfg = this.sourcesConfig();
    return {
      contactEmail: cfg.contactEmail ?? '',
      connectors: Object.keys(CONNECTOR_LABELS).map((id) => ({
        id,
        label: CONNECTOR_LABELS[id]!,
        enabled: cfg.enabled?.[id] ?? DEFAULT_ENABLED[id] ?? false,
        needsKey: id === 'core',
        keyConfigured: this.sourceKeys.has(id),
        keyMasked: masks[id] ?? null,
      })),
    };
  }

  /** Recherche approfondie d'une section du plan validé (tâche P3, CdC §9) : sections du plan → `ResearchService`. */
  private async researchNode(missionId: string, nodeId: string): Promise<unknown> {
    const node = this.outline.list(missionId).find((n) => n.id === nodeId);
    if (!node) throw new AppError('E_INTERNAL', 'Section du plan introuvable.');
    const brief = BriefSchema.parse(this.draftBrief(missionId)) as Brief;
    this.outline.setStatus(nodeId, 'researching');
    try {
      const r = await this.research.researchSection({
        missionId,
        sectionKey: nodeId,
        title: node.title,
        objective: node.objective || node.title,
        keyQuestions: node.keyQuestions,
        workType: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
        discipline: brief.discipline,
        depth: brief.execution?.profondeurRecherche ?? 'normale',
        minSources: node.requiredSourcesMin || undefined,
        prioriteAfrique: brief.execution?.preferenceSources === 'afrique',
      });
      return {
        sectionKey: r.sectionKey,
        retained: r.retained.length,
        verified: r.verified,
        rejected: r.rejected.length,
        notes: r.notes,
        coverageOk: r.coverageOk,
      };
    } finally {
      this.outline.setStatus(nodeId, 'planned');
    }
  }

  private draftBrief(missionId: string): unknown {
    const r = this.db.prepare('SELECT brief_json FROM missions WHERE id=?').get(missionId) as
      { brief_json: string | null } | undefined;
    return JSON.parse(r?.brief_json ?? '{}');
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
      case 'listSources':
        return listSources(this.db, id());
      case 'getSource': {
        const d = getSource(this.db, id());
        if (!d) throw new AppError('E_INTERNAL', 'Source introuvable');
        return d;
      }
      case 'getSourcesConfig':
        return this.sourcesConfigInfo((p.masks as Record<string, string | null> | undefined) ?? {});
      case 'saveSourcesConfig': {
        const cur = this.sourcesConfig();
        const patch = p.config as Partial<SourcesConfig>;
        this.settings.set('sources_config', {
          ...cur,
          ...(patch.contactEmail !== undefined ? { contactEmail: patch.contactEmail.trim() } : {}),
          enabled: { ...cur.enabled, ...patch.enabled },
        });
        return this.sourcesConfigInfo((p.masks as Record<string, string | null> | undefined) ?? {});
      }
      case 'setSourceKey':
        if (p.key) this.sourceKeys.set(String(p.connector), String(p.key));
        else this.sourceKeys.delete(String(p.connector));
        return null;
      case 'testSources':
        return this.sources.test();
      case 'demoResearch': {
        if (this.missions.config<{ llmMode: string }>(id()).llmMode !== 'mock')
          throw new AppError(
            'E_BAD_REQUEST',
            'Recherche de démonstration : mission simulée uniquement',
          );
        const r = await this.research.researchSection({
          missionId: id(),
          sectionKey: 'demo-section-1',
          title: 'Microfinance et inclusion financière',
          objective:
            'Analyser le rôle de la microfinance dans l’inclusion financière des ménages ruraux en Afrique de l’Ouest.',
          keyQuestions: [
            'Quel est le rôle des groupes de caution solidaire ?',
            'Quels effets sur l’accès au crédit ?',
          ],
          discipline: 'Sciences de gestion',
          workType: 'mémoire de master',
          depth: 'normale',
          minSources: 3,
          prioriteAfrique: true,
        });
        return {
          sectionKey: r.sectionKey,
          iterations: r.iterations,
          found: r.found,
          merged: r.merged,
          verified: r.verified,
          rejected: r.rejected.map((x) => ({ title: x.title, reasonFr: x.reasonFr })),
          retained: r.retained.length,
          notes: r.notes,
          quotesDropped: r.quotesDropped,
          byConnector: r.byConnector,
          warnings: r.warnings,
          coverageOk: r.coverageOk,
        };
      }
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
        this.planning.cancel(id());
        this.runner.cancel(id());
        return this.missions.summary(id());
      case 'retryMission':
        // Plan en échec (aucune tâche créée) : on relance la planification plutôt que les tâches.
        if (
          this.missions.status(id()) === 'failed' &&
          Object.values(this.queue.counts(id())).every((n) => n === 0)
        )
          return this.planning.start(id());
        this.runner.retry(id());
        return this.missions.summary(id());
      case 'setLlmMode': {
        if (this.missions.status(id()) !== 'briefing')
          throw new AppError(
            'E_BAD_REQUEST',
            'Le mode simulé se choisit avant la génération du plan.',
          );
        const cur = this.missions.config<MissionExecConfig>(id());
        const mock = Boolean(p.simulated);
        const models = mock
          ? (Object.fromEntries(
              Object.keys(cur.models).map((k) => [k, MOCK_MODEL_ID]),
            ) as MissionExecConfig['models'])
          : cur.models;
        this.missions.setConfig(id(), { ...cur, llmMode: mock ? 'mock' : 'real', models });
        return this.missions.summary(id());
      }
      case 'generatePlan':
        return this.planning.start(id());
      case 'regeneratePlan':
        return this.planning.start(id(), { comment: String(p.comment ?? '') });
      case 'getPlan':
        return this.planning.overview(id());
      case 'updatePlanNode':
        return this.planning.updateNode(id(), String(p.nodeId), p.patch as never);
      case 'addPlanNode':
        return this.planning.addNode(id(), p.input as never);
      case 'deletePlanNode':
        return this.planning.deleteNode(id(), String(p.nodeId));
      case 'movePlanNode':
        return this.planning.moveNode(
          id(),
          String(p.nodeId),
          (p.parentId as string | null) ?? null,
          Number(p.index),
        );
      case 'savePlanMeta':
        return this.planning.saveMeta(id(), p.patch as never);
      case 'validatePlan':
        return this.planning.validate(id(), () =>
          this.runner.start(id(), 'Plan validé : la mission démarre en autonomie.'),
        );
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
    await this.planning.stop();
    await this.runner.stop();
    await this.ingest.idle();
    this.db.close();
  }
}
