// Calibration (CdC J10, §21.2) : mission RÉELLE courte (« mini-mémoire » de 10 pages) avec le vrai modèle d'IA (OpenRouter).
// Les API de sources documentaires sont inaccessibles depuis le cloud : les sources sont SIMULÉES (`sourcesMode: 'mock'`), le modèle est réel.
// Lancer : `CAL_SCENARIO=A CAL_BUDGET=1.5 npx vitest run --config vitest.live.config.ts test-live/calibration.live.ts`
// Coût réel : le budget plafonne la mission. Résultat : docs/calibration/<scénario>.json
import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultBrief, type BriefDraft } from '@emilio/shared';
import { EngineService, HashEmbedder } from '../src';

const RES = join(__dirname, '../../../resources');
const OUT = join(__dirname, '../../../docs/calibration');
const FX = (f: string) => join(__dirname, '../test/fixtures', f);
const SCENARIO = process.env.CAL_SCENARIO ?? 'A';
const BUDGET = Number(process.env.CAL_BUDGET ?? 1.5);
const TIMEOUT_MIN = Number(process.env.CAL_TIMEOUT_MIN ?? 60);
const COPY_TO = process.env.CAL_COPY_TO;

const SCENARIOS: Record<
  string,
  {
    label: string;
    preset: string;
    data: boolean;
    titre: string;
    problematique: string;
    hypotheses: string[];
    approche: 'documentaire' | 'quantitative';
  }
> = {
  A: {
    label: 'documentaire, préréglage économique',
    preset: 'economique',
    data: false,
    titre: 'Microfinance et inclusion financière des ménages ruraux au Bénin',
    problematique:
      'Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière des ménages ruraux au Bénin ?',
    hypotheses: [],
    approche: 'documentaire',
  },
  B: {
    label: 'quantitative avec données CSV, préréglage économique',
    preset: 'economique',
    data: true,
    titre: 'Crédit solidaire, genre et remboursement chez les ménages enquêtés',
    problematique:
      'Le crédit solidaire améliore-t-il l’accès au crédit, et les femmes remboursent-elles mieux que les hommes ?',
    hypotheses: [
      'Le crédit solidaire améliore l’accès au crédit.',
      'Les femmes remboursent mieux que les hommes.',
    ],
    approche: 'quantitative',
  },
  C: {
    label: 'documentaire, préréglage équilibré',
    preset: 'equilibre',
    data: false,
    titre:
      'Digitalisation des services financiers et inclusion des petits commerçants en Afrique de l’Ouest',
    problematique:
      'Comment le paiement mobile transforme-t-il l’accès aux services financiers des petits commerçants en Afrique de l’Ouest ?',
    hypotheses: [],
    approche: 'documentaire',
  },
};

describe(`calibration — scénario ${SCENARIO}`, () => {
  it(
    'mission réelle courte de bout en bout',
    async () => {
      const sc = SCENARIOS[SCENARIO]!;
      mkdirSync(OUT, { recursive: true });
      const dir = mkdtempSync(join(tmpdir(), `emilio-cal-${SCENARIO}-`));
      const logFile = join(OUT, `${SCENARIO}.log`);
      writeFileSync(logFile, '');
      const log = (m: string) => appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`);

      // Le proxy du cloud ajoute lui-même la clé : l'en-tête Authorization envoyé par le client est retiré (sinon la valeur factice est refusée).
      const proxyFetch = (url: string, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        h.delete('authorization');
        return fetch(url, { ...init, headers: h });
      };
      const engine = new EngineService({
        fetch: proxyFetch,
        dbPath: join(dir, 'e.db'),
        dataDir: dir,
        embedder: new HashEmbedder(),
        presetsPath: join(RES, 'presets.json'),
        normsProfilesPath: join(RES, 'norms-profiles.json'),
        qualityWeightsPath: join(RES, 'quality-weights.json'),
        resourcesDir: RES,
      });
      // Le proxy du cloud injecte la clé : une valeur quelconque suffit pour que le client accepte d'appeler.
      engine.llm.setApiKey(process.env.OPENROUTER_API_KEY ?? 'proxy-injected');
      const ml = await engine.handle('listModels', {});
      expect(ml.ok, 'liste des modèles OpenRouter').toBe(true);

      const brief: BriefDraft = {
        ...defaultBrief('memoire_licence'),
        discipline: 'Sciences de gestion',
        titre: sc.titre,
        problematique: sc.problematique,
        hypotheses: sc.hypotheses,
        approche: sc.approche,
        motsCles: ['microfinance', 'inclusion financière'],
        longueur: { unite: 'pages', min: 8, max: 12 },
        profilNormesId: 'afrique-francophone-standard',
        execution: {
          ...defaultBrief().execution!,
          preset: sc.preset,
          budgetMaxUsd: BUDGET,
          parallelism: 3,
          rondesMaxParChapitre: 2,
          rondesMaxGlobales: 1,
          profondeurRecherche: 'rapide',
        },
        livrables: {
          docx: true,
          pdf: false,
          pptx: SCENARIO === 'A',
          nbDiapos: 10,
          fichePreparation: SCENARIO === 'A',
          rapportMission: true,
        },
      };
      const d = engine.drafts.create({ workType: 'memoire_licence' });
      engine.drafts.save(d.id, brief);
      if (sc.data) {
        await engine.ingest.add(d.id, [{ path: FX('donnees-enquete.csv'), kind: 'field_data' }]);
        await engine.ingest.idle();
      }
      await engine.drafts.finalize(d.id, { confirmNoFieldData: true });
      const id = d.id;
      const cfg = engine.missions.config<Record<string, unknown>>(id);
      engine.missions.setConfig(id, { ...cfg, sourcesMode: 'mock' });
      engine.start();

      const t0 = Date.now();
      log(`démarrage : ${sc.label}, budget ${BUDGET} $`);
      await engine.handle('generatePlan', { id });
      await engine.planning.idle();
      {
        const m0 = engine.missions.summary(id);
        log(`après planification : ${m0.status}`);
        for (const e of engine.db
          .prepare(
            'SELECT level, message_fr FROM events WHERE mission_id=? ORDER BY created_at DESC LIMIT 8',
          )
          .all(id) as { level: string; message_fr: string }[])
          log(`  [${e.level}] ${e.message_fr}`);
      }
      const plan = await engine.handle('getPlan', { id });
      expect(plan.ok, 'plan généré').toBe(true);
      const estimate = plan.ok ? (plan.value as { estimate: unknown }).estimate : null;
      log(`plan prêt en ${Math.round((Date.now() - t0) / 1000)} s`);
      const v = await engine.handle('validatePlan', { id });
      expect(v.ok, 'plan validé').toBe(true);
      const tPlan = Date.now();

      let last = '';
      const deadline = Date.now() + TIMEOUT_MIN * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const m = engine.missions.summary(id);
        const line = `${m.status} ${m.tasksDone}/${m.tasksTotal} ${m.currentPhase ?? ''} ${m.costSpentUsd.toFixed(3)} $`;
        if (line !== last) log(line);
        last = line;
        if (
          ['completed', 'failed', 'cancelled'].includes(m.status) ||
          m.status.startsWith('paused')
        )
          break;
      }
      const end = engine.missions.summary(id);
      log(`fin : ${end.status} après ${Math.round((Date.now() - tPlan) / 1000)} s`);

      // ---------------- métriques
      const q = <T>(sql: string, ...a: unknown[]) =>
        engine.db.prepare(sql).all(...(a as never[])) as T[];
      const phases = q<{
        phase: string;
        n: number;
        cost: number;
        tin: number;
        tout: number;
        start: string;
        end: string;
      }>(
        `SELECT t.phase AS phase, COUNT(DISTINCT t.id) AS n, COALESCE(SUM(l.cost_usd),0) AS cost, COALESCE(SUM(l.prompt_tokens),0) AS tin, COALESCE(SUM(l.completion_tokens),0) AS tout,
                MIN(t.started_at) AS start, MAX(t.finished_at) AS end
         FROM tasks t LEFT JOIN llm_calls l ON l.task_id=t.id AND l.status_code=200 WHERE t.mission_id=? GROUP BY t.phase ORDER BY t.phase`,
        id,
      );
      const orphan = q<{ cost: number; tin: number; tout: number; n: number }>(
        `SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(prompt_tokens),0) AS tin, COALESCE(SUM(completion_tokens),0) AS tout, COUNT(*) AS n FROM llm_calls WHERE mission_id=? AND task_id IS NULL AND status_code=200`,
        id,
      )[0];
      const byRole = q<{
        role: string;
        model: string;
        calls: number;
        cost: number;
        tin: number;
        tout: number;
        avgMs: number;
        tps: number;
      }>(
        `SELECT agent_role AS role, model, COUNT(*) AS calls, SUM(cost_usd) AS cost, SUM(prompt_tokens) AS tin, SUM(completion_tokens) AS tout, AVG(latency_ms) AS avgMs,
                SUM(completion_tokens)*1000.0/NULLIF(SUM(latency_ms),0) AS tps
         FROM llm_calls WHERE mission_id=? AND status_code=200 GROUP BY agent_role, model ORDER BY cost DESC`,
        id,
      );
      const errors = q<{ error: string; n: number }>(
        `SELECT error, COUNT(*) AS n FROM llm_calls WHERE mission_id=? AND error IS NOT NULL GROUP BY error ORDER BY n DESC`,
        id,
      );
      const warnings = q<{ level: string; message_fr: string }>(
        `SELECT level, message_fr FROM events WHERE mission_id=? AND level IN ('warning','error') ORDER BY created_at`,
        id,
      ).map((e) => `[${e.level}] ${e.message_fr}`);
      const drafts = q<{
        numbering: string | null;
        title: string;
        words: number;
        checks: string | null;
        target: number | null;
      }>(
        `SELECT n.numbering AS numbering, n.title AS title, d.word_count AS words, d.checks_json AS checks, n.target_words AS target
         FROM outline_nodes n JOIN drafts d ON d.id = COALESCE(n.current_version_id, (SELECT id FROM drafts WHERE outline_node_id=n.id ORDER BY version DESC LIMIT 1))
         WHERE n.mission_id=? ORDER BY n.ordinal`,
        id,
      ).map((r) => {
        const c = r.checks
          ? (JSON.parse(r.checks) as {
              groundingRate?: number | null;
              groundingRateInitial?: number | null;
              removed?: unknown[];
              rounds?: number;
              warnings?: string[];
            })
          : null;
        return {
          section: `${r.numbering ?? ''} ${r.title}`.trim(),
          words: r.words,
          target: r.target,
          grounding: c?.groundingRate ?? null,
          groundingInitial: c?.groundingRateInitial ?? null,
          removed: c?.removed?.length ?? 0,
          rounds: c?.rounds ?? 0,
          warnings: c?.warnings ?? [],
        };
      });
      const jury = q<{
        scope: string;
        target: string;
        status: string;
        score: number | null;
        rounds: number;
        reasons: string;
      }>(
        `SELECT scope, target_id AS target, status, final_score AS score, rounds, reasons_json AS reasons FROM review_outcomes WHERE mission_id=?`,
        id,
      );
      const deliverables = q<{ kind: string; size_bytes: number }>(
        `SELECT kind, size_bytes FROM deliverables WHERE mission_id=?`,
        id,
      );
      const exports = await engine.handle('getExports', { id });
      const costs = await engine.handle('getCosts', { id });
      const out = {
        scenario: SCENARIO,
        label: sc.label,
        preset: sc.preset,
        budgetUsd: BUDGET,
        status: end.status,
        costUsd: end.costSpentUsd,
        wallSeconds: Math.round((Date.now() - tPlan) / 1000),
        planSeconds: Math.round((tPlan - t0) / 1000),
        estimate,
        phases: phases.map((p) => ({
          ...p,
          seconds:
            p.start && p.end ? Math.round((Date.parse(p.end) - Date.parse(p.start)) / 1000) : null,
        })),
        outsideTasks: orphan,
        byRole,
        errors,
        warnings: warnings.slice(0, 80),
        sections: drafts,
        jury,
        deliverables,
        finalCheck: exports.ok ? (exports.value as { finalCheck: unknown }).finalCheck : null,
        summary: exports.ok ? (exports.value as { summary: unknown }).summary : null,
        costs: costs.ok ? costs.value : null,
      };
      writeFileSync(join(OUT, `${SCENARIO}.json`), JSON.stringify(out, null, 2));
      if (COPY_TO) {
        const rows = engine.db
          .prepare('SELECT path, filename FROM deliverables WHERE mission_id=?')
          .all(id) as { path: string; filename: string }[];
        for (const r of rows) copyFileSync(r.path, join(COPY_TO, `${SCENARIO}-${r.filename}`));
      }
      await engine.runner.stop();
      expect(['completed', 'paused_budget', 'failed', 'paused_no_credit']).toContain(end.status);
    },
    (TIMEOUT_MIN + 10) * 60_000,
  );
});
