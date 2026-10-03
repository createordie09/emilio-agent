import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@emilio/shared/ipc';
import type { EmilioApi } from '@emilio/shared';

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
  ui: {
    get: () => ipcRenderer.invoke(IPC.uiGet),
    set: (patch) => ipcRenderer.invoke(IPC.uiSet, patch),
  },
};

contextBridge.exposeInMainWorld('api', api);
