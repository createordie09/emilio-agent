import { describe, it, expect } from 'vitest';
import { AppError, MISSION_STATUSES, type MissionStatus } from '@emilio/shared';
import {
  TRANSITIONS,
  canTransition,
  MockLlmClient,
  SqliteQueue,
  createDemoMission,
  demoTasks,
  EngineService,
} from '../src';
import { mkEngine, tmpDb, llmCalls, eventsOf, cfgOf } from './helpers';

describe('machine à états (§8.1)', () => {
  it('chaque couple (de, vers) est autorisé exactement selon la table', () => {
    for (const from of MISSION_STATUSES)
      for (const to of MISSION_STATUSES)
        expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
  });

  it('refuse les transitions interdites et journalise les autorisées', () => {
    const { engine } = mkEngine();
    const id = engine.missions.create({ title: 'T' });
    expect(() => engine.missions.transition(id, 'completed')).toThrow(AppError);
    expect(() => engine.missions.transition(id, 'running')).toThrow(
      expect.objectContaining({ detail: 'Transition interdite : draft → running' }),
    );
    engine.missions.transition(id, 'briefing');
    expect(engine.journal.list(id).map((e) => e.messageFr)).toContain(
      'Mission préparation du brief.',
    );
    expect(engine.missions.transition(id, 'briefing')).toBe('briefing'); // idempotent
  });

  it("les états terminaux n'ont aucune sortie ; completed ne peut pas être annulé", () => {
    for (const s of ['completed', 'cancelled'] as MissionStatus[])
      expect(TRANSITIONS[s]).toEqual([]);
    expect(canTransition('failed', 'running')).toBe(true); // « Réessayer à partir de cette étape »
  });
});

describe('file de tâches persistante (§8.2)', () => {
  const setup = () => {
    const { engine } = mkEngine();
    const id = engine.missions.create({ title: 'Q' });
    return { engine, id, q: new SqliteQueue(engine.db) };
  };

  it('promeut pending → ready quand les dépendances sont done', () => {
    const { id, q } = setup();
    q.enqueue(id, [
      { key: 'a', phase: 'P0', agentRole: 'local', label: 'a' },
      { key: 'b', phase: 'P1', agentRole: 'orchestrator', label: 'b', dependsOnKeys: ['a'] },
    ]);
    expect(q.counts(id)).toMatchObject({ ready: 1, pending: 1 });
    const [a] = q.claim(id, 5);
    expect(q.claim(id, 5)).toEqual([]); // b n'est pas prête
    q.complete(a!.id, { output: {}, costUsd: 0, tokensIn: 0, tokensOut: 0, model: null });
    expect(q.promote(id)).toBe(1);
    expect(q.claim(id, 5)).toHaveLength(1);
  });

  it('claim : priorité décroissante puis ancienneté, limite respectée, bail posé', () => {
    const { engine, id, q } = setup();
    q.enqueue(id, [
      { key: 'low', phase: 'P0', agentRole: 'local', label: 'low', priority: 0 },
      { key: 'high', phase: 'P0', agentRole: 'local', label: 'high', priority: 5 },
      { key: 'low2', phase: 'P0', agentRole: 'local', label: 'low2', priority: 0 },
    ]);
    const got = q.claim(id, 2).map((t) => t.input.label);
    expect(got).toEqual(['high', 'low']);
    const leases = engine.db
      .prepare("SELECT lease_until FROM tasks WHERE status='running'")
      .all() as { lease_until: string }[];
    expect(leases).toHaveLength(2);
    expect(leases.every((l) => Date.parse(l.lease_until) > Date.now())).toBe(true);
  });

  it("l'insertion est idempotente (clé naturelle)", () => {
    const { id, q } = setup();
    const t = [{ key: 'a', phase: 'P0' as const, agentRole: 'local' as const, label: 'a' }];
    q.enqueue(id, t);
    q.enqueue(id, t);
    expect(Object.values(q.counts(id)).reduce((x, y) => x + y)).toBe(1);
  });

  it('complete ne s’applique qu’une fois ; fail incrémente attempts jusqu’à max_attempts ; release non', () => {
    const { id, q } = setup();
    q.enqueue(id, [{ key: 'a', phase: 'P0', agentRole: 'local', label: 'a', maxAttempts: 2 }]);
    let [t] = q.claim(id, 1);
    q.release(t!.id);
    [t] = q.claim(id, 1);
    expect(t!.attempts).toBe(0); // release n'incrémente pas
    expect(q.fail(t!.id, { x: 1 })).toEqual({ retried: true });
    [t] = q.claim(id, 1);
    expect(t!.attempts).toBe(1);
    expect(q.fail(t!.id, { x: 2 })).toEqual({ retried: false });
    expect(q.counts(id).failed).toBe(1);
    expect(q.retryFailed(id)).toBe(1);
    [t] = q.claim(id, 1);
    expect(t!.attempts).toBe(0);
    expect(
      q.complete(t!.id, { output: 1, costUsd: 0, tokensIn: 0, tokensOut: 0, model: null }),
    ).toBe(true);
    expect(
      q.complete(t!.id, { output: 2, costUsd: 0, tokensIn: 0, tokensOut: 0, model: null }),
    ).toBe(false);
  });

  it('récupère les tâches orphelines : tout au démarrage, seulement les baux expirés ensuite', () => {
    const { engine, id } = setup();
    let now = 1_000_000;
    const q = new SqliteQueue(engine.db, () => now, 1000);
    q.enqueue(id, [
      { key: 'a', phase: 'P0', agentRole: 'local', label: 'a' },
      { key: 'b', phase: 'P0', agentRole: 'local', label: 'b' },
    ]);
    q.claim(id, 2);
    expect(q.recoverOrphans()).toBe(0); // baux encore valides
    now += 5000;
    // les baux sont stockés en ISO réel : on force l'expiration de l'un d'eux
    engine.db
      .prepare(
        "UPDATE tasks SET lease_until='2000-01-01T00:00:00.000Z' WHERE input_json LIKE '%\"a\"%'",
      )
      .run();
    expect(q.recoverOrphans()).toBe(1);
    expect(q.recoverOrphans({ all: true })).toBe(1);
    expect(q.counts(id).ready).toBe(2);
    expect(engine.db.prepare('SELECT MAX(attempts) AS m FROM tasks').get()).toEqual({ m: 0 });
  });
});

describe('mission factice de bout en bout (mode simulé)', () => {
  it('traverse draft → … → completed, P0 → P9, avec checkpoints, coûts et événements en français', async () => {
    const { engine, mock } = mkEngine({
      mock: new MockLlmClient({ delayMs: 15, costPerCallUsd: 0.002 }),
    });
    const id = createDemoMission(engine);
    expect(engine.missions.status(id)).toBe('awaiting_plan_validation');
    engine.runner.start(id);
    const s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    expect(s.tasksDone).toBe(demoTasks().length);
    expect(s.currentPhase).toBe('P9'); // dernière phase atteinte
    expect(s.costSpentUsd).toBeCloseTo(0.03, 6); // 15 appels × 0,002 $
    expect(mock.maxConcurrent).toBe(3); // parallélisme par défaut
    expect(llmCalls(engine)).toBe(15);
    expect(engine.checkpoints.count(id)).toBe(9); // P0 P1 P2 P3 P5 P6 P7 P8 P9
    expect(engine.checkpoints.latest(id)).toMatchObject({
      phase: 'P9',
      tasksDone: 16,
      tasksTotal: 16,
    });
    const ev = eventsOf(engine, id);
    expect(ev).toContain('Mission terminée.');
    expect(ev.some((m) => /Phase P3 terminée/.test(m))).toBe(true);
    expect(
      ev.some((m) => /Rédacteur académique : « Rédaction — chapitre 1 » terminé\./.test(m)),
    ).toBe(true);
    // chaque tâche terminée une seule fois
    expect(ev.filter((m) => m.includes('« Jury — forme » terminé'))).toHaveLength(1);
    await engine.close();
  });

  it('respecte les dépendances : aucune rédaction avant la fin de la recherche correspondante', async () => {
    const { engine, mock } = mkEngine();
    const id = createDemoMission(engine, { parallelism: 8 });
    engine.runner.start(id);
    await engine.runner.runUntilSettled(id);
    const order = mock.calls.map((c) => c.meta?.label);
    for (const i of [1, 2, 3]) {
      expect(order.indexOf(`Recherche — chapitre ${i}`)).toBeLessThan(
        order.indexOf(`Rédaction — chapitre ${i}`),
      );
    }
    expect(order.indexOf('Synthèse du jury')).toBeGreaterThan(order.indexOf('Jury — forme'));
    expect(order.at(-1)).toBe('Préparation de la soutenance');
    await engine.close();
  });

  it('diffuse les événements et mises à jour en direct', async () => {
    const { engine } = mkEngine();
    const seen: string[] = [];
    engine.onLive((e) => seen.push(e.kind));
    const id = createDemoMission(engine);
    engine.runner.start(id);
    await engine.runner.runUntilSettled(id);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toContain('mission.event');
    expect(seen).toContain('mission.updated');
    await engine.close();
  });
});

describe('reprise après crash (§8.6, critère 5)', () => {
  it('relance les tâches orphelines sans perte, sans doublon et sans pénalité', async () => {
    const dbPath = tmpDb();
    const a = mkEngine({ dbPath, mock: new MockLlmClient({ delayMs: 40, costPerCallUsd: 0.002 }) });
    const id = createDemoMission(a.engine);
    a.engine.runner.start(id);
    // laisse démarrer plusieurs tâches puis « coupe le courant »
    for (let i = 0; i < 60; i++) {
      await a.engine.runner.tick();
      const c = a.engine.queue.counts(id);
      if (c.done >= 3 && c.running > 0) break;
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(a.engine.queue.counts(id).running).toBeGreaterThan(0);
    const doneBefore = a.engine.queue.counts(id).done;
    await a.engine.runner.crashForTest();
    expect(a.engine.queue.counts(id).running).toBeGreaterThan(0); // orphelines restées en base

    // redémarrage : nouveau moteur sur la même base
    const b = mkEngine({ dbPath });
    const rec = b.engine.runner.recoverOnStart();
    expect(rec.orphans).toBeGreaterThan(0);
    expect(rec.resumed).toEqual([id]);
    expect(eventsOf(b.engine, id).some((m) => /Mission reprise après redémarrage/.test(m))).toBe(
      true,
    );
    const s = await b.engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    expect(s.tasksDone).toBe(16);
    // aucun travail perdu ni refait : les tâches déjà faites ne sont pas rappelées
    expect(llmCalls(b.engine)).toBe(15);
    expect(b.mock.calls.length).toBeLessThanOrEqual(15 - doneBefore + 1);
    expect(b.engine.db.prepare('SELECT MAX(attempts) AS m FROM tasks').get()).toEqual({ m: 0 });
    const ev = eventsOf(b.engine, id);
    for (const label of ['Cadrage de la mission', 'Proposition du plan'])
      expect(ev.filter((m) => m.includes(`« ${label} » terminé`))).toHaveLength(1);
    await b.engine.close();
  });

  it('option « ne pas reprendre automatiquement » : la mission est mise en pause au redémarrage', async () => {
    const dbPath = tmpDb();
    const a = mkEngine({ dbPath });
    const id = createDemoMission(a.engine);
    a.engine.runner.start(id);
    const b = mkEngine({ dbPath, runner: { autoResumeOnStart: false } });
    expect(b.engine.runner.recoverOnStart().resumed).toEqual([]);
    expect(b.engine.missions.status(id)).toBe('paused');
  });
});

describe('interruptions (§8.6, §20)', () => {
  it('crédit épuisé : pause sans pénalité, reprise automatique après rechargement (critère 6)', async () => {
    const { engine, mock } = mkEngine();
    const id = createDemoMission(engine);
    mock.creditExhausted = true;
    engine.runner.start(id);
    const s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('paused_no_credit');
    expect(eventsOf(engine, id).some((m) => /Crédit OpenRouter épuisé/.test(m))).toBe(true);
    expect(engine.db.prepare('SELECT MAX(attempts) AS m FROM tasks').get()).toEqual({ m: 0 });
    expect(engine.queue.counts(id).running).toBe(0); // la tâche en cours est repassée ready
    expect(await engine.runner.checkAutoResume()).toEqual([]); // toujours épuisé
    mock.creditExhausted = false;
    expect(await engine.runner.checkAutoResume()).toEqual([id]);
    expect((await engine.runner.runUntilSettled(id)).status).toBe('completed');
    await engine.close();
  });

  it('coupure réseau : retries puis paused_network, reprise automatique au retour du réseau', async () => {
    const { engine, mock } = mkEngine();
    const id = createDemoMission(engine);
    mock.offline = true;
    engine.runner.start(id);
    let s = await engine.runner.runUntilSettled(id, 4000);
    expect(s.status).toBe('paused_network');
    expect(eventsOf(engine, id).some((m) => /Connexion Internet perdue/.test(m))).toBe(true);
    expect(engine.db.prepare('SELECT MAX(attempts) AS m FROM tasks').get()).toEqual({ m: 0 });
    mock.offline = false;
    expect(await engine.runner.checkAutoResume()).toEqual([id]);
    s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    await engine.close();
  });

  it('budget : alertes 50 / 80 / 95 % une seule fois, pause, reprise après relèvement du budget', async () => {
    const { engine } = mkEngine();
    const id = createDemoMission(engine, { budgetUsd: 0.01 });
    engine.runner.start(id);
    let s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('paused_budget');
    const ev = eventsOf(engine, id);
    for (const th of [50, 80, 95])
      expect(ev.filter((m) => m.startsWith(`Budget utilisé à ${th} %`))).toHaveLength(1);
    expect(s.costSpentUsd).toBeLessThanOrEqual(0.01 + 1e-9);
    engine.missions.setConfig(id, { ...cfgOf(engine, id), budgetMaxUsd: 5 });
    engine.runner.resume(id);
    s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    await engine.close();
  });

  it('clé invalide (401) : pause avec renvoi vers les Paramètres', async () => {
    const { engine, mock } = mkEngine();
    const id = createDemoMission(engine);
    mock.failNext(new AppError('E_KEY_INVALID'));
    engine.runner.start(id);
    const s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('paused');
    expect(eventsOf(engine, id).some((m) => /invalide.*Paramètres/.test(m))).toBe(true);
    await engine.close();
  });

  it('limite de débit (429) répétée : parallélisme ramené à 1', async () => {
    const { engine, mock } = mkEngine();
    const id = createDemoMission(engine, { parallelism: 4 });
    const rl = () => new AppError('E_RATE_LIMIT');
    mock.failNext(rl(), rl(), rl());
    engine.runner.start(id);
    const s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    expect(eventsOf(engine, id).some((m) => /un seul agent à la fois/.test(m))).toBe(true);
    await engine.close();
  });

  it('modèle indisponible : bascule sur le modèle de secours avec avertissement', async () => {
    const { engine, mock } = mkEngine();
    const id = createDemoMission(engine);
    const c = cfgOf(engine, id);
    engine.missions.setConfig(id, { ...c, fallbackModels: { orchestrator: ['simule/secours'] } });
    mock.failNext(new AppError('E_MODEL_UNAVAILABLE')); // P0 est locale ; le 1er appel LLM est le cadrage (orchestrator)
    engine.runner.start(id);
    const s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    expect(
      eventsOf(engine, id).some((m) => /indisponible, bascule sur simule\/secours/.test(m)),
    ).toBe(true);
    expect(mock.calls.some((c) => c.model === 'simule/secours')).toBe(true);
    await engine.close();
  });

  it('échec fatal après max_attempts : mission failed, puis « Réessayer » la mène au bout', async () => {
    let broken = true;
    const mock = new MockLlmClient({
      delayMs: 0,
      respond: (req) =>
        broken && req.meta?.role === 'outline_architect'
          ? 'pas du json'
          : '{"resume":"ok","manques":[]}',
    });
    const { engine } = mkEngine({ mock });
    const id = createDemoMission(engine);
    engine.runner.start(id);
    let s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('failed');
    expect(s.error?.code).toBe('E_SCHEMA');
    const ev = eventsOf(engine, id);
    expect(ev.some((m) => /a échoué après 3 essais/.test(m))).toBe(true);
    expect(engine.queue.counts(id)).toMatchObject({ failed: 1, blocked: expect.any(Number) });
    broken = false;
    engine.runner.retry(id);
    s = await engine.runner.runUntilSettled(id);
    expect(s.status).toBe('completed');
    expect(s.tasksDone).toBe(16);
    await engine.close();
  });

  it('sortie invalide : un réessai avec le message de validation, puis succès', async () => {
    let n = 0;
    const mock = new MockLlmClient({
      delayMs: 0,
      respond: (req) =>
        req.meta?.role === 'orchestrator' && n++ === 0
          ? '{"resume":42}'
          : '{"resume":"ok","manques":[]}',
    });
    const { engine } = mkEngine({ mock });
    const id = createDemoMission(engine);
    engine.runner.start(id);
    expect((await engine.runner.runUntilSettled(id)).status).toBe('completed');
    const retry = mock.calls.filter((c) => c.meta?.role === 'orchestrator');
    expect(retry).toHaveLength(2);
    expect(retry[1]!.messages.at(-1)!.content).toMatch(/ne respecte pas le schéma/);
    await engine.close();
  });

  it('pause utilisateur : plus de nouvelle tâche, tâches en cours terminées, puis reprise', async () => {
    const { engine } = mkEngine({
      mock: new MockLlmClient({ delayMs: 25, costPerCallUsd: 0.002 }),
    });
    const id = createDemoMission(engine);
    engine.runner.start(id);
    for (let i = 0; i < 30 && engine.queue.counts(id).done < 3; i++) {
      await engine.runner.tick();
      await new Promise((r) => setTimeout(r, 10));
    }
    engine.runner.pause(id);
    await new Promise((r) => setTimeout(r, 120));
    expect(engine.missions.status(id)).toBe('paused');
    const frozen = engine.queue.counts(id).done;
    await engine.runner.tick();
    await new Promise((r) => setTimeout(r, 60));
    expect(engine.queue.counts(id).done).toBe(frozen);
    expect(engine.queue.counts(id).running).toBe(0);
    engine.runner.resume(id);
    expect((await engine.runner.runUntilSettled(id)).status).toBe('completed');
    await engine.close();
  });

  it('annulation : la mission est conservée en lecture et ne peut plus repartir', async () => {
    const { engine } = mkEngine();
    const id = createDemoMission(engine);
    engine.runner.start(id);
    engine.runner.cancel(id);
    expect(engine.missions.status(id)).toBe('cancelled');
    expect(() => engine.runner.resume(id)).toThrow();
    expect(engine.missions.detail(id).tasks.length).toBe(16);
    await engine.close();
  });
});

describe('EngineService — API', () => {
  it('crée, lance et expose une mission factice via handle()', async () => {
    const { engine } = mkEngine();
    const r = await engine.handle('createDemoMission', {});
    expect(r).toMatchObject({ ok: true, value: { status: 'running', tasksTotal: 16 } });
    const id = (r as { value: { id: string } }).value.id;
    await engine.runner.runUntilSettled(id);
    const d = await engine.handle('getMission', { id });
    expect(d).toMatchObject({ ok: true, value: { status: 'completed' } });
    const list = await engine.handle('listMissions', {});
    expect((list as { value: unknown[] }).value).toHaveLength(1);
    const evs = await engine.handle('listEvents', { id, limit: 5 });
    expect((evs as { value: unknown[] }).value).toHaveLength(5);
    expect(await engine.handle('simulate', { kind: 'bogus' })).toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    await engine.close();
  });

  it('une mission inconnue renvoie une erreur sérialisée, pas une exception', async () => {
    const { engine } = mkEngine();
    expect(await engine.handle('getMission', { id: 'nope' })).toMatchObject({ ok: false });
    await engine.close();
  });

  it('démarre la boucle automatiquement et mène une mission à terme', async () => {
    const { engine } = mkEngine();
    engine.start();
    const id = createDemoMission(engine);
    engine.runner.start(id);
    for (let i = 0; i < 200 && engine.missions.status(id) !== 'completed'; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(engine.missions.status(id)).toBe('completed');
    await engine.close();
  });
});

export { EngineService };

describe('pannes simulées (mode développeur)', () => {
  it('« recharger » reprend immédiatement la mission en pause crédit', async () => {
    const { engine } = mkEngine();
    await engine.handle('simulate', { kind: 'no_credit' });
    const r = (await engine.handle('createDemoMission', {})) as { value: { id: string } };
    const id = r.value.id;
    expect((await engine.runner.runUntilSettled(id)).status).toBe('paused_no_credit');
    await engine.handle('simulate', { kind: 'recharge' });
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.missions.status(id)).toBe('running');
    expect((await engine.runner.runUntilSettled(id)).status).toBe('completed');
    await engine.close();
  });
});
