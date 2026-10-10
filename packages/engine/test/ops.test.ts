import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import type { CostsView, ExportOverview, MissionArchiveInfo, AppPrefs } from '@emilio/shared';
import { runMigrations } from '../src/storage/db';
import { SettingsRepo } from '../src/storage/settings';
import {
  OpenRouterClient,
  DEFAULT_OPENROUTER_CONFIG,
  PRIVACY_DENY_KEY,
  type FetchLike,
} from '../src/llm/openrouter';
import {
  shrinkLongest,
  EngineService,
  HashEmbedder,
  MockLlmClient,
  FileLogger,
  ModelCaller,
  DEFAULT_MAX_OUTPUT_TOKENS,
  TRUNCATED,
} from '../src';
import { AppError } from '@emilio/shared';
import { runMission, ask, RES } from './pipeline';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(handler: FetchLike) {
  const db = new Database(':memory:');
  runMigrations(db);
  const settings = new SettingsRepo(db);
  settings.set('openrouter_key_encrypted', 'x');
  const calls: { body: Record<string, unknown> }[] = [];
  const c = new OpenRouterClient(
    settings,
    async (url, init) => {
      calls.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return handler(url, init);
    },
    { ...DEFAULT_OPENROUTER_CONFIG, baseUrl: 'http://test/api/v1', retryBaseMs: 1 },
    () => 1,
    async () => {},
  );
  c.setApiKey?.('sk-or-v1-test');
  return { c, calls, settings };
}

describe('confidentialité OpenRouter (§19) et dépassement de contexte (§20)', () => {
  const ok = () =>
    json({
      id: 'g',
      model: 'a/b',
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
    });
  const req = {
    model: 'a/b',
    messages: [{ role: 'user' as const, content: 'x' }],
    jsonSchema: { name: 's', schema: {} },
  };

  it('data_collection: "deny" seulement si l’utilisateur le demande, require_parameters conservé', async () => {
    const a = client(async () => ok());
    await a.c.complete(req);
    expect((a.calls[0]!.body.provider as Record<string, unknown>).data_collection).toBeUndefined();
    const b = client(async () => ok());
    b.settings.set(PRIVACY_DENY_KEY, true);
    await b.c.complete(req);
    expect(b.calls[0]!.body.provider).toEqual({
      require_parameters: true,
      data_collection: 'deny',
    });
  });

  it('une erreur 400 « context length » devient E_CONTEXT_OVERFLOW', async () => {
    const a = client(async () =>
      json({ error: { message: 'maximum context length is 8192 tokens' } }, 400),
    );
    await expect(a.c.complete(req)).rejects.toMatchObject({ code: 'E_CONTEXT_OVERFLOW' });
    const b = client(async () => json({ error: { message: 'bad parameter' } }, 400));
    await expect(b.c.complete(req)).rejects.toMatchObject({ code: 'E_BAD_REQUEST' });
  });

  it('shrinkLongest retire le milieu du plus long message et garde début et fin', () => {
    const long = `DEBUT-${'x'.repeat(10_000)}-FIN`;
    const out = shrinkLongest([
      { role: 'system', content: long },
      { role: 'user', content: 'court' },
    ]);
    expect(out[0]!.content.length).toBeLessThan(long.length * 0.7);
    expect(out[0]!.content.startsWith('DEBUT-')).toBe(true);
    expect(out[0]!.content.endsWith('-FIN')).toBe(true);
    expect(out[1]!.content).toBe('court');
  });
});

describe('préférences et journal fichier', () => {
  it('valeurs par défaut, modification, persistance', async () => {
    const { engine } = await runMission({ withExport: false });
    const p = await ask<AppPrefs>(engine, 'getPrefs', {});
    expect(p).toMatchObject({
      autoResumeMissions: true,
      notifications: true,
      denyDataCollection: false,
      onboardingDone: false,
    });
    const q = await ask<AppPrefs>(engine, 'setPrefs', {
      patch: { denyDataCollection: true, onboardingDone: true },
    });
    expect(q.denyDataCollection).toBe(true);
    expect(engine.settings.get<boolean>(PRIVACY_DENY_KEY)).toBe(true);
  }, 60_000);

  it('journal rotatif : rotation à la taille limite, un nombre borné de fichiers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emilio-log-'));
    const l = new FileLogger(dir, 200, 2);
    for (let i = 0; i < 60; i++) l.line('info', `ligne numéro ${i} avec du texte pour remplir`);
    expect(existsSync(join(dir, 'emilio.log'))).toBe(true);
    expect(existsSync(join(dir, 'emilio.log.1'))).toBe(true);
    expect(existsSync(join(dir, 'emilio.log.3'))).toBe(false);
  });
});

describe('coûts, journaux et archives de mission (J9)', () => {
  it('coûts par phase, rôle et modèle ; journal technique sans contenu ; zip des journaux', async () => {
    const { engine, id } = await runMission({ withJury: true, withExport: true });
    const c = await ask<CostsView>(engine, 'getCosts', { id });
    expect(c.totalUsd).toBeGreaterThan(0);
    expect(c.byPhase.map((x) => x.key)).toEqual(expect.arrayContaining(['P3', 'P5']));
    expect(c.byRole.length).toBeGreaterThan(2);
    expect(c.byModel.length).toBeGreaterThan(0);
    const sum = c.byPhase.reduce((s, x) => s + x.costUsd, 0);
    expect(sum).toBeCloseTo(c.totalUsd, 3);
    const log = await ask<{ model: string }[]>(engine, 'getTechLog', { id });
    expect(log.length).toBeGreaterThan(5);
    expect(JSON.stringify(log)).not.toMatch(/sk-or-/);
    const dest = join(mkdtempSync(join(tmpdir(), 'emilio-z-')), 'logs.zip');
    await ask(engine, 'exportLogsData', { destPath: dest });
    const z = unzipSync(new Uint8Array(readFileSync(dest)));
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['info.json']));
    expect(Object.keys(z).some((k) => k.startsWith('logs/emilio.log'))).toBe(true);
  }, 120_000);

  it('export puis import dans une autre installation : mission, livrables, index de recherche ; refus d’un doublon', async () => {
    const { engine, id } = await runMission({
      withExport: true,
      brief: {
        livrables: {
          docx: true,
          pdf: false,
          pptx: false,
          fichePreparation: false,
          rapportMission: true,
        },
      },
    });
    const dir = mkdtempSync(join(tmpdir(), 'emilio-arch-'));
    const dest = join(dir, 'mission.emilio');
    const info = await ask<MissionArchiveInfo>(engine, 'exportMissionData', { id, destPath: dest });
    expect(info.files).toBeGreaterThan(0);

    const other = new EngineService({
      dbPath: join(dir, 'b.db'),
      dataDir: dir,
      embedder: new HashEmbedder(),
      mock: new MockLlmClient({ delayMs: 0 }),
      resourcesDir: RES,
      normsProfilesPath: join(RES, 'norms-profiles.json'),
    });
    const imp = await ask<MissionArchiveInfo>(other, 'importMissionData', { srcPath: dest });
    expect(imp.missionId).toBe(id);
    const a = other.store.count(id);
    const b = engine.store.count(id);
    expect(a).toEqual(b);
    const vecs = other.db
      .prepare('SELECT COUNT(*) AS n FROM chunks_vec WHERE mission_id=?')
      .get(id) as { n: number };
    expect(vecs.n).toBe(b.searchable);
    expect(other.missions.status(id)).toBe('completed');
    const ov = await ask<ExportOverview>(other, 'getExports', { id });
    expect(ov.deliverables.map((d) => d.kind)).toEqual(['docx', 'rapport']);
    const f = await ask<{ path: string }>(other, 'getDeliverable', {
      deliverableId: ov.deliverables[0]!.id,
    });
    expect(f.path.startsWith(dir)).toBe(true);
    expect(existsSync(f.path)).toBe(true);
    // Les sections et leurs versions sont là.
    const drafts = other.db.prepare('SELECT COUNT(*) AS n FROM drafts').get() as { n: number };
    expect(drafts.n).toBeGreaterThan(10);
    await expect(other.handle('importMissionData', { srcPath: dest })).resolves.toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    const bad = join(dir, 'pas-une-archive.emilio');
    await import('node:fs').then((fs) => fs.writeFileSync(bad, 'abc'));
    await expect(other.handle('importMissionData', { srcPath: bad })).resolves.toMatchObject({
      ok: false,
      error: { code: 'E_PARSE_FILE' },
    });
  }, 180_000);
});

describe('budget atteint (§8.6)', () => {
  async function budgetPaused() {
    const r = await runMission({
      withExport: true,
      brief: {
        livrables: {
          docx: true,
          pdf: false,
          pptx: true,
          nbDiapos: 15,
          fichePreparation: true,
          rapportMission: true,
        },
        execution: {
          preset: 'equilibre',
          budgetMaxUsd: 0.06,
          parallelism: 3,
          rondesMaxParChapitre: 3,
          rondesMaxGlobales: 2,
          profondeurRecherche: 'normale',
          preferenceSources: 'toutes',
        },
      },
    });
    return r;
  }

  it('relever le budget reprend la mission jusqu’à la fin', async () => {
    const { engine, id, summary } = await budgetPaused();
    expect(summary.status).toBe('paused_budget');
    const bad = await engine.handle('raiseBudget', { id, budgetUsd: 0.01 });
    expect(bad).toMatchObject({ ok: false, error: { code: 'E_BAD_REQUEST' } });
    await ask(engine, 'raiseBudget', { id, budgetUsd: 50 });
    const s = await engine.runner.runUntilSettled(id, 6000);
    expect(s.status).toBe('completed');
  }, 180_000);

  it('finaliser avec l’état actuel : P3–P7 abandonnées, Word produit avec les sections manquantes signalées, diaporama et fiche non produits', async () => {
    const { engine, id, summary } = await budgetPaused();
    expect(summary.status).toBe('paused_budget');
    await ask(engine, 'finalizeNow', { id });
    const s = await engine.runner.runUntilSettled(id, 6000);
    expect(s.status).toBe('completed');
    const ov = await ask<ExportOverview>(engine, 'getExports', { id });
    expect(ov.deliverables.map((d) => d.kind)).toEqual(expect.arrayContaining(['docx', 'rapport']));
    expect(ov.deliverables.map((d) => d.kind)).not.toContain('pptx');
    expect(ov.skipped.map((x) => x.kind).sort()).toEqual(['fiche', 'pptx']);
    expect(ov.skipped[0]!.reasonFr).toMatch(/budget/);
    expect(ov.finalCheck?.items.find((i) => i.id === 'sections')?.status).toBe('avertissement');
    expect(ov.summary?.attention.join(' ')).toMatch(/Section\(s\) non rédigée\(s\)/);
  }, 180_000);
});

describe('modèles de secours (§8.6)', () => {
  it('chaque rôle reçoit en secours les modèles des autres préréglages, jamais son propre modèle', async () => {
    const { engine, id } = await runMission({ withExport: false });
    const cfg = engine.missions.config<{
      models: Record<string, string>;
      fallbackModels?: Record<string, string[]>;
    }>(id);
    // La mission simulée garde la configuration du préréglage choisi.
    expect(cfg.fallbackModels).toBeDefined();
    for (const [role, alts] of Object.entries(cfg.fallbackModels!)) {
      expect(alts.length).toBeGreaterThan(0);
      expect(alts).not.toContain(cfg.models[role]);
      expect(new Set(alts).size).toBe(alts.length);
    }
  }, 60_000);
});

describe('plafond de jetons de sortie (J10)', () => {
  it('chaque appel porte max_tokens (16 000 par défaut) ; une réponse tronquée est retentée une fois avec le double', async () => {
    const { engine, id } = await runMission({ withExport: false });
    const seen: (number | undefined)[] = [];
    const stub = {
      async complete(req: { maxTokens?: number }) {
        seen.push(req.maxTokens);
        if (seen.length === 1) throw new AppError('E_REMOTE', TRUNCATED);
        return {
          content: '{}',
          model: 'a/b',
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0,
          generationId: null,
          latencyMs: 1,
        };
      },
    };
    const caller = new ModelCaller(engine.db, engine.missions, engine.journal, () => stub as never);
    const r = await caller.call({
      missionId: id,
      taskId: null,
      role: 'orchestrator',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(r.content).toBe('{}');
    expect(seen).toEqual([DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS * 2]);
  }, 60_000);

  it('une réponse vide dont la raison est la limite de jetons est signalée comme tronquée', async () => {
    const a = client(async () =>
      json({ choices: [{ finish_reason: 'length', message: { content: null } }], usage: {} }),
    );
    await expect(
      a.c.complete({ model: 'a/b', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 }),
    ).rejects.toMatchObject({ detail: TRUNCATED });
    const b = client(async () =>
      json({ choices: [{ finish_reason: 'stop', message: { content: null } }], usage: {} }),
    );
    await expect(
      b.c.complete({ model: 'a/b', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ detail: 'Réponse vide du modèle' });
  });
});

describe('effort de réflexion (J10)', () => {
  const ok = () =>
    json({
      id: 'g',
      model: 'a/b',
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
    });
  const cache = (supportsReasoning?: boolean) => ({
    fetchedAt: new Date().toISOString(),
    models: [
      {
        id: 'a/b',
        name: 'a',
        contextLength: 1,
        promptPrice: 0,
        completionPrice: 0,
        supportsStructuredOutputs: true,
        supportsJsonMode: true,
        inputModalities: [],
        outputModalities: [],
        ...(supportsReasoning === undefined ? {} : { supportsReasoning }),
      },
    ],
  });
  const req = {
    model: 'a/b',
    messages: [{ role: 'user' as const, content: 'x' }],
    reasoning: { effort: 'low' },
  };

  it('envoyé seulement si le modèle est déclaré compatible', async () => {
    for (const [flag, expected] of [
      [true, { effort: 'low' }],
      [false, undefined],
      [undefined, undefined],
    ] as const) {
      const a = client(async () => ok());
      a.settings.set('openrouter_models_cache', cache(flag));
      await a.c.complete(req);
      expect(a.calls[0]!.body.reasoning, String(flag)).toEqual(expected);
    }
  });

  it('le ModelCaller applique : réglage de la mission > réglage du rôle > défaut', async () => {
    const { engine, id } = await runMission({ withExport: false });
    const seen: Record<string, string | undefined> = {};
    const stub = {
      async complete(r: { reasoning?: { effort: string }; meta?: { role: string } }) {
        seen[r.meta!.role] = r.reasoning?.effort;
        return {
          content: '{}',
          model: 'a/b',
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0,
          generationId: null,
          latencyMs: 1,
        };
      },
    };
    const cfg = engine.missions.config<Record<string, unknown>>(id);
    engine.missions.setConfig(id, { ...cfg, reasoningEffort: { summarizer: 'high' } });
    const caller = new ModelCaller(
      engine.db,
      engine.missions,
      engine.journal,
      () => stub as never,
      () => null,
      undefined,
      {
        maxOutputTokens: 1000,
        reasoning: { default: 'low', roles: { juror_form: 'medium' } },
      },
    );
    for (const role of ['orchestrator', 'juror_form', 'summarizer'] as const)
      await caller.call({
        missionId: id,
        taskId: null,
        role,
        messages: [{ role: 'user', content: 'x' }],
      });
    expect(seen).toEqual({ orchestrator: 'low', juror_form: 'medium', summarizer: 'high' });
  }, 60_000);
});
