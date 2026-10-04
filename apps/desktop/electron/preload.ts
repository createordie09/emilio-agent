import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC } from '@emilio/shared/ipc';
import type { EmilioApi, EngineLiveEvent } from '@emilio/shared';

// Seules des fonctions nommées sont exposées : jamais ipcRenderer brut.
const api: EmilioApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  engine: { ping: () => ipcRenderer.invoke(IPC.enginePing) },
  key: {
    status: () => ipcRenderer.invoke(IPC.keyStatus),
    save: (key) => ipcRenderer.invoke(IPC.keySave, key),
    test: () => ipcRenderer.invoke(IPC.keyTest),
    remove: () => ipcRenderer.invoke(IPC.keyRemove),
  },
  models: { list: (opts) => ipcRenderer.invoke(IPC.modelsList, opts) },
  sources: {
    list: (missionId) => ipcRenderer.invoke(IPC.sourcesList, missionId),
    get: (sourceId) => ipcRenderer.invoke(IPC.sourcesGet, sourceId),
    config: () => ipcRenderer.invoke(IPC.sourcesConfig),
    saveConfig: (patch) => ipcRenderer.invoke(IPC.sourcesSaveConfig, patch),
    saveKey: (id, key) => ipcRenderer.invoke(IPC.sourcesSaveKey, id, key),
    removeKey: (id) => ipcRenderer.invoke(IPC.sourcesRemoveKey, id),
    test: () => ipcRenderer.invoke(IPC.sourcesTest),
    demoResearch: (missionId) => ipcRenderer.invoke(IPC.sourcesDemoResearch, missionId),
  },
  drafts: {
    list: () => ipcRenderer.invoke(IPC.draftsList),
    create: (opts) => ipcRenderer.invoke(IPC.draftsCreate, opts),
    get: (id) => ipcRenderer.invoke(IPC.draftsGet, id),
    save: (id, brief) => ipcRenderer.invoke(IPC.draftsSave, id, brief),
    remove: (id) => ipcRenderer.invoke(IPC.draftsRemove, id),
    finalize: (id, opts) => ipcRenderer.invoke(IPC.draftsFinalize, id, opts),
  },
  files: {
    pick: (kind) => ipcRenderer.invoke(IPC.filesPick, kind),
    // Le renderer sandboxé n'a pas accès aux chemins de fichiers : on les résout ici, dans le preload.
    pathsFor: (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
    add: (id, items) => ipcRenderer.invoke(IPC.filesAdd, id, items),
    remove: (id, fileId) => ipcRenderer.invoke(IPC.filesRemove, id, fileId),
    list: (id) => ipcRenderer.invoke(IPC.filesList, id),
  },
  catalog: {
    presets: () => ipcRenderer.invoke(IPC.catalogPresets),
    normsProfiles: () => ipcRenderer.invoke(IPC.catalogNorms),
  },
  missions: {
    list: () => ipcRenderer.invoke(IPC.missionsList),
    get: (id) => ipcRenderer.invoke(IPC.missionsGet, id),
    createDemo: (opts) => ipcRenderer.invoke(IPC.missionsCreateDemo, opts),
    start: (id) => ipcRenderer.invoke(IPC.missionsStart, id),
    pause: (id) => ipcRenderer.invoke(IPC.missionsPause, id),
    resume: (id) => ipcRenderer.invoke(IPC.missionsResume, id),
    cancel: (id) => ipcRenderer.invoke(IPC.missionsCancel, id),
    retry: (id) => ipcRenderer.invoke(IPC.missionsRetry, id),
    simulate: (kind) => ipcRenderer.invoke(IPC.missionsSimulate, kind),
    events: (id, opts) => ipcRenderer.invoke(IPC.missionsEvents, id, opts),
    setSimulated: (id, simulated) => ipcRenderer.invoke(IPC.missionsSetSimulated, id, simulated),
  },
  ops: {
    prefs: () => ipcRenderer.invoke(IPC.opsPrefs),
    setPrefs: (patch) => ipcRenderer.invoke(IPC.opsSetPrefs, patch),
    costs: (id) => ipcRenderer.invoke(IPC.opsCosts, id),
    techLog: (id) => ipcRenderer.invoke(IPC.opsTechLog, id),
    raiseBudget: (id, usd) => ipcRenderer.invoke(IPC.opsRaiseBudget, id, usd),
    finalizeNow: (id) => ipcRenderer.invoke(IPC.opsFinalizeNow, id),
    exportLogs: () => ipcRenderer.invoke(IPC.opsExportLogs),
    exportMission: (id) => ipcRenderer.invoke(IPC.opsExportMission, id),
    importMission: () => ipcRenderer.invoke(IPC.opsImportMission),
    update: () => ipcRenderer.invoke(IPC.opsUpdate),
    checkUpdate: () => ipcRenderer.invoke(IPC.opsCheckUpdate),
    installUpdate: () => ipcRenderer.invoke(IPC.opsInstallUpdate),
    onUpdate: (cb) => {
      const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s);
      ipcRenderer.on(IPC.updateState, h);
      return () => ipcRenderer.removeListener(IPC.updateState, h);
    },
  },
  exports: {
    overview: (missionId) => ipcRenderer.invoke(IPC.exportsOverview, missionId),
    reveal: (id) => ipcRenderer.invoke(IPC.exportsReveal, id),
    saveAs: (id) => ipcRenderer.invoke(IPC.exportsSaveAs, id),
  },
  writing: {
    sections: (missionId) => ipcRenderer.invoke(IPC.writingSections, missionId),
    section: (nodeId) => ipcRenderer.invoke(IPC.writingSection, nodeId),
    analysis: (missionId) => ipcRenderer.invoke(IPC.writingAnalysis, missionId),
    frontMatter: (missionId) => ipcRenderer.invoke(IPC.writingFrontMatter, missionId),
    jury: (missionId) => ipcRenderer.invoke(IPC.writingJury, missionId),
    versions: (nodeId) => ipcRenderer.invoke(IPC.writingVersions, nodeId),
    version: (draftId) => ipcRenderer.invoke(IPC.writingVersion, draftId),
  },
  plan: {
    generate: (id) => ipcRenderer.invoke(IPC.planGenerate, id),
    regenerate: (id, comment) => ipcRenderer.invoke(IPC.planRegenerate, id, comment),
    get: (id) => ipcRenderer.invoke(IPC.planGet, id),
    updateNode: (id, nodeId, patch) => ipcRenderer.invoke(IPC.planUpdateNode, id, nodeId, patch),
    addNode: (id, input) => ipcRenderer.invoke(IPC.planAddNode, id, input),
    deleteNode: (id, nodeId) => ipcRenderer.invoke(IPC.planDeleteNode, id, nodeId),
    moveNode: (id, nodeId, parentId, index) =>
      ipcRenderer.invoke(IPC.planMoveNode, id, nodeId, parentId, index),
    saveMeta: (id, patch) => ipcRenderer.invoke(IPC.planSaveMeta, id, patch),
    validate: (id) => ipcRenderer.invoke(IPC.planValidate, id),
  },
  onEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: EngineLiveEvent) => cb(payload);
    ipcRenderer.on(IPC.engineLive, listener);
    return () => ipcRenderer.removeListener(IPC.engineLive, listener);
  },
  ui: {
    get: () => ipcRenderer.invoke(IPC.uiGet),
    set: (patch) => ipcRenderer.invoke(IPC.uiSet, patch),
  },
};

contextBridge.exposeInMainWorld('api', api);
