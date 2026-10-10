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
