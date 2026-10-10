// Sans aucune dépendance : importé par le preload sandboxé (qui ne peut pas require() de modules tiers).
/** Noms de canaux IPC (main ↔ renderer). */
export const IPC = {
  appInfo: 'app:info',
  enginePing: 'engine:ping',
  keyStatus: 'key:status',
  keySave: 'key:save',
  keyTest: 'key:test',
  keyRemove: 'key:remove',
  modelsList: 'models:list',
  uiGet: 'ui:get',
  uiSet: 'ui:set',
} as const;
