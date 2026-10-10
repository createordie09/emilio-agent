import { AppError, type AgentRole, type Brief, BriefSchema } from '@emilio/shared';
import type { FieldAnalysisView, HypothesisStatus } from '@emilio/shared';
import { nowIso, type Db } from '../storage/db';
import type { MissionRepo } from '../storage/missions';
import type { EventJournal } from '../events/journal';
import type { ModelCaller } from '../llm/call-model';
import { runStructured } from '../agents/execute';
import { renderPrompt } from '../agents/prompts';
import { profileDataFile, readDataGrid } from '../kb/profile';
import { makeTable } from '../stats';
import { WORK_TYPE_LABEL_FR } from '@emilio/shared';
import { numberTokens } from '../util/numbers';
import { AnalysisPlanSchema, InterpretationSchema, type Interpretation } from './schemas';
import { baselineSpecs, runAnalyses, validateAnalysisPlan, type AnalysisResult } from './run';

export const ANALYSIS_PROMPT_VERSION = 'analyse-1';
const MAX_ANALYSES = 10;

export type StoredAnalysis = {
  fileName: string;
  respondents: number;
  results: AnalysisResult[];
  interpretation: Interpretation & { sentencesDropped: number; notes: Record<string, string> };
  warnings: string[];
};

const REFERENCES = /\b(?:[AH]\d{1,2}|Tableau\s+\d+|Figure\s+\d+)\b/g;
const SENTENCE = /(?<=[.!?…])\s+/;

/**
 * Analyse des données de terrain (P4, CdC §9) : le modèle CHOISIT les analyses puis INTERPRÈTE ; le code les calcule,
 * contrôle que l'interprétation n'emploie que des nombres calculés (§12.3) et que les statuts d'hypothèses restent cohérents avec les tests.
 */
export class DataAnalysisService {
  constructor(
    private readonly d: {
      db: Db;
      missions: MissionRepo;
      journal: EventJournal;
      caller: ModelCaller;
      now?: () => Date;
    },
  ) {}

  private say(id: string, level: 'info' | 'success' | 'warning', msg: string) {
    this.d.journal.record({ missionId: id, level, agentRole: 'data_analyst', messageFr: msg });
  }

  private brief(id: string): Brief {
    const r = this.d.db.prepare('SELECT brief_json FROM missions WHERE id=?').get(id) as {
      brief_json: string | null;
    };
    return BriefSchema.parse(JSON.parse(r.brief_json ?? '{}'));
  }

  /** Données de terrain exploitables (la plus grande source si plusieurs) ; `null` si aucune. */
  private dataFile(id: string): { path: string; filename: string; extra: number } | null {
    const rows = this.d.db
      .prepare(
        `SELECT path, filename, meta_json FROM mission_files WHERE mission_id=? AND kind='field_data' AND parsed_status IN ('done','warning')`,
      )
      .all(id) as { path: string; filename: string; meta_json: string | null }[];
    if (!rows.length) return null;
    const sized = rows.map((r) => ({
      ...r,
      respondents:
        (JSON.parse(r.meta_json ?? '{}') as { profile?: { respondents?: number } }).profile
          ?.respondents ?? 0,
    }));
    sized.sort((a, b) => b.respondents - a.respondents);
    return { path: sized[0]!.path, filename: sized[0]!.filename, extra: rows.length - 1 };
  }

  get(id: string): StoredAnalysis | null {
    const r = this.d.db
      .prepare(
        'SELECT results_json, interpretation_json, plan_json FROM field_analysis WHERE mission_id=?',
      )
      .get(id) as
      | {
          results_json: string | null;
          interpretation_json: string | null;
          plan_json: string | null;
        }
      | undefined;
    if (!r?.results_json || !r.interpretation_json) return null;
    const meta = JSON.parse(r.plan_json ?? '{}') as {
      fileName?: string;
      respondents?: number;
      warnings?: string[];
    };
    return {
      fileName: meta.fileName ?? '',
      respondents: meta.respondents ?? 0,
      results: JSON.parse(r.results_json) as AnalysisResult[],
      interpretation: JSON.parse(r.interpretation_json) as StoredAnalysis['interpretation'],
      warnings: meta.warnings ?? [],
    };
  }

  view(id: string): FieldAnalysisView | null {
    const a = this.get(id);
    if (!a) return null;
    return {
      fileName: a.fileName,
      respondents: a.respondents,
      tables: a.results.map((r) => ({
        id: r.id,
        tableNumber: r.tableNumber,
        caption: r.caption,
        source: r.source,
        headers: r.headers,
        rows: r.rows,
        facts: r.facts,
        warnings: r.warnings,
        hypothese: r.hypothese,
        figure: r.figure ? { number: r.figure.number, caption: r.figure.caption } : null,
      })),
      interpretation: a.interpretation.interpretation,
      hypotheses: a.interpretation.hypotheses.map((h) => ({
        ...h,
        note: a.interpretation.notes[h.hypothese] ?? null,
      })),
      limites: a.interpretation.limites,
      warnings: a.warnings,
      sentencesDropped: a.interpretation.sentencesDropped,
    };
  }

  /** Nombres autorisés dans l'interprétation et dans les sections rédigées : ceux des résultats calculés (§12.3). */
  allowedNumbers(a: StoredAnalysis): Set<string> {
    const s = new Set<string>();
    const add = (t: string) =>
      numberTokens(t.replace(REFERENCES, ' ')).forEach((x) => s.add(x.canon));
    s.add(String(a.respondents));
    for (const r of a.results) {
      r.facts.forEach(add);
      r.rows.forEach((row) => row.forEach(add));
    }
    return s;
  }

  async run(id: string, signal?: AbortSignal): Promise<StoredAnalysis | null> {
    const existing = this.get(id);
    if (existing) return existing;
    const file = this.dataFile(id);
    if (!file) return null;
    const brief = this.brief(id);
    const warnings: string[] = [];
    const grid = await readDataGrid(file.path, file.filename);
    const table = makeTable(grid.headers, grid.rows);
    const profile = await profileDataFile(file.path, file.filename);
    if (file.extra > 0)
      warnings.push(
        `${file.extra} autre(s) fichier(s) de données ignoré(s) : seul « ${file.filename} » (le plus grand) est analysé.`,
      );
    warnings.push(...profile.warnings);

    // 1. Choix des analyses par l'Analyste (le code valide chaque variable et chaque type).
    let planned: ReturnType<typeof validateAnalysisPlan> = { specs: [], dropped: [] };
    try {
      const cols = profile.columns
        .filter((c) => !c.identifying)
        .map(
          (c) =>
            `- ${c.name} (${c.type}${
              c.modalities
                ? ` : ${c.modalities
                    .slice(0, 8)
                    .map((m) => m.value)
                    .join(', ')}`
                : ''
            })`,
        )
        .join('\n');
      const r = await runStructured(this.d.caller, {
        missionId: id,
        taskId: null,
        role: 'data_analyst' as AgentRole,
        label: 'analyse:plan',
        messages: [
          {
            role: 'system',
            content: renderPrompt('data_analyst/plan', {
              type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
              discipline: brief.discipline,
              problematique: brief.problematique ?? '(à définir)',
              hypotheses:
                brief.hypotheses.map((h, i) => `H${i + 1} : ${h}`).join('\n') || '(aucune)',
              questions: brief.questionsRecherche.map((x) => `- ${x}`).join('\n') || '(aucune)',
              respondents: profile.respondents,
              profil: cols,
              max_analyses: MAX_ANALYSES,
            }),
          },
          { role: 'user', content: 'Propose les analyses.' },
        ],
        schema: AnalysisPlanSchema,
        schemaName: 'plan_analyses',
        temperature: 0.2,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        signal,
      });
      planned = validateAnalysisPlan(r.output, profile, MAX_ANALYSES);
      for (const x of r.output.manques) warnings.push(`Analyste : ${x}`);
    } catch (e) {
      if (e instanceof AppError && e.code !== 'E_SCHEMA') throw e;
      warnings.push('Le choix des analyses par le modèle a échoué : analyses de base seulement.');
    }
    for (const x of planned.dropped) warnings.push(`Analyse écartée par le code (${x}).`);
    const have = new Set(planned.specs.map((s) => `${s.type}|${s.variables.join('|')}`));
    const specs = [
      ...planned.specs,
      ...baselineSpecs(profile).filter((s) => !have.has(`${s.type}|${s.variables.join('|')}`)),
    ];

    // 2. Calcul (code).
    const now = (this.d.now ?? (() => new Date()))();
    const period =
      brief.terrain?.periode?.trim() ||
      new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(now);
    const results = runAnalyses(table, specs, { source: `Source : enquête de terrain, ${period}` });
    if (!results.length) {
      warnings.push('Aucune analyse n’a pu être calculée avec ces données.');
    }
    for (const r of results)
      for (const w of r.warnings) warnings.push(`${r.caption.split(' : ')[0]} : ${w}`);
    this.say(
      id,
      results.length ? 'success' : 'warning',
      `Analyste de données : ${results.length} tableau(x) calculé(s) par le module statistique sur ${profile.respondents} répondant(s).`,
    );

    // 3. Interprétation par l'Analyste ; le code contrôle les nombres et les statuts d'hypothèses.
    const interp = await this.interpret(id, brief, profile.respondents, results, signal);
    const stored: StoredAnalysis = {
      fileName: file.filename,
      respondents: profile.respondents,
      results,
      interpretation: interp,
      warnings,
    };
    const t = nowIso();
    this.d.db
      .prepare(
        `INSERT INTO field_analysis(mission_id,plan_json,results_json,interpretation_json,created_at,updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(mission_id) DO UPDATE SET plan_json=excluded.plan_json, results_json=excluded.results_json, interpretation_json=excluded.interpretation_json, updated_at=excluded.updated_at`,
      )
      .run(
        id,
        JSON.stringify({
          fileName: file.filename,
          respondents: profile.respondents,
          specs,
          warnings,
        }),
        JSON.stringify(results),
        JSON.stringify(interp),
        t,
        t,
      );
    for (const h of interp.hypotheses)
      this.say(
        id,
        'info',
        `Hypothèse « ${h.hypothese.slice(0, 80)} » : ${h.statut === 'confirmee' ? 'confirmée' : h.statut === 'infirmee' ? 'infirmée' : 'nuancée'}.`,
      );
    return stored;
  }

  private async interpret(
    id: string,
    brief: Brief,
    respondents: number,
    results: AnalysisResult[],
    signal?: AbortSignal,
  ): Promise<StoredAnalysis['interpretation']> {
    const allowed = new Set<string>([String(respondents)]);
    const add = (t: string) =>
      numberTokens(t.replace(REFERENCES, ' ')).forEach((x) => allowed.add(x.canon));
    results.forEach((r) => {
      r.facts.forEach(add);
      r.rows.forEach((row) => row.forEach(add));
    });
    brief.hypotheses.forEach(add);
    const faits = results
      .map((r) => `${r.id} (${r.caption.split(' : ')[0]}) : ${r.facts.join(' ')}`)
      .join('\n');
    let raw: Interpretation;
    try {
      const r = await runStructured(this.d.caller, {
        missionId: id,
        taskId: null,
        role: 'data_analyst' as AgentRole,
        label: 'analyse:interpretation',
        messages: [
          {
            role: 'system',
            content: renderPrompt('data_analyst/interpret', {
              type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
              discipline: brief.discipline,
              respondents,
              hypotheses:
                brief.hypotheses.map((h, i) => `H${i + 1} : ${h}`).join('\n') || '(aucune)',
              faits: faits || '(aucun résultat)',
            }),
          },
          { role: 'user', content: 'Interprète les résultats.' },
        ],
        schema: InterpretationSchema,
        schemaName: 'interpretation',
        temperature: 0.3,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        signal,
      });
      raw = r.output;
    } catch (e) {
      if (e instanceof AppError && e.code !== 'E_SCHEMA') throw e;
      raw = {
        interpretation:
          'Les résultats calculés figurent dans les tableaux ci-dessus ; l’interprétation automatique n’a pas pu être produite.',
        hypotheses: [],
        limites: [],
        manques: ['Interprétation à rédiger : le modèle n’a pas fourni de réponse exploitable.'],
      };
    }

    // §12.3 : toute phrase contenant un nombre absent des résultats calculés est écartée.
    let dropped = 0;
    const clean = (text: string): string =>
      text
        .split(/\n{2,}/)
        .map((para) =>
          para
            .split(SENTENCE)
            .filter((s) => {
              const bad = numberTokens(s.replace(REFERENCES, ' ')).some(
                (n) => !allowed.has(n.canon),
              );
              if (bad) dropped++;
              return !bad;
            })
            .join(' '),
        )
        .filter((p) => p.trim())
        .join('\n\n');
    const interpretation = clean(raw.interpretation);
    const ids = new Set(results.map((r) => r.id));
    const notes: Record<string, string> = {};
    const hyps = brief.hypotheses.map((text, i) => {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const found =
        raw.hypotheses.find((h) => new RegExp(`^H${i + 1}\\b`).test(h.hypothese.trim())) ??
        raw.hypotheses.find((h) => norm(h.hypothese) === norm(text)) ??
        (raw.hypotheses.length === brief.hypotheses.length ? raw.hypotheses[i] : undefined);
      if (!found) {
        notes[text] = 'Hypothèse non traitée par l’interprétation.';
        return {
          hypothese: text,
          statut: 'nuancee' as HypothesisStatus,
          analyses: [] as string[],
          justification: '',
        };
      }
      const analyses = [
        ...new Set(found.analyses.map((a) => a.replace(/[[\]\s]/g, '').toUpperCase())),
      ].filter((a) => ids.has(a));
      let statut: HypothesisStatus = found.statut;
      const tests = analyses
        .map((a) => results.find((r) => r.id === a)!.p)
        .filter((p): p is number => p !== null);
      if (!analyses.length && statut !== 'nuancee') {
        notes[text] = 'Aucune analyse citée : statut ramené à « nuancée ».';
        statut = 'nuancee';
      } else if (statut === 'confirmee' && tests.length && tests.every((p) => p >= 0.05)) {
        notes[text] = 'Résultat non significatif au seuil de 5 % : statut ramené à « nuancée ».';
        statut = 'nuancee';
      }
      return { hypothese: text, statut, analyses, justification: clean(found.justification) };
    });
    return {
      interpretation,
      hypotheses: hyps,
      limites: raw.limites.filter(
        (l) => !numberTokens(l.replace(REFERENCES, ' ')).some((n) => !allowed.has(n.canon)),
      ),
      manques: raw.manques,
      sentencesDropped: dropped,
      notes,
    };
  }
}
