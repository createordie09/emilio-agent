import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/storage/db';
import { SettingsRepo } from '../src/storage/settings';
import {
  OpenRouterClient,
  DEFAULT_OPENROUTER_CONFIG,
  maskKey,
  parsePrice,
  normalizeModel,
  type FetchLike,
} from '../src/llm/openrouter';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: FetchLike, now = () => 1_000_000) {
  const db = new Database(':memory:');
  runMigrations(db);
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  const client = new OpenRouterClient(
    new SettingsRepo(db),
    fetchImpl,
    { ...DEFAULT_OPENROUTER_CONFIG, baseUrl: 'http://test/api/v1', retryBaseMs: 1 },
    now,
    async () => {},
  );
  return { client, calls };
}

const RAW = {
  data: [
    {
      id: 'a/b',
      name: 'A B',
      context_length: 1000,
      pricing: { prompt: '0.000001', completion: '0.000002' },
      supported_parameters: ['structured_outputs', 'response_format'],
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    { id: 'router/auto', pricing: { prompt: '-1', completion: '-1' }, supported_parameters: [] },
  ],
};

describe('utilitaires', () => {
  it('masque la clé sans la divulguer', () => {
    const m = maskKey('sk-or-v1-abcdef1234567890wxyz');
    expect(m).toBe('sk-or-v1…wxyz');
    expect(m).not.toContain('1234567890');
    expect(maskKey('court')).toBe('••••');
  });
  it('interprète les prix (négatif = variable)', () => {
    expect(parsePrice('0.5')).toBe(0.5);
    expect(parsePrice('-1')).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
  it('normalise un modèle', () => {
    const m = normalizeModel(RAW.data[0]!);
    expect(m).toMatchObject({
      id: 'a/b',
      supportsStructuredOutputs: true,
      supportsJsonMode: true,
      promptPrice: 0.000001,
    });
  });
});

describe('testKey', () => {
  it('exige une clé', async () => {
    const { client } = setup(async () => json({}));
    await expect(client.testKey()).rejects.toMatchObject({ code: 'E_KEY_MISSING' });
  });

  it('renvoie infos de clé + crédit, avec Authorization et titre', async () => {
    const { client, calls } = setup(async (url) =>
      url.endsWith('/key')
        ? json({
            data: {
              label: 'k',
              limit: null,
              limit_remaining: null,
              usage: 1.5,
              is_free_tier: false,
            },
          })
        : json({ data: { total_credits: 20, total_usage: 5 } }),
    );
    client.setApiKey(' sk-test ');
    const info = await client.testKey();
    expect(info).toMatchObject({ label: 'k', usage: 1.5, accountCreditRemaining: 15, limit: null });
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer sk-test');
    expect(h['X-OpenRouter-Title']).toBe('emilio agent');
  });

  it('ne renvoie jamais un crédit négatif', async () => {
    const { client } = setup(async (url) =>
      url.endsWith('/key')
        ? json({ data: { usage: 9 } })
        : json({ data: { total_credits: 20, total_usage: 20.14 } }),
    );
    client.setApiKey('x');
    expect((await client.testKey()).accountCreditRemaining).toBe(0);
  });

  it('401 → E_KEY_INVALID sans réessai', async () => {
    const { client, calls } = setup(async () => json({}, 401));
    client.setApiKey('x');
    await expect(client.testKey()).rejects.toMatchObject({ code: 'E_KEY_INVALID' });
    expect(calls).toHaveLength(1);
  });

  it('402 → E_NO_CREDIT', async () => {
    const { client } = setup(async () => json({}, 402));
    client.setApiKey('x');
    await expect(client.testKey()).rejects.toMatchObject({ code: 'E_NO_CREDIT' });
  });

  it('réessaie sur 429 puis réussit', async () => {
    let n = 0;
    const { client, calls } = setup(async (url) => {
      if (url.endsWith('/credits')) return json({}, 404);
      return ++n < 3 ? json({}, 429) : json({ data: { usage: 0 } });
    });
    client.setApiKey('x');
    const info = await client.testKey();
    expect(info.accountCreditRemaining).toBeNull(); // /credits indisponible → inconnu
    expect(calls.filter((c) => c.url.endsWith('/key'))).toHaveLength(3);
  });

  it('abandonne après les réessais sur erreur réseau', async () => {
    const { client, calls } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    client.setApiKey('x');
    await expect(client.testKey()).rejects.toMatchObject({ code: 'E_NETWORK' });
    expect(calls).toHaveLength(DEFAULT_OPENROUTER_CONFIG.maxRetries + 1);
  });
});

describe('listModels', () => {
  it('récupère sans authentification puis sert le cache', async () => {
    const { client, calls } = setup(async () => json(RAW));
    client.setApiKey('secret');
    const first = await client.listModels();
    expect(first.fromCache).toBe(false);
    expect(first.models).toHaveLength(2);
    expect(first.models[1]!.promptPrice).toBeNull();
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBeUndefined();
    const second = await client.listModels();
    expect(second.fromCache).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('force le rafraîchissement et expire après 24 h', async () => {
    let t = 1_000_000;
    const { client, calls } = setup(
      async () => json(RAW),
      () => t,
    );
    await client.listModels();
    await client.listModels({ refresh: true });
    expect(calls).toHaveLength(2);
    t += 25 * 3600 * 1000;
    await client.listModels();
    expect(calls).toHaveLength(3);
  });

  it('sert le cache périmé hors ligne, sinon échoue', async () => {
    let t = 1_000_000;
    let offline = false;
    const { client } = setup(
      async () => {
        if (offline) throw new TypeError('offline');
        return json(RAW);
      },
      () => t,
    );
    await expect(
      (async () => {
        offline = true;
        return client.listModels();
      })(),
    ).rejects.toMatchObject({ code: 'E_NETWORK' });
    offline = false;
    await client.listModels();
    t += 48 * 3600 * 1000;
    offline = true;
    const r = await client.listModels();
    expect(r.fromCache).toBe(true);
  });
});
