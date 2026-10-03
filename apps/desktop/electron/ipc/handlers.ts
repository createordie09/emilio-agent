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
} from '@emilio/shared';
import type { EngineClient } from '../engine-host';

/** Abstraction du chiffrement (Electron `safeStorage` en production, simulée dans les tests). */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): string; // → base64
  decrypt(b64: string): string;
}

export type HandlerDeps = { engine: EngineClient; cipher: SecretCipher; appInfo: () => unknown };

const KEY_ENC = 'openrouter_key_encrypted';
const KEY_MASK = 'openrouter_key_masked';
const UI_KEY = 'ui_settings';
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

  const handlers = {
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
