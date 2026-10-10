import type { ColumnProfile, DataProfile } from '@emilio/shared';
import {
  crosstab,
  describeNumeric,
  frequencies,
  groupMeans,
  pearson,
  type DataTable,
} from '../stats';
import { fmtFr, fmtFrFixed, fmtP } from '../util/numbers';
import type { AnalysisPlan, AnalysisType } from './schemas';

/** Analyse exécutable (variables validées par le code). */
export type AnalysisSpec = {
  type: AnalysisType;
  variables: string[];
  hypothese?: string;
  justification?: string;
};

/** Résultat calculé : tableau mis en forme, phrases de faits avec chiffres exacts, valeurs brutes pour les garde-fous. */
export type AnalysisResult = {
  id: string;
  type: AnalysisType;
  variables: string[];
  hypothese: string | null;
  tableNumber: number;
  caption: string;
  source: string;
  headers: string[];
  rows: string[][];
  facts: string[];
  warnings: string[];
  /** Tests : p-valeur (khi-deux, corrélation) pour contrôler les statuts d'hypothèses. */
  p: number | null;
  figure: { number: number; caption: string; vegaLite: Record<string, unknown> } | null;
};

const MAX_MODALITIES = 12;
const isCat = (c: ColumnProfile): boolean =>
  c.type === 'categorical' ||
  c.type === 'boolean' ||
  ((c.type === 'integer' || c.type === 'number') && c.distinct <= 8);
const isNum = (c: ColumnProfile): boolean => c.type === 'integer' || c.type === 'number';

/** Valide le plan du modèle : variables existantes, types compatibles ; ce qui n'est pas exécutable est écarté et signalé. */
export function validateAnalysisPlan(
  plan: AnalysisPlan,
  profile: DataProfile,
  max: number,
): { specs: AnalysisSpec[]; dropped: string[] } {
  // Les colonnes d'identification n'existent pas pour l'analyse (CdC §19).
  const byName = new Map(
    profile.columns.filter((c) => !c.identifying).map((c) => [c.name.toLowerCase(), c]),
  );
  const specs: AnalysisSpec[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const a of plan.analyses) {
    const cols = a.variables.map((v) => byName.get(v.trim().toLowerCase()));
    const label = `${a.type}(${a.variables.join(', ')})`;
    if (cols.some((c) => !c)) {
      dropped.push(`${label} : variable inconnue`);
      continue;
    }
    const cs = cols as ColumnProfile[];
    const names = cs.map((c) => c.name);
    const ok =
      (a.type === 'frequencies' &&
        cs.length === 1 &&
        isCat(cs[0]!) &&
        cs[0]!.distinct <= MAX_MODALITIES) ||
      (a.type === 'describe' && cs.length === 1 && isNum(cs[0]!)) ||
      (a.type === 'crosstab' &&
        cs.length === 2 &&
        cs.every((c) => isCat(c) && c.distinct <= MAX_MODALITIES) &&
        names[0] !== names[1]) ||
      (a.type === 'correlation' && cs.length === 2 && cs.every(isNum) && names[0] !== names[1]) ||
      (a.type === 'group_means' &&
        cs.length === 2 &&
        isNum(cs[0]!) &&
        isCat(cs[1]!) &&
        cs[1]!.distinct <= MAX_MODALITIES &&
        names[0] !== names[1]);
    if (!ok) {
      dropped.push(`${label} : types de variables incompatibles avec cette analyse`);
      continue;
    }
    const key = `${a.type}|${names.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push({
      type: a.type,
      variables: names,
      hypothese: a.hypothese?.trim() || undefined,
      justification: a.justification,
    });
    if (specs.length >= max) break;
  }
  return { specs, dropped };
}

/** Analyses de base ajoutées par le code : profil de l'échantillon (effectifs des variables catégorielles, descriptif des numériques). */
export function baselineSpecs(profile: DataProfile, maxCategorical = 6): AnalysisSpec[] {
  const out: AnalysisSpec[] = profile.columns
    .filter(
      (c) =>
        !c.identifying &&
        (c.type === 'categorical' || c.type === 'boolean') &&
        c.distinct <= MAX_MODALITIES &&
        c.nonMissing > 0,
    )
    .slice(0, maxCategorical)
    .map((c) => ({ type: 'frequencies' as const, variables: [c.name] }));
  for (const c of profile.columns.filter(
    (c) => !c.identifying && isNum(c) && c.distinct > 8 && c.nonMissing > 0,
  ))
    out.push({ type: 'describe', variables: [c.name] });
  return out;
}

const pct = (x: number) => `${fmtFrFixed(x, 1)} %`;
const q = (s: string) => `« ${s} »`;

/**
 * Exécute les analyses (CdC §9 P4) : tout est calculé ici, par du code. Les `describe` sont regroupés en UN tableau
 * « Statistiques descriptives » (une ligne par variable numérique).
 */
export function runAnalyses(
  table: DataTable,
  specs: AnalysisSpec[],
  ctx: { source: string; firstTable?: number; firstFigure?: number },
): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  let tn = ctx.firstTable ?? 1;
  let fn = ctx.firstFigure ?? 1;
  let k = 0;
  const base = (type: AnalysisType, variables: string[], s?: AnalysisSpec) => ({
    id: `A${++k}`,
    type,
    variables,
    hypothese: s?.hypothese ?? null,
    source: ctx.source,
    warnings: [] as string[],
    p: null as number | null,
  });
  const describes = specs.filter((s) => s.type === 'describe');
  const numberedFigure = (caption: string, vegaLite: Record<string, unknown>) => ({
    number: fn,
    caption: `Figure ${fn++} : ${caption}`,
    vegaLite,
  });

  for (const s of specs) {
    if (s.type === 'describe') continue;
    if (s.type === 'frequencies') {
      const v = s.variables[0]!;
      const f = frequencies(table, v);
      const r = base('frequencies', s.variables, s);
      if (f.n === 0) continue;
      const caption = `Répartition des répondants selon ${q(v)}`;
      results.push({
        ...r,
        tableNumber: tn,
        caption: `Tableau ${tn++} : ${caption}`,
        headers: [v, 'Effectif', 'Pourcentage'],
        rows: [
          ...f.rows.map((x) => [x.value, fmtFr(x.count, 0), pct(x.pct)]),
          ['Total', fmtFr(f.n, 0), pct(100)],
        ],
        facts: [
          `${q(v)} (n = ${fmtFr(f.n, 0)} réponses valides${f.missing ? `, ${fmtFr(f.missing, 0)} manquante(s)` : ''}) : ${f.rows
            .slice(0, 8)
            .map((x) => `${q(x.value)} ${fmtFr(x.count, 0)} (${pct(x.pct)})`)
            .join(', ')}.`,
        ],
        figure: numberedFigure(caption, {
          mark: 'bar',
          data: { values: f.rows.map((x) => ({ modalite: x.value, effectif: x.count })) },
          encoding: {
            x: { field: 'modalite', type: 'nominal' },
            y: { field: 'effectif', type: 'quantitative' },
          },
        }),
      });
    } else if (s.type === 'crosstab') {
      const [a, b] = s.variables as [string, string];
      const c = crosstab(table, a, b);
      if (c.n === 0) continue;
      const r = base('crosstab', s.variables, s);
      const total = (i: number) => c.counts[i]!.reduce((x, y) => x + y, 0);
      const facts = [
        `Tableau croisé ${q(a)} × ${q(b)} (n = ${fmtFr(c.n, 0)}) : ${c.rowLabels
          .map(
            (rl, i) =>
              `${q(rl)} (${fmtFr(total(i), 0)}) : ${c.colLabels.map((cl, j) => `${q(cl)} ${fmtFr(c.counts[i]![j]!, 0)} (${pct(c.rowPct[i]![j]!)})`).join(', ')}`,
          )
          .join(' ; ')}.`,
      ];
      const warnings: string[] = [];
      let p: number | null = null;
      if (c.chi2) {
        p = c.chi2.p;
        facts.push(
          `Test du khi-deux entre ${q(a)} et ${q(b)} : χ² = ${fmtFrFixed(c.chi2.statistic, 2)}, ddl = ${fmtFr(c.chi2.df, 0)}, ${fmtP(c.chi2.p)}, V de Cramér = ${fmtFrFixed(c.chi2.cramersV, 2)} ; ${c.chi2.p < 0.05 ? 'association significative au seuil de 5 %' : 'association non significative au seuil de 5 %'}.`,
        );
        if (!c.chi2.reliable)
          warnings.push(
            `Test du khi-deux peu fiable : ${fmtFr(c.chi2.smallExpectedShare * 100, 0)} % des cases ont un effectif théorique inférieur à 5, ou l'échantillon compte moins de 30 réponses.`,
          );
      }
      const caption = `${q(a)} selon ${q(b)}`;
      results.push({
        ...r,
        p,
        warnings,
        tableNumber: tn,
        caption: `Tableau ${tn++} : ${caption}`,
        headers: [`${a} \\ ${b}`, ...c.colLabels, 'Total'],
        rows: [
          ...c.rowLabels.map((rl, i) => [
            rl,
            ...c.counts[i]!.map((x, j) => `${fmtFr(x, 0)} (${pct(c.rowPct[i]![j]!)})`),
            fmtFr(total(i), 0),
          ]),
          [
            'Total',
            ...c.colLabels.map((_, j) =>
              fmtFr(
                c.counts.reduce((x, rr) => x + rr[j]!, 0),
                0,
              ),
            ),
            fmtFr(c.n, 0),
          ],
        ],
        facts,
        figure: null,
      });
    } else if (s.type === 'correlation') {
      const [a, b] = s.variables as [string, string];
      const c = pearson(table, a, b);
      if (!c) continue;
      const r = base('correlation', s.variables, s);
      const caption = `Corrélation entre ${q(a)} et ${q(b)}`;
      results.push({
        ...r,
        p: c.p,
        tableNumber: tn,
        caption: `Tableau ${tn++} : ${caption}`,
        headers: ['Variable 1', 'Variable 2', 'n', 'r de Pearson', 'p'],
        rows: [
          [
            a,
            b,
            fmtFr(c.n, 0),
            fmtFrFixed(c.r, 2),
            fmtP(c.p).replace('p = ', '').replace('p < ', '< '),
          ],
        ],
        facts: [
          `Corrélation de Pearson entre ${q(a)} et ${q(b)} : r = ${fmtFrFixed(c.r, 2)}, n = ${fmtFr(c.n, 0)}, ${fmtP(c.p)} ; corrélation ${c.strength}${c.direction === 'nulle' ? '' : ` ${c.direction}`}, ${c.p < 0.05 ? 'significative' : 'non significative'} au seuil de 5 %.`,
        ],
        warnings:
          c.n < 30 ? [`Échantillon réduit (n = ${c.n}) : à interpréter avec prudence.`] : [],
        figure: null,
      });
    } else if (s.type === 'group_means') {
      const [num, by] = s.variables as [string, string];
      const g = groupMeans(table, num, by);
      if (!g.groups.length) continue;
      const r = base('group_means', s.variables, s);
      const caption = `${q(num)} selon ${q(by)}`;
      results.push({
        ...r,
        tableNumber: tn,
        caption: `Tableau ${tn++} : ${caption}`,
        headers: [by, 'n', 'Moyenne', 'Écart-type'],
        rows: g.groups.map((x) => [x.group, fmtFr(x.n, 0), fmtFr(x.mean, 2), fmtFr(x.sd, 2)]),
        facts: [
          `${q(num)} selon ${q(by)} : ${g.groups.map((x) => `${q(x.group)} moyenne ${fmtFr(x.mean, 2)} (écart-type ${fmtFr(x.sd, 2)}, n = ${fmtFr(x.n, 0)})`).join(' ; ')}.`,
        ],
        figure: numberedFigure(caption, {
          mark: 'bar',
          data: { values: g.groups.map((x) => ({ groupe: x.group, moyenne: x.mean })) },
          encoding: {
            x: { field: 'groupe', type: 'nominal' },
            y: { field: 'moyenne', type: 'quantitative' },
          },
        }),
      });
    }
  }

  if (describes.length) {
    const rows: string[][] = [];
    const facts: string[] = [];
    for (const s of describes) {
      const d = describeNumeric(table, s.variables[0]!);
      if (!d.n) continue;
      rows.push([
        s.variables[0]!,
        fmtFr(d.n, 0),
        fmtFr(d.mean, 2),
        fmtFr(d.sd, 2),
        fmtFr(d.median, 2),
        fmtFr(d.min, 2),
        fmtFr(d.max, 2),
      ]);
      facts.push(
        `${q(s.variables[0]!)} (n = ${fmtFr(d.n, 0)}) : moyenne ${fmtFr(d.mean, 2)}, écart-type ${fmtFr(d.sd, 2)}, médiane ${fmtFr(d.median, 2)}, minimum ${fmtFr(d.min, 2)}, maximum ${fmtFr(d.max, 2)}.`,
      );
    }
    if (rows.length)
      results.push({
        ...base(
          'describe',
          describes.map((s) => s.variables[0]!),
          describes[0],
        ),
        tableNumber: tn,
        caption: `Tableau ${tn++} : Statistiques descriptives des variables numériques`,
        headers: ['Variable', 'n', 'Moyenne', 'Écart-type', 'Médiane', 'Minimum', 'Maximum'],
        rows,
        facts,
        warnings: [],
        figure: null,
      });
  }
  return results;
}
