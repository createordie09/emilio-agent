import type { EmilioApi, KeyInfo, ModelInfo, Result } from '@emilio/shared';

const ok = <T>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true, value });

/** Faux modèles et clé de démonstration — UNIQUEMENT hors Electron (captures, développement du renderer seul). */
function browserMock(): EmilioApi {
  const nope = () =>
    Promise.resolve({
      ok: false as const,
      error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
    });
  const models: ModelInfo[] = [
    {
      id: 'demo/modele-a',
      name: 'Modèle de démonstration A',
      contextLength: 200_000,
      promptPrice: 0.000003,
      completionPrice: 0.000015,
      supportsStructuredOutputs: true,
      supportsJsonMode: true,
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
    {
      id: 'demo/modele-b',
      name: 'Modèle de démonstration B',
      contextLength: 128_000,
      promptPrice: 0.0000002,
      completionPrice: 0.0000008,
      supportsStructuredOutputs: false,
      supportsJsonMode: true,
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
    {
      id: 'demo/modele-c',
      name: 'Modèle de démonstration C',
      contextLength: 1_000_000,
      promptPrice: 0,
      completionPrice: 0,
      supportsStructuredOutputs: true,
      supportsJsonMode: true,
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
  ];
  const info: KeyInfo = {
    label: 'sk-or-v1-demo…',
    limit: null,
    limitRemaining: null,
    usage: 8.97,
    isFreeTier: false,
    accountCreditRemaining: 12.4,
    checkedAt: new Date().toISOString(),
  };
  let ui = { theme: 'systeme' as const, reduceEffects: false, devMode: true };
  let keyed = true;
  return {
    app: {
      info: () =>
        Promise.resolve({
          name: 'emilio agent',
          version: '0.1.0',
          platform: 'navigateur',
          electron: '—',
          dev: true,
        }),
    },
    engine: { ping: () => ok({ ok: true as const, engineVersion: '0.1.0', schemaVersion: 1 }) },
    key: {
      status: () => ok({ configured: keyed, masked: keyed ? 'sk-or-v1…demo' : null }),
      save: () => {
        keyed = true;
        return ok({ configured: true, masked: 'sk-or-v1…demo' });
      },
      test: () => ok(info),
      remove: () => {
        keyed = false;
        return ok({ configured: false, masked: null });
      },
    },
    models: { list: () => ok({ models, fetchedAt: new Date().toISOString(), fromCache: false }) },
    sources: {
      list: () => ok([]),
      get: nope,
      config: () => ok({ contactEmail: '', connectors: [] }),
      saveConfig: nope,
      saveKey: nope,
      removeKey: nope,
      test: () => ok([]),
      demoResearch: nope,
    },
    drafts: {
      list: () => ok([]),
      create: nope,
      get: nope,
      save: nope,
      remove: nope,
      finalize: nope,
    },
    files: { pick: () => ok([]), pathsFor: () => [], add: nope, remove: nope, list: () => ok([]) },
    catalog: { presets: () => ok([]), normsProfiles: () => ok([]) },
    // Missions : non simulées hors Electron (le moteur n'existe pas dans le navigateur).
    missions: {
      list: () => ok([]),
      get: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      createDemo: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      start: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      pause: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      resume: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      cancel: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      retry: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'E_ENGINE' as const, messageFr: 'Moteur indisponible hors Electron.' },
        }),
      simulate: () => ok(null),
      events: () => ok([]),
      setSimulated: nope,
    },
    writing: {
      sections: () => ok([]),
      section: nope,
      analysis: () => ok(null),
      frontMatter: () => ok([]),
    },
    plan: {
      generate: nope,
      regenerate: nope,
      get: nope,
      updateNode: nope,
      addNode: nope,
      deleteNode: nope,
      moveNode: nope,
      saveMeta: nope,
      validate: nope,
    },
    onEvent: () => () => {},
    ui: {
      get: () => ok(ui),
      set: (p) => {
        ui = { ...ui, ...p } as typeof ui;
        return ok(ui);
      },
    },
  };
}

/** Accès à l'API du preload ; repli de démonstration en navigateur seulement. */
export function getApi(): EmilioApi {
  if (typeof window !== 'undefined' && window.api) return window.api;
  if (import.meta.env.DEV) return browserMock();
  throw new Error("L'API de l'application est indisponible.");
}

let cached: EmilioApi | null = null;
export const api = new Proxy({} as EmilioApi, {
  get: (_t, k: keyof EmilioApi) => (cached ??= getApi())[k],
});
