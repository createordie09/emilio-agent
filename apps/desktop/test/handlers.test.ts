// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { IPC, type EngineMethod, type Result } from '@emilio/shared';
import { createHandlers, type SecretCipher } from '../electron/ipc/handlers';
import type { EngineClient } from '../electron/engine-host';

function fakeEngine() {
  const store = new Map<string, unknown>();
  let apiKey: string | null = null;
  const engine: EngineClient & { store: typeof store; key: () => string | null } = {
    store,
    key: () => apiKey,
    async request<T>(method: EngineMethod, params?: unknown): Promise<Result<T>> {
      const p = (params ?? {}) as Record<string, unknown>;
      switch (method) {
        case 'getSetting':
          return { ok: true, value: (store.get(String(p.key)) ?? null) as T };
        case 'setSetting':
          store.set(String(p.key), p.value);
          return { ok: true, value: null as T };
        case 'deleteSetting':
          store.delete(String(p.key));
          return { ok: true, value: null as T };
        case 'setApiKey':
          apiKey = (p.key as string | null) ?? null;
          return { ok: true, value: null as T };
        default:
          return { ok: false, error: { code: 'E_INTERNAL', messageFr: 'x' } };
      }
    },
  };
  return engine;
}

const cipher = (available = true): SecretCipher => ({
  isAvailable: () => available,
  encrypt: (s) => Buffer.from(`ENC:${s}`).toString('base64'),
  decrypt: (b) => Buffer.from(b, 'base64').toString().replace('ENC:', ''),
});

describe('IPC handlers — clé OpenRouter', () => {
  const KEY = 'sk-or-v1-abcdef1234567890wxyz';

  it('chiffre la clé, ne stocke jamais le clair, ne renvoie que la version masquée', async () => {
    const engine = fakeEngine();
    const { handlers } = createHandlers({ engine, cipher: cipher(), appInfo: () => ({}) });
    const r = await handlers[IPC.keySave](KEY);
    expect(r).toEqual({ ok: true, value: { configured: true, masked: 'sk-or-v1…wxyz' } });
    expect(JSON.stringify([...engine.store.values()])).not.toContain('1234567890');
    expect(engine.store.get('openrouter_key_encrypted')).toBeTruthy();
    expect(engine.key()).toBe(KEY);
    expect(JSON.stringify(r)).not.toContain('1234567890');
  });

  it('refuse de stocker si le chiffrement est indisponible', async () => {
    const engine = fakeEngine();
    const { handlers } = createHandlers({ engine, cipher: cipher(false), appInfo: () => ({}) });
    const r = await handlers[IPC.keySave](KEY);
    expect(r).toMatchObject({ ok: false, error: { code: 'E_KEY_STORAGE' } });
    expect(engine.store.size).toBe(0);
  });

  it('rejette une clé vide', async () => {
    const { handlers } = createHandlers({
      engine: fakeEngine(),
      cipher: cipher(),
      appInfo: () => ({}),
    });
    expect(await handlers[IPC.keySave]('  ')).toMatchObject({
      ok: false,
      error: { code: 'E_KEY_MISSING' },
    });
  });

  it('restaure la clé au démarrage du moteur', async () => {
    const engine = fakeEngine();
    const h1 = createHandlers({ engine, cipher: cipher(), appInfo: () => ({}) });
    await h1.handlers[IPC.keySave](KEY);
    await engine.request('setApiKey', { key: null });
    await h1.restoreKey();
    expect(engine.key()).toBe(KEY);
  });

  it('supprime la clé partout', async () => {
    const engine = fakeEngine();
    const { handlers } = createHandlers({ engine, cipher: cipher(), appInfo: () => ({}) });
    await handlers[IPC.keySave](KEY);
    expect(await handlers[IPC.keyRemove]()).toEqual({
      ok: true,
      value: { configured: false, masked: null },
    });
    expect(engine.store.size).toBe(0);
    expect(engine.key()).toBeNull();
  });
});

describe('IPC handlers — préférences UI', () => {
  it('valeurs par défaut puis mise à jour validée', async () => {
    const { handlers } = createHandlers({
      engine: fakeEngine(),
      cipher: cipher(),
      appInfo: () => ({}),
    });
    expect(await handlers[IPC.uiGet]()).toEqual({
      ok: true,
      value: { theme: 'systeme', reduceEffects: false, devMode: false },
    });
    expect(await handlers[IPC.uiSet]({ theme: 'sombre' })).toEqual({
      ok: true,
      value: { theme: 'sombre', reduceEffects: false, devMode: false },
    });
    // @ts-expect-error valeur invalide ignorée
    expect(await handlers[IPC.uiSet]({ theme: 'rose', reduceEffects: true })).toEqual({
      ok: true,
      value: { theme: 'sombre', reduceEffects: true, devMode: false },
    });
  });
});

describe('IPC handlers — missions', () => {
  const recorder = () => {
    const calls: { method: string; params: unknown }[] = [];
    const engine = {
      async request(method: string, params?: unknown) {
        calls.push({ method, params });
        if (method === 'getSetting')
          return {
            ok: true,
            value: (params as { key: string }).key === 'ui_settings' ? { devMode: devMode } : null,
          };
        return { ok: true, value: { id: 'm1' } };
      },
    } as unknown as EngineClient;
    return { engine, calls };
  };
  let devMode = false;

  it('relaie pause / reprise / annulation / réessai au moteur avec l’identifiant', async () => {
    const { engine, calls } = recorder();
    const { handlers } = createHandlers({ engine, cipher: cipher(), appInfo: () => ({}) });
    await handlers[IPC.missionsPause]('m1');
    await handlers[IPC.missionsResume]('m1');
    await handlers[IPC.missionsCancel]('m1');
    await handlers[IPC.missionsRetry]('m1');
    expect(calls.map((c) => c.method)).toEqual([
      'pauseMission',
      'resumeMission',
      'cancelMission',
      'retryMission',
    ]);
    expect(calls.every((c) => (c.params as { id: string }).id === 'm1')).toBe(true);
  });

  it('mission factice et pannes simulées : refusées hors mode développeur', async () => {
    devMode = false;
    const { engine, calls } = recorder();
    const { handlers } = createHandlers({ engine, cipher: cipher(), appInfo: () => ({}) });
    expect(await handlers[IPC.missionsCreateDemo]()).toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    expect(await handlers[IPC.missionsSimulate]('no_credit')).toMatchObject({ ok: false });
    expect(calls.some((c) => c.method === 'createDemoMission' || c.method === 'simulate')).toBe(
      false,
    );
    devMode = true;
    expect(await handlers[IPC.missionsCreateDemo]()).toMatchObject({ ok: true });
    expect(await handlers[IPC.missionsSimulate]('no_credit')).toMatchObject({ ok: true });
  });
});
