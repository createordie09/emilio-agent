import {
  AppError,
  IPC,
  maskKey,
  serializeError,
  type KeyInfo,
  type KeyStatus,
  type ModelList,
  type Result,
  type ThemePreference,
  THEMES,
  type UiSettings,
  type EnginePing,
  type MissionDetail,
  type MissionEvent,
  type MissionSummary,
  type AddFileResult,
  type BriefDraft,
  type DraftDetail,
  type DraftSummary,
  type FileKind,
  type FinalizeOptions,
  type MissionFileInfo,
  type NormsProfileInfo,
  type PresetInfo,
  type WorkType,
  type ConnectorStatus,
  type SectionResearchSummary,
  type SourceDetail,
  type FieldAnalysisView,
  type FrontMatterView,
  type PlanMetaPatch,
  type PlanNodeInput,
  type PlanNodePatch,
  type PlanOverview,
  type SectionDraftDetail,
  type SectionDraftSummary,
  type SourceSummary,
  type SourcesConfigInfo,
} from '@emilio/shared';
import type { EngineClient } from '../engine-host';

/** Abstraction du chiffrement (Electron `safeStorage` en production, simulée dans les tests). */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): string; // → base64
  decrypt(b64: string): string;
}

export type HandlerDeps = {
  engine: EngineClient;
  cipher: SecretCipher;
  appInfo: () => unknown;
  /** Boîte de dialogue système de choix de fichiers (Electron `dialog`), filtrée selon le type d'import. */
  pickFiles?: (kind: FileKind) => Promise<string[]>;
};

const KEY_ENC = 'openrouter_key_encrypted';
const KEY_MASK = 'openrouter_key_masked';
const UI_KEY = 'ui_settings';
/** Connecteurs de sources acceptant une clé d'API (facultative pour Semantic Scholar, obligatoire pour CORE). */
const KEYED_CONNECTORS = ['semantic_scholar', 'core'];
const skEnc = (id: string) => `source_key_encrypted:${id}`;
const skMask = (id: string) => `source_key_masked:${id}`;
export const DEFAULT_UI: UiSettings = { theme: 'systeme', reduceEffects: false, devMode: false };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (e: unknown): Result<never> => ({ ok: false, error: serializeError(e) });

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new AppError(r.error.code, r.error.detail);
  return r.value;
}

export function createHandlers(d: HandlerDeps) {
  const get = <T>(key: string) => unwrap(d.engine.request<T | null>('getSetting', { key }));
  const set = (key: string, value: unknown) =>
    unwrap(d.engine.request<null>('setSetting', { key, value }));

  /** Au démarrage du moteur : recharge la clé déchiffrée en mémoire du moteur. */
  async function restoreKey(client: EngineClient = d.engine): Promise<void> {
    if (d.cipher.isAvailable()) {
      for (const id of KEYED_CONNECTORS) {
        const e = await unwrap(client.request<string | null>('getSetting', { key: skEnc(id) }));
        if (!e) continue;
        try {
          await unwrap(client.request('setSourceKey', { connector: id, key: d.cipher.decrypt(e) }));
        } catch {
          /* clé illisible : à ressaisir */
        }
      }
    }
    const enc = await unwrap(client.request<string | null>('getSetting', { key: KEY_ENC }));
    if (!enc || !d.cipher.isAvailable()) return;
    try {
      await unwrap(client.request('setApiKey', { key: d.cipher.decrypt(enc) }));
    } catch {
      // Clé illisible (profil système changé) : l'utilisateur devra la ressaisir.
    }
  }

  async function status(): Promise<KeyStatus> {
    const masked = await get<string>(KEY_MASK);
    return { configured: Boolean(masked), masked: masked ?? null };
  }

  /** Outils réservés au mode développeur (missions factices, pannes simulées). */
  async function requireDev(): Promise<void> {
    const ui = await get<Partial<UiSettings>>(UI_KEY);
    if (!ui?.devMode) throw new AppError('E_BAD_REQUEST', 'Mode développeur requis');
  }
  const guard = <T>(f: () => Promise<Result<T>>): Promise<Result<T>> => f().catch((e) => fail(e));
  const mission = (method: Parameters<EngineClient['request']>[0]) => (id: string) =>
    d.engine.request<MissionSummary>(method, { id });

  const masks = async (): Promise<Record<string, string | null>> =>
    Object.fromEntries(
      await Promise.all(KEYED_CONNECTORS.map(async (id) => [id, await get<string>(skMask(id))])),
    );
  const sourcesConfig = async (): Promise<Result<SourcesConfigInfo>> =>
    d.engine.request<SourcesConfigInfo>('getSourcesConfig', { masks: await masks() });
  const keyedId = (id: unknown): string => {
    if (typeof id !== 'string' || !KEYED_CONNECTORS.includes(id))
      throw new AppError('E_BAD_REQUEST', 'Ce service n’utilise pas de clé');
    return id;
  };

  const handlers = {
    [IPC.sourcesList]: async (missionId: string) =>
      d.engine.request<SourceSummary[]>('listSources', { id: missionId }),
    [IPC.sourcesGet]: async (sourceId: string) =>
      d.engine.request<SourceDetail>('getSource', { id: sourceId }),
    [IPC.sourcesConfig]: async () => guard(sourcesConfig),
    [IPC.sourcesSaveConfig]: async (patch: {
      contactEmail?: string;
      enabled?: Record<string, boolean>;
    }) =>
      guard(async () =>
        d.engine.request<SourcesConfigInfo>('saveSourcesConfig', {
          config: patch,
          masks: await masks(),
        }),
      ),
    [IPC.sourcesSaveKey]: async (
      connectorId: string,
      key: string,
    ): Promise<Result<SourcesConfigInfo>> =>
      guard(async () => {
        const id = keyedId(connectorId);
        if (typeof key !== 'string' || !key.trim()) throw new AppError('E_KEY_MISSING');
        if (!d.cipher.isAvailable()) throw new AppError('E_KEY_STORAGE');
        await set(skEnc(id), d.cipher.encrypt(key.trim()));
        await set(skMask(id), maskKey(key));
        await unwrap(d.engine.request('setSourceKey', { connector: id, key: key.trim() }));
        return sourcesConfig();
      }),
    [IPC.sourcesRemoveKey]: async (connectorId: string): Promise<Result<SourcesConfigInfo>> =>
      guard(async () => {
        const id = keyedId(connectorId);
        await unwrap(d.engine.request('deleteSetting', { key: skEnc(id) }));
        await unwrap(d.engine.request('deleteSetting', { key: skMask(id) }));
        await unwrap(d.engine.request('setSourceKey', { connector: id, key: null }));
        return sourcesConfig();
      }),
    [IPC.sourcesTest]: async () => d.engine.request<ConnectorStatus[]>('testSources'),
    [IPC.sourcesDemoResearch]: async (missionId: string) =>
      guard(async () => {
        await requireDev();
        return d.engine.request<SectionResearchSummary>('demoResearch', { id: missionId });
      }),
    [IPC.draftsList]: async () => d.engine.request<DraftSummary[]>('listDrafts'),
    [IPC.draftsCreate]: async (opts?: { workType?: WorkType; titre?: string }) =>
      d.engine.request<DraftDetail>('createDraft', {
        workType: opts?.workType,
        titre: opts?.titre,
      }),
    [IPC.draftsGet]: async (id: string) => d.engine.request<DraftDetail>('getDraft', { id }),
    [IPC.draftsSave]: async (id: string, brief: BriefDraft) =>
      d.engine.request<DraftDetail>('saveDraft', { id, brief }),
    [IPC.draftsRemove]: async (id: string) => d.engine.request<null>('deleteDraft', { id }),
    [IPC.draftsFinalize]: async (id: string, opts?: FinalizeOptions) =>
      d.engine.request<MissionSummary>('finalizeDraft', {
        id,
        confirmNoFieldData: Boolean(opts?.confirmNoFieldData),
      }),
    [IPC.filesPick]: async (kind: FileKind): Promise<Result<string[]>> =>
      guard(async () => ok(d.pickFiles ? await d.pickFiles(kind) : [])),
    [IPC.filesAdd]: async (id: string, items: { path: string; kind: FileKind }[]) =>
      d.engine.request<AddFileResult[]>('addFiles', { id, items }),
    [IPC.filesRemove]: async (id: string, fileId: string) =>
      d.engine.request<MissionFileInfo[]>('removeFile', { id, fileId }),
    [IPC.filesList]: async (id: string) => d.engine.request<MissionFileInfo[]>('listFiles', { id }),
    [IPC.catalogPresets]: async () => d.engine.request<PresetInfo[]>('listPresets'),
    [IPC.catalogNorms]: async () => d.engine.request<NormsProfileInfo[]>('listNormsProfiles'),
    [IPC.missionsList]: async () => d.engine.request<MissionSummary[]>('listMissions'),
    [IPC.missionsGet]: async (id: string) => d.engine.request<MissionDetail>('getMission', { id }),
    [IPC.missionsCreateDemo]: async (opts?: { budgetUsd?: number }) =>
      guard(async () => {
        await requireDev();
        return d.engine.request<MissionSummary>('createDemoMission', {
          budgetUsd: opts?.budgetUsd,
        });
      }),
    [IPC.missionsStart]: async (id: string) => mission('startMission')(id),
    [IPC.missionsPause]: async (id: string) => mission('pauseMission')(id),
    [IPC.missionsResume]: async (id: string) => mission('resumeMission')(id),
    [IPC.missionsCancel]: async (id: string) => mission('cancelMission')(id),
    [IPC.missionsRetry]: async (id: string) => mission('retryMission')(id),
    [IPC.missionsSimulate]: async (kind: string) =>
      guard(async () => {
        await requireDev();
        return d.engine.request<null>('simulate', { kind });
      }),
    [IPC.missionsSetSimulated]: async (id: string, simulated: boolean) =>
      guard(async () => {
        await requireDev();
        return d.engine.request<MissionSummary>('setLlmMode', {
          id,
          simulated: Boolean(simulated),
        });
      }),
    [IPC.writingSections]: async (missionId: string) =>
      d.engine.request<SectionDraftSummary[]>('listSectionDrafts', { id: missionId }),
    [IPC.writingSection]: async (nodeId: string) =>
      d.engine.request<SectionDraftDetail>('getSectionDraft', { nodeId }),
    [IPC.writingAnalysis]: async (missionId: string) =>
      d.engine.request<FieldAnalysisView | null>('getFieldAnalysis', { id: missionId }),
    [IPC.writingFrontMatter]: async (missionId: string) =>
      d.engine.request<FrontMatterView[]>('getFrontMatter', { id: missionId }),
    [IPC.planGenerate]: async (id: string) => mission('generatePlan')(id),
    [IPC.planRegenerate]: async (id: string, comment: string) =>
      d.engine.request<MissionSummary>('regeneratePlan', { id, comment: String(comment ?? '') }),
    [IPC.planGet]: async (id: string) => d.engine.request<PlanOverview>('getPlan', { id }),
    [IPC.planUpdateNode]: async (id: string, nodeId: string, patch: PlanNodePatch) =>
      d.engine.request<PlanOverview>('updatePlanNode', { id, nodeId, patch }),
    [IPC.planAddNode]: async (id: string, input: PlanNodeInput) =>
      d.engine.request<PlanOverview>('addPlanNode', { id, input }),
    [IPC.planDeleteNode]: async (id: string, nodeId: string) =>
      d.engine.request<PlanOverview>('deletePlanNode', { id, nodeId }),
    [IPC.planMoveNode]: async (
      id: string,
      nodeId: string,
      parentId: string | null,
      index: number,
    ) => d.engine.request<PlanOverview>('movePlanNode', { id, nodeId, parentId, index }),
    [IPC.planSaveMeta]: async (id: string, patch: PlanMetaPatch) =>
      d.engine.request<PlanOverview>('savePlanMeta', { id, patch }),
    [IPC.planValidate]: async (id: string) => mission('validatePlan')(id),
    [IPC.missionsEvents]: async (id: string | null, opts?: { limit?: number }) =>
      d.engine.request<MissionEvent[]>('listEvents', { id, limit: opts?.limit }),
    [IPC.appInfo]: async () => d.appInfo(),
    [IPC.enginePing]: async () => d.engine.request<EnginePing>('ping'),
    [IPC.keyStatus]: async (): Promise<Result<KeyStatus>> => {
      try {
        return ok(await status());
      } catch (e) {
        return fail(e);
      }
    },
    [IPC.keySave]: async (key: unknown): Promise<Result<KeyStatus>> => {
      try {
        if (typeof key !== 'string' || !key.trim()) throw new AppError('E_KEY_MISSING');
        if (!d.cipher.isAvailable()) throw new AppError('E_KEY_STORAGE');
        const plain = key.trim();
        await set(KEY_ENC, d.cipher.encrypt(plain));
        await set(KEY_MASK, maskKey(plain));
        await unwrap(d.engine.request('setApiKey', { key: plain }));
        return ok(await status());
      } catch (e) {
        return fail(e);
      }
    },
    [IPC.keyTest]: async (): Promise<Result<KeyInfo>> => d.engine.request<KeyInfo>('testKey'),
    [IPC.keyRemove]: async (): Promise<Result<KeyStatus>> => {
      try {
        await unwrap(d.engine.request('deleteSetting', { key: KEY_ENC }));
        await unwrap(d.engine.request('deleteSetting', { key: KEY_MASK }));
        await unwrap(d.engine.request('setApiKey', { key: null }));
        return ok({ configured: false, masked: null });
      } catch (e) {
        return fail(e);
      }
    },
    [IPC.modelsList]: async (opts?: { refresh?: boolean }): Promise<Result<ModelList>> =>
      d.engine.request<ModelList>('listModels', { refresh: Boolean(opts?.refresh) }),
    [IPC.uiGet]: async (): Promise<Result<UiSettings>> => {
      try {
        return ok({ ...DEFAULT_UI, ...((await get<Partial<UiSettings>>(UI_KEY)) ?? {}) });
      } catch (e) {
        return fail(e);
      }
    },
    [IPC.uiSet]: async (patch: Partial<UiSettings>): Promise<Result<UiSettings>> => {
      try {
        const cur = { ...DEFAULT_UI, ...((await get<Partial<UiSettings>>(UI_KEY)) ?? {}) };
        const next: UiSettings = {
          theme: THEMES.includes(patch?.theme as ThemePreference)
            ? (patch.theme as ThemePreference)
            : cur.theme,
          reduceEffects:
            typeof patch?.reduceEffects === 'boolean' ? patch.reduceEffects : cur.reduceEffects,
          devMode: typeof patch?.devMode === 'boolean' ? patch.devMode : cur.devMode,
        };
        await set(UI_KEY, next);
        return ok(next);
      } catch (e) {
        return fail(e);
      }
    },
  };
  return { handlers, restoreKey };
}
