import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { AppError } from '@emilio/shared';
import {
  runMigrations,
  SettingsRepo,
  OpenRouterClient,
  DEFAULT_OPENROUTER_CONFIG,
  mapHttpError,
  extractJson,
  MockLlmClient,
  ModelCaller,
  MissionRepo,
  EventJournal,
  type FetchLike,
  type LlmClient,
} from '../src';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(handler: FetchLike) {
  const db = new Database(':memory:');
  runMigrations(db);
  const calls: { url: string; init?: RequestInit }[] = [];
  const c = new OpenRouterClient(
    new SettingsRepo(db),
    async (u, i) => (calls.push({ url: u, init: i }), handler(u, i)),
    {
      ...DEFAULT_OPENROUTER_CONFIG,
      baseUrl: 'http://t/v1',
      retryBaseMs: 1,
      retryMaxMs: 2,
      chatMaxRetries: 2,
    },
    Date.now,
    async () => {},
  );
  c.setApiKey('k');
  return { c, calls };
}

const OK = {
  id: 'gen-1',
  model: 'x/y',
  choices: [{ message: { content: '{"a":1}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 },
};

describe('OpenRouterClient.complete (CdC §14.1)', () => {
  it('envoie response_format json_schema + require_parameters et lit usage.cost', async () => {
    const { c, calls } = client(async () => json(OK));
    const r = await c.complete({
      model: 'x/y',
      messages: [{ role: 'user', content: 'salut' }],
      temperature: 0.2,
      maxTokens: 100,
      jsonSchema: { name: 's', schema: { type: 'object' } },
    });
    expect(r).toMatchObject({
      content: '{"a":1}',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 0.0042,
      generationId: 'gen-1',
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({
      model: 'x/y',
      temperature: 0.2,
      max_tokens: 100,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 's', strict: true, schema: { type: 'object' } },
      },
      provider: { require_parameters: true },
    });
    expect(calls[0]!.url).toBe('http://t/v1/chat/completions');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it("n'impose pas require_parameters sans schéma, et coût inconnu → null", async () => {
    const { c, calls } = client(async () =>
      json({ ...OK, usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    );
    const r = await c.complete({ model: 'x/y', messages: [] });
    expect(r.costUsd).toBeNull();
    expect(JSON.parse(calls[0]!.init!.body as string).provider).toBeUndefined();
  });

  it('402 → E_NO_CREDIT et 400 → E_BAD_REQUEST, sans réessai', async () => {
    for (const [status, code] of [
      [402, 'E_NO_CREDIT'],
      [400, 'E_BAD_REQUEST'],
      [401, 'E_KEY_INVALID'],
    ] as const) {
      const { c, calls } = client(async () => json({}, status));
      await expect(c.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(1);
    }
  });

  it('réessaie 429 / 5xx puis réussit ; 503 persistant → E_MODEL_UNAVAILABLE', async () => {
    let n = 0;
    const a = client(async () => (++n < 3 ? json({}, 429) : json(OK)));
    expect((await a.c.complete({ model: 'm', messages: [] })).content).toBe('{"a":1}');
    expect(a.calls).toHaveLength(3);
    const b = client(async () => json({}, 503));
    await expect(b.c.complete({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'E_MODEL_UNAVAILABLE',
    });
    expect(b.calls).toHaveLength(3); // 1 essai + 2 réessais
  });

  it('erreur réseau persistante → E_NETWORK ; clé absente → E_KEY_MISSING', async () => {
    const { c } = client(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(c.complete({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'E_NETWORK',
    });
    c.setApiKey(null);
    await expect(c.complete({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'E_KEY_MISSING',
    });
  });

  it('erreur dans un corps 200, réponse vide, interruption', async () => {
    const a = client(async () => json({ error: { code: 402, message: 'x' } }));
    await expect(a.c.complete({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'E_NO_CREDIT',
    });
    const b = client(async () => json({ choices: [{ message: { content: '' } }] }));
    await expect(b.c.complete({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'E_REMOTE',
    });
    const ac = new AbortController();
    ac.abort();
    const d = client(async () => json(OK));
    await expect(
      d.c.complete({ model: 'm', messages: [], signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('mapHttpError couvre la table §20', () => {
    const m = (s: number) => mapHttpError(s).code;
    expect([m(401), m(402), m(429), m(404), m(503), m(500), m(408)]).toEqual([
      'E_KEY_INVALID',
      'E_NO_CREDIT',
      'E_RATE_LIMIT',
      'E_MODEL_UNAVAILABLE',
      'E_MODEL_UNAVAILABLE',
      'E_REMOTE',
      'E_NETWORK',
    ]);
  });
});

describe('extractJson', () => {
  it('accepte du JSON brut, des blocs ``` et du texte autour', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Voici :\n```json\n{"a":{"b":"}"}}\n```\nfin')).toEqual({ a: { b: '}' } });
    expect(extractJson('blabla {"x":"a \\" b"} blabla')).toEqual({ x: 'a " b' });
    expect(() => extractJson('rien')).toThrow();
    expect(() => extractJson('{"a":')).toThrow();
  });
});

describe('ModelCaller', () => {
  const setup = (
    client: LlmClient,
    cfg: object,
    prices?: (m: string) => { prompt: number; completion: number } | null,
  ) => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const journal = new EventJournal(db);
    const missions = new MissionRepo(db, journal);
    const id = missions.create({ title: 'm', config: cfg });
    const caller = new ModelCaller(db, missions, journal, () => client, prices);
    return { db, missions, id, caller };
  };
  const base = { llmMode: 'mock', models: { researcher: 'a/b' }, budgetMaxUsd: 1, parallelism: 3 };

  it('calcule le coût via la grille de prix quand usage.cost est absent', async () => {
    const fake: LlmClient = {
      complete: async () => ({
        content: '{}',
        model: 'a/b',
        promptTokens: 1000,
        completionTokens: 500,
        costUsd: null,
        generationId: null,
        latencyMs: 1,
      }),
    };
    const { caller, id, missions } = setup(fake, base, () => ({
      prompt: 0.000001,
      completion: 0.000002,
    }));
    const r = await caller.call({ missionId: id, taskId: null, role: 'researcher', messages: [] });
    expect(r.costUsd).toBeCloseTo(0.002, 9);
    expect(missions.costSpent(id)).toBeCloseTo(0.002, 9);
  });

  it('refuse un rôle sans modèle configuré (jamais de modèle par défaut codé en dur)', async () => {
    const { caller, id } = setup(new MockLlmClient(), base);
    await expect(
      caller.call({ missionId: id, taskId: null, role: 'section_writer', messages: [] }),
    ).rejects.toMatchObject({ code: 'E_BAD_REQUEST' });
  });

  it('refuse l’appel qui dépasserait le budget, sans appeler le modèle', async () => {
    const mock = new MockLlmClient();
    const { caller, id } = setup(mock, { ...base, budgetMaxUsd: 0.001, estimateCallUsd: 0.002 });
    await expect(
      caller.call({ missionId: id, taskId: null, role: 'researcher', messages: [] }),
    ).rejects.toMatchObject({ code: 'E_BUDGET' });
    expect(mock.calls).toHaveLength(0);
  });

  it('journalise chaque appel dans llm_calls (succès et erreurs)', async () => {
    const mock = new MockLlmClient({ costPerCallUsd: 0.01 });
    const { caller, id, db } = setup(mock, base);
    await caller.call({
      missionId: id,
      taskId: null,
      role: 'researcher',
      messages: [],
      promptVersion: 'v1',
    });
    mock.failNext(new AppError('E_RATE_LIMIT'));
    await expect(
      caller.call({ missionId: id, taskId: null, role: 'researcher', messages: [] }),
    ).rejects.toBeInstanceOf(AppError);
    const rows = db
      .prepare(
        'SELECT status_code, error, prompt_version, cost_usd FROM llm_calls ORDER BY created_at',
      )
      .all();
    expect(rows).toEqual([
      { status_code: 200, error: null, prompt_version: 'v1', cost_usd: 0.01 },
      { status_code: null, error: 'E_RATE_LIMIT', prompt_version: null, cost_usd: null },
    ]);
  });
});
