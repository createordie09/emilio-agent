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

describe('IPC handlers — cadrage et plan', () => {
  const rec = (devMode = false) => {
    const calls: { method: string; params: unknown }[] = [];
    const engine = {
      async request(method: string, params?: unknown) {
        calls.push({ method, params });
        if (method === 'getSetting')
          return {
            ok: true,
            value: (params as { key: string }).key === 'ui_settings' ? { devMode } : null,
          };
        return { ok: true, value: { id: 'm1' } };
      },
    } as unknown as EngineClient;
    return { engine, calls };
  };
  it('relaie génération, nouvelle version, lecture, édition, déplacement et validation avec leurs paramètres', async () => {
    const { engine, calls } = rec();
    const { handlers } = createHandlers({ engine, cipher: cipher(), appInfo: () => ({}) });
    await handlers[IPC.planGenerate]('m1');
    await handlers[IPC.planRegenerate]('m1', 'Plus de théorie');
    await handlers[IPC.planGet]('m1');
    await handlers[IPC.planUpdateNode]('m1', 'n1', { title: 'T' });
    await handlers[IPC.planAddNode]('m1', { parentId: null, title: 'Nouveau' });
    await handlers[IPC.planMoveNode]('m1', 'n1', 'n2', 3);
    await handlers[IPC.planDeleteNode]('m1', 'n1');
    await handlers[IPC.planSaveMeta]('m1', { problematiqueChoisie: 'Q ?' });
    await handlers[IPC.planValidate]('m1');
    expect(calls.map((c) => c.method)).toEqual([
      'generatePlan',
      'regeneratePlan',
      'getPlan',
      'updatePlanNode',
      'addPlanNode',
      'movePlanNode',
      'deletePlanNode',
      'savePlanMeta',
      'validatePlan',
    ]);
    expect(calls[1]!.params).toEqual({ id: 'm1', comment: 'Plus de théorie' });
    expect(calls[5]!.params).toEqual({ id: 'm1', nodeId: 'n1', parentId: 'n2', index: 3 });
  });
  it('le mode simulé d’une mission est réservé au mode développeur', async () => {
    const off = rec(false);
    const h1 = createHandlers({
      engine: off.engine,
      cipher: cipher(),
      appInfo: () => ({}),
    }).handlers;
    expect(await h1[IPC.missionsSetSimulated]('m1', true)).toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    expect(off.calls.some((c) => c.method === 'setLlmMode')).toBe(false);
    const on = rec(true);
    const h2 = createHandlers({
      engine: on.engine,
      cipher: cipher(),
      appInfo: () => ({}),
    }).handlers;
    expect(await h2[IPC.missionsSetSimulated]('m1', true)).toMatchObject({ ok: true });
    expect(on.calls.find((c) => c.method === 'setLlmMode')!.params).toEqual({
      id: 'm1',
      simulated: true,
    });
  });
});

describe('IPC handlers — sources documentaires', () => {
  const setup = (dev: boolean, available = true) => {
    const store = new Map<string, unknown>();
    const keys = new Map<string, string | null>();
    const engine = {
      async request(method: string, params?: unknown) {
        const p = (params ?? {}) as Record<string, unknown>;
        if (method === 'getSetting')
          return {
            ok: true,
            value: store.get(String(p.key)) ?? (p.key === 'ui_settings' ? { devMode: dev } : null),
          };
        if (method === 'setSetting') {
          store.set(String(p.key), p.value);
          return { ok: true, value: null };
        }
        if (method === 'deleteSetting') {
          store.delete(String(p.key));
          return { ok: true, value: null };
        }
        if (method === 'setSourceKey') {
          keys.set(String(p.connector), (p.key as string | null) ?? null);
          return { ok: true, value: null };
        }
        if (method === 'getSourcesConfig')
          return { ok: true, value: { contactEmail: '', connectors: [], masks: p.masks } };
        return { ok: true, value: { method, params } };
      },
    } as unknown as EngineClient;
    return {
      engine,
      store,
      keys,
      ...createHandlers({ engine, cipher: cipher(available), appInfo: () => ({}) }),
    };
  };

  it('clé de Semantic Scholar / CORE : chiffrée, masquée, transmise au moteur ; autres services refusés', async () => {
    const { handlers, store, keys } = setup(false);
    const r = await handlers[IPC.sourcesSaveKey]('core', 'core-secret-key-1234567890');
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify([...store.values()])).not.toContain('core-secret-key-1234567890');
    expect(store.get('source_key_masked:core')).toBe('core-sec…7890');
    expect(keys.get('core')).toBe('core-secret-key-1234567890');
    expect(JSON.stringify(r)).not.toContain('secret-key');
    expect(await handlers[IPC.sourcesSaveKey]('openalex', 'x')).toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    await handlers[IPC.sourcesRemoveKey]('core');
    expect(keys.get('core')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('refuse d’enregistrer une clé sans chiffrement disponible', async () => {
    const { handlers, store } = setup(false, false);
    expect(await handlers[IPC.sourcesSaveKey]('core', 'abc')).toMatchObject({
      ok: false,
      error: { code: 'E_KEY_STORAGE' },
    });
    expect(store.size).toBe(0);
  });

  it('restaure les clés de sources au démarrage du moteur', async () => {
    const { handlers, keys, restoreKey } = setup(false);
    await handlers[IPC.sourcesSaveKey]('semantic_scholar', 'cle-s2-0123456789abcd');
    keys.clear();
    await restoreKey();
    expect(keys.get('semantic_scholar')).toBe('cle-s2-0123456789abcd');
  });

  it('la recherche de démonstration est réservée au mode développeur', async () => {
    expect(await setup(false).handlers[IPC.sourcesDemoResearch]('m1')).toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    expect(await setup(true).handlers[IPC.sourcesDemoResearch]('m1')).toMatchObject({ ok: true });
  });
});
