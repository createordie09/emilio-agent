import type { KeyInfo, KeyStatus, ModelList } from './models';
import type { SerializedError } from './errors';
import type {
  ConnectorStatus,
  SectionResearchSummary,
  SourceDetail,
  SourceSummary,
  SourcesConfigInfo,
} from './sources';
import type { ThemePreference } from './constants';
import type { MissionDetail, MissionEvent, MissionSummary } from './mission';
import type { BriefDraft, WorkType } from './brief';
import type { PlanMetaPatch, PlanNodeInput, PlanNodePatch, PlanOverview } from './plan';
import type { FileKind, MissionFileInfo } from './files';
import type {
  AddFileResult,
  DraftDetail,
  DraftSummary,
  FinalizeOptions,
  NormsProfileInfo,
  PresetInfo,
} from './wizard';

export type Result<T> = { ok: true; value: T } | { ok: false; error: SerializedError };

export type AppInfo = {
  name: string;
  version: string;
  platform: string;
  electron: string;
  dev: boolean;
};

/** Événements poussés par le moteur vers l'interface. */
export type EngineLiveEvent =
  | { kind: 'mission.event'; event: MissionEvent }
  | { kind: 'mission.updated'; mission: MissionSummary }
  | { kind: 'file.updated'; missionId: string; file: MissionFileInfo };

export type EnginePing = { ok: true; engineVersion: string; schemaVersion: number };

export type UiSettings = { theme: ThemePreference; reduceEffects: boolean; devMode: boolean };

/** API exposée au renderer par le preload (`window.api`). Aucun accès direct au réseau ni à la DB. */
export interface EmilioApi {
  app: { info(): Promise<AppInfo> };
  engine: { ping(): Promise<Result<EnginePing>> };
  key: {
    status(): Promise<Result<KeyStatus>>;
    save(key: string): Promise<Result<KeyStatus>>;
    test(): Promise<Result<KeyInfo>>;
    remove(): Promise<Result<KeyStatus>>;
  };
  models: { list(opts?: { refresh?: boolean }): Promise<Result<ModelList>> };
  missions: {
    list(): Promise<Result<MissionSummary[]>>;
    get(id: string): Promise<Result<MissionDetail>>;
    /** Mission factice exécutée en mode simulé (aucun appel payant). Réservée au mode développeur. */
    createDemo(opts?: { budgetUsd?: number }): Promise<Result<MissionSummary>>;
    start(id: string): Promise<Result<MissionSummary>>;
    pause(id: string): Promise<Result<MissionSummary>>;
    resume(id: string): Promise<Result<MissionSummary>>;
    cancel(id: string): Promise<Result<MissionSummary>>;
    retry(id: string): Promise<Result<MissionSummary>>;
    /** Mode développeur : pannes simulées du client factice. */
    simulate(kind: 'no_credit' | 'recharge' | 'offline' | 'online'): Promise<Result<null>>;
    events(id: string | null, opts?: { limit?: number }): Promise<Result<MissionEvent[]>>;
    /** Mode développeur : bascule une mission au stade « brief » en mode simulé (aucun appel payant). */
    setSimulated(id: string, simulated: boolean): Promise<Result<MissionSummary>>;
  };
  /** Cadrage, plan et validation (CdC §9 P1–P2, §6.5, §14.5). */
  plan: {
    /** Lance P1 + P2 (en arrière-plan) ; l'avancement arrive par les événements. */
    generate(missionId: string): Promise<Result<MissionSummary>>;
    /** Nouvelle version du plan avec commentaire (§9 P2 boucle). */
    regenerate(missionId: string, comment: string): Promise<Result<MissionSummary>>;
    get(missionId: string): Promise<Result<PlanOverview>>;
    updateNode(
      missionId: string,
      nodeId: string,
      patch: PlanNodePatch,
    ): Promise<Result<PlanOverview>>;
    addNode(missionId: string, input: PlanNodeInput): Promise<Result<PlanOverview>>;
    deleteNode(missionId: string, nodeId: string): Promise<Result<PlanOverview>>;
    moveNode(
      missionId: string,
      nodeId: string,
      parentId: string | null,
      index: number,
    ): Promise<Result<PlanOverview>>;
    saveMeta(missionId: string, patch: PlanMetaPatch): Promise<Result<PlanOverview>>;
    /** « Valider le plan et lancer la mission » : fige le plan et démarre la recherche approfondie. */
    validate(missionId: string): Promise<Result<MissionSummary>>;
  };
  /** Assistant « Nouvelle mission » : brouillons, fichiers, préréglages, profils de normes (CdC §6.4). */
  drafts: {
    list(): Promise<Result<DraftSummary[]>>;
    create(opts?: { workType?: WorkType; titre?: string }): Promise<Result<DraftDetail>>;
    get(id: string): Promise<Result<DraftDetail>>;
    save(id: string, brief: BriefDraft): Promise<Result<DraftDetail>>;
    remove(id: string): Promise<Result<null>>;
    finalize(id: string, opts?: FinalizeOptions): Promise<Result<MissionSummary>>;
  };
  files: {
    /** Ouvre la boîte de dialogue système et renvoie les chemins choisis. */
    pick(kind: FileKind): Promise<Result<string[]>>;
    /** Chemins des fichiers déposés par glisser-déposer (le renderer n'a pas accès aux chemins). */
    pathsFor(files: File[]): string[];
    add(
      draftId: string,
      items: { path: string; kind: FileKind }[],
    ): Promise<Result<AddFileResult[]>>;
    remove(draftId: string, fileId: string): Promise<Result<MissionFileInfo[]>>;
    list(draftId: string): Promise<Result<MissionFileInfo[]>>;
  };
  catalog: {
    presets(): Promise<Result<PresetInfo[]>>;
    normsProfiles(): Promise<Result<NormsProfileInfo[]>>;
  };
  /** Sources documentaires (CdC §11, §12) : liste, fiche, réglages, test des connexions. */
  sources: {
    list(missionId: string): Promise<Result<SourceSummary[]>>;
    get(sourceId: string): Promise<Result<SourceDetail>>;
    config(): Promise<Result<SourcesConfigInfo>>;
    saveConfig(patch: {
      contactEmail?: string;
      enabled?: Record<string, boolean>;
    }): Promise<Result<SourcesConfigInfo>>;
    saveKey(connectorId: string, key: string): Promise<Result<SourcesConfigInfo>>;
    removeKey(connectorId: string): Promise<Result<SourcesConfigInfo>>;
    test(): Promise<Result<ConnectorStatus[]>>;
    /** Mode développeur : recherche d'une section factice (mission simulée) avec les connecteurs simulés. */
    demoResearch(missionId: string): Promise<Result<SectionResearchSummary>>;
  };
  /** Abonnement aux événements du moteur en direct ; renvoie la fonction de désabonnement. */
  onEvent(cb: (e: EngineLiveEvent) => void): () => void;
  ui: {
    get(): Promise<Result<UiSettings>>;
    set(patch: Partial<UiSettings>): Promise<Result<UiSettings>>;
  };
}

export { IPC } from './ipc';

/** Protocole main ↔ moteur (utilityProcess, via parentPort). */
export type EngineMethod =
  | 'ping'
  | 'getSetting'
  | 'setSetting'
  | 'deleteSetting'
  | 'setApiKey'
  | 'testKey'
  | 'listModels'
  | 'listDrafts'
  | 'createDraft'
  | 'getDraft'
  | 'saveDraft'
  | 'deleteDraft'
  | 'finalizeDraft'
  | 'addFiles'
  | 'removeFile'
  | 'listFiles'
  | 'listPresets'
  | 'listNormsProfiles'
  | 'searchKb'
  | 'listMissions'
  | 'getMission'
  | 'createDemoMission'
  | 'startMission'
  | 'pauseMission'
  | 'resumeMission'
  | 'cancelMission'
  | 'retryMission'
  | 'listEvents'
  | 'simulate'
  | 'listSources'
  | 'getSource'
  | 'getSourcesConfig'
  | 'saveSourcesConfig'
  | 'setSourceKey'
  | 'testSources'
  | 'demoResearch'
  | 'setLlmMode'
  | 'generatePlan'
  | 'regeneratePlan'
  | 'getPlan'
  | 'updatePlanNode'
  | 'addPlanNode'
  | 'deletePlanNode'
  | 'movePlanNode'
  | 'savePlanMeta'
  | 'validatePlan';
export type EngineRequest = { id: number; method: EngineMethod; params?: unknown };
export type EngineResponse = { id: number; result: Result<unknown> };
export type EngineEvent = { event: 'ready' | 'log' | 'live'; payload?: unknown };
