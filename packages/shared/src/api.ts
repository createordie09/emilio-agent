import type { KeyInfo, KeyStatus, ModelList } from './models';
import type { SerializedError } from './errors';
import type { ThemePreference } from './constants';

export type Result<T> = { ok: true; value: T } | { ok: false; error: SerializedError };

export type AppInfo = {
  name: string;
  version: string;
  platform: string;
  electron: string;
  dev: boolean;
};

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
  ui: {
    get(): Promise<Result<UiSettings>>;
    set(patch: Partial<UiSettings>): Promise<Result<UiSettings>>;
  };
}

export { IPC } from './ipc';

/** Protocole main ↔ moteur (utilityProcess, via parentPort). */
export type EngineMethod =
  'ping' | 'getSetting' | 'setSetting' | 'deleteSetting' | 'setApiKey' | 'testKey' | 'listModels';
export type EngineRequest = { id: number; method: EngineMethod; params?: unknown };
export type EngineResponse = { id: number; result: Result<unknown> };
export type EngineEvent = { event: 'ready' | 'log'; payload?: unknown };
