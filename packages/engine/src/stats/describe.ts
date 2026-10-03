import { isMissing, parseNumber, uniqueNames, BOOL_TRUE, BOOL_FALSE } from '../kb/profile';
import { chiSquareSf, studentTwoSidedP } from './special';

/** Table de données brutes (texte), colonnes nommées de façon unique. */
export type DataTable = { headers: string[]; rows: string[][] };

export const makeTable = (headers: string[], rows: string[][]): DataTable => ({
  headers: uniqueNames(headers),
  rows,
});

const idx = (t: DataTable, name: string): number => {
  const i = t.headers.indexOf(name);
  if (i < 0) throw new Error(`Variable introuvable : ${name}`);
  return i;
};

/** Valeurs non manquantes (texte nettoyé) d'une colonne, avec l'indice de ligne d'origine. */
export function columnText(t: DataTable, name: string): { row: number; value: string }[] {
  const i = idx(t, name);
  const out: { row: number; value: string }[] = [];
  t.rows.forEach((r, row) => {
    const v = (r[i] ?? '').trim();
    if (!isMissing(v)) out.push({ row, value: v });
  });
  return out;
}

export function columnNumbers(t: DataTable, name: string): { row: number; value: number }[] {
  return columnText(t, name)
    .map((c) => ({ row: c.row, value: parseNumber(c.value) }))
    .filter((c) => Number.isFinite(c.value));
}

export const isBool = (v: string): boolean =>
  BOOL_TRUE.has(v.toLowerCase()) || BOOL_FALSE.has(v.toLowerCase());

// ------------------------------------------------------------------ descriptif

export type NumericSummary = {
  n: number;
  missing: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
};

export function describeNumeric(t: DataTable, name: string): NumericSummary {
  const nums = columnNumbers(t, name).map((c) => c.value);
  const n = nums.length;
  const missing = t.rows.length - n;
  if (!n) return { n: 0, missing, mean: NaN, median: NaN, sd: NaN, min: NaN, max: NaN };
  const a = [...nums].sort((x, y) => x - y);
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, missing, mean, median, sd, min: a[0]!, max: a[n - 1]! };
}

export type FrequencyRow = { value: string; count: number; pct: number };
export type FrequencyTable = { n: number; missing: number; rows: FrequencyRow[] };

/** Effectifs et pourcentages (sur les réponses valides) ; modalités numériques triées par valeur, les autres par effectif décroissant. */
export function frequencies(t: DataTable, name: string): FrequencyTable {
  const vals = columnText(t, name);
  const n = vals.length;
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
  const entries = [...counts.entries()];
  const numeric = entries.every(([v]) => Number.isFinite(parseNumber(v)));
  entries.sort((a, b) =>
    numeric ? parseNumber(a[0]) - parseNumber(b[0]) : b[1] - a[1] || a[0].localeCompare(b[0], 'fr'),
  );
  return {
    n,
    missing: t.rows.length - n,
    rows: entries.map(([value, count]) => ({ value, count, pct: (100 * count) / n })),
  };
}

export type GroupMeans = {
  n: number;
  groups: { group: string; n: number; mean: number; sd: number }[];
};

/** Moyenne et écart-type d'une variable numérique selon les modalités d'une variable catégorielle. */
export function groupMeans(t: DataTable, numeric: string, by: string): GroupMeans {
  const num = new Map(columnNumbers(t, numeric).map((c) => [c.row, c.value]));
  const groups = new Map<string, number[]>();
  for (const c of columnText(t, by)) {
    const v = num.get(c.row);
    if (v === undefined) continue;
    groups.set(c.value, [...(groups.get(c.value) ?? []), v]);
  }
  const rows = [...groups.entries()]
    .map(([group, xs]) => {
      const n = xs.length;
      const mean = xs.reduce((s, x) => s + x, 0) / n;
      const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
      return { group, n, mean, sd };
    })
    .sort((a, b) => b.n - a.n || a.group.localeCompare(b.group, 'fr'));
  return { n: rows.reduce((s, g) => s + g.n, 0), groups: rows };
}

// ------------------------------------------------------------------ tableaux croisés et khi-deux

export type Crosstab = {
  n: number;
  rowLabels: string[];
  colLabels: string[];
  counts: number[][];
  rowPct: number[][];
  chi2: {
    statistic: number;
    df: number;
    p: number;
    cramersV: number;
    /** Part des cases dont l'effectif théorique est < 5 : au-delà de 20 %, le test est peu fiable. */
    smallExpectedShare: number;
    reliable: boolean;
  } | null;
};

export function crosstab(t: DataTable, rowVar: string, colVar: string): Crosstab {
  const a = new Map(columnText(t, rowVar).map((c) => [c.row, c.value]));
  const b = new Map(columnText(t, colVar).map((c) => [c.row, c.value]));
  const pairs: [string, string][] = [];
  for (const [row, va] of a) {
    const vb = b.get(row);
    if (vb !== undefined) pairs.push([va, vb]);
  }
  const n = pairs.length;
  const sortLabels = (xs: string[]) => {
    const u = [...new Set(xs)];
    return u.every((v) => Number.isFinite(parseNumber(v)))
      ? u.sort((x, y) => parseNumber(x) - parseNumber(y))
      : u.sort((x, y) => x.localeCompare(y, 'fr'));
  };
  const rowLabels = sortLabels(pairs.map((p) => p[0]));
  const colLabels = sortLabels(pairs.map((p) => p[1]));
  const counts = rowLabels.map(() => colLabels.map(() => 0));
  for (const [x, y] of pairs) counts[rowLabels.indexOf(x)]![colLabels.indexOf(y)]!++;
  const rowTot = counts.map((r) => r.reduce((s, x) => s + x, 0));
  const colTot = colLabels.map((_, j) => counts.reduce((s, r) => s + r[j]!, 0));
  const rowPct = counts.map((r, i) => r.map((x) => (rowTot[i]! ? (100 * x) / rowTot[i]! : 0)));
  let chi2: Crosstab['chi2'] = null;
  if (rowLabels.length >= 2 && colLabels.length >= 2 && n > 0) {
    let stat = 0;
    let small = 0;
    counts.forEach((r, i) =>
      r.forEach((obs, j) => {
        const exp = (rowTot[i]! * colTot[j]!) / n;
        if (exp < 5) small++;
        if (exp > 0) stat += (obs - exp) ** 2 / exp;
      }),
    );
    const df = (rowLabels.length - 1) * (colLabels.length - 1);
    const cells = rowLabels.length * colLabels.length;
    const k = Math.min(rowLabels.length, colLabels.length) - 1;
    chi2 = {
      statistic: stat,
      df,
      p: chiSquareSf(stat, df),
      cramersV: Math.sqrt(stat / (n * k)),
      smallExpectedShare: small / cells,
      reliable: small / cells <= 0.2 && n >= 30,
    };
  }
  return { n, rowLabels, colLabels, counts, rowPct, chi2 };
}

// ------------------------------------------------------------------ corrélation

export type Correlation = {
  n: number;
  r: number;
  t: number;
  df: number;
  p: number;
  strength: 'nulle' | 'faible' | 'modérée' | 'forte';
  direction: 'positive' | 'négative' | 'nulle';
};

/** Corrélation linéaire de Pearson sur les paires complètes, avec test bilatéral (t de Student). */
export function pearson(t: DataTable, x: string, y: string): Correlation | null {
  const bx = new Map(columnNumbers(t, x).map((c) => [c.row, c.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of columnNumbers(t, y)) {
    const v = bx.get(c.row);
    if (v !== undefined) {
      xs.push(v);
      ys.push(c.value);
    }
  }
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null; // variable constante : corrélation indéfinie
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const df = n - 2;
  const tt = Math.abs(r) === 1 ? Infinity : r * Math.sqrt(df / (1 - r * r));
  const p = Math.abs(r) === 1 ? 0 : studentTwoSidedP(tt, df);
  const a = Math.abs(r);
  return {
    n,
    r,
    t: tt,
    df,
    p,
    strength: a < 0.1 ? 'nulle' : a < 0.3 ? 'faible' : a < 0.5 ? 'modérée' : 'forte',
    direction: a < 0.1 ? 'nulle' : r > 0 ? 'positive' : 'négative',
  };
}
