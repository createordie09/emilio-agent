import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import Papa from 'papaparse';
import { AppError, type ColumnProfile, type DataProfile } from '@emilio/shared';

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'nd', 'n.d.', '#n/a', '-', '—']);
const isMissing = (v: string): boolean => MISSING.has(v.trim().toLowerCase());

const BOOL_TRUE = new Set(['oui', 'vrai', 'true', 'yes']);
const BOOL_FALSE = new Set(['non', 'faux', 'false', 'no']);
const NUM = /^-?\d{1,3}([\u00a0\u202f ]\d{3})+([.,]\d+)?$|^-?\d+([.,]\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;

export const parseNumber = (s: string): number =>
  Number(
    s
      .trim()
      .replace(/[\u00a0\u202f ]/g, '')
      .replace(',', '.'),
  );

function numericStats(nums: number[]): NonNullable<ColumnProfile['numeric']> {
  const a = [...nums].sort((x, y) => x - y);
  const n = a.length;
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? a[(n - 1) / 2]! : (a[n / 2 - 1]! + a[n / 2]!) / 2;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { min: a[0]!, max: a[n - 1]!, mean, median, sd };
}

function profileColumn(name: string, values: string[]): ColumnProfile {
  const present = values.filter((v) => !isMissing(v)).map((v) => v.trim());
  const base = { name, nonMissing: present.length, missing: values.length - present.length };
  const counts = new Map<string, number>();
  for (const v of present) counts.set(v, (counts.get(v) ?? 0) + 1);
  const distinct = counts.size;
  const modalities = () =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([value, count]) => ({ value, count }));
  if (!present.length) return { ...base, type: 'text', distinct: 0 };

  if (present.every((v) => BOOL_TRUE.has(v.toLowerCase()) || BOOL_FALSE.has(v.toLowerCase()))) {
    return { ...base, type: 'boolean', distinct, modalities: modalities() };
  }
  if (present.every((v) => NUM.test(v))) {
    const nums = present.map(parseNumber);
    const integer = nums.every(Number.isInteger);
    // Échelles (Likert, effectifs codés) : on garde aussi les modalités.
    return {
      ...base,
      type: integer ? 'integer' : 'number',
      distinct,
      numeric: numericStats(nums),
      ...(distinct <= 10 ? { modalities: modalities() } : {}),
    };
  }
  if (present.every((v) => DATE.test(v))) return { ...base, type: 'date', distinct };
  const avgLen = present.reduce((s, v) => s + v.length, 0) / present.length;
  if (distinct <= 20 || (present.length >= 40 && distinct / present.length <= 0.05)) {
    if (avgLen <= 60) return { ...base, type: 'categorical', distinct, modalities: modalities() };
  }
  return { ...base, type: 'text', distinct };
}

function buildProfile(headers: string[], rows: string[][], sheet?: string): DataProfile {
  const names = headers.map((h, i) => (h.trim() ? h.trim() : `Colonne ${i + 1}`));
  const seen = new Map<string, number>();
  const unique = names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n} (${k})`;
  });
  const columns = unique.map((n, i) =>
    profileColumn(
      n,
      rows.map((r) => r[i] ?? ''),
    ),
  );
  const warnings: string[] = [];
  if (rows.length === 0) warnings.push('Aucune ligne de données trouvée.');
  else if (rows.length < 30)
    warnings.push(
      `Échantillon très réduit (${rows.length} lignes) : les analyses statistiques seront limitées.`,
    );
  for (const c of columns) {
    if (c.nonMissing === 0) warnings.push(`La colonne « ${c.name} » est entièrement vide.`);
    else if (c.missing / (c.missing + c.nonMissing) > 0.5)
      warnings.push(`La colonne « ${c.name} » est vide à plus de 50 %.`);
  }
  const keys = new Set<string>();
  let dup = 0;
  for (const r of rows) {
    const k = r.join('\u0001');
    if (keys.has(k)) dup++;
    keys.add(k);
  }
  if (dup > 0) warnings.push(`${dup} ligne(s) en double détectée(s) : à vérifier avant l'analyse.`);
  return {
    sheet,
    respondents: rows.length,
    columns,
    sample: rows.slice(0, 5).map((r) => Object.fromEntries(unique.map((n, i) => [n, r[i] ?? '']))),
    warnings,
  };
}

function decode(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

async function profileCsv(path: string): Promise<DataProfile> {
  const text = decode(await readFile(path));
  const res = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  const rows = res.data;
  if (!rows.length) return buildProfile([], []);
  const profile = buildProfile(
    rows[0]!.map(String),
    rows.slice(1).map((r) => r.map((c) => String(c ?? ''))),
  );
  if (res.errors.length)
    profile.warnings.push(`${res.errors.length} ligne(s) mal formée(s) dans le fichier CSV.`);
  return profile;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return String(o.text);
    return '';
  }
  return String(v);
}

async function profileXlsx(path: string): Promise<DataProfile> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets = wb.worksheets.filter((s) => s.actualRowCount > 0);
  if (!sheets.length) return buildProfile([], []);
  const main = sheets.reduce((a, b) => (b.actualRowCount > a.actualRowCount ? b : a));
  const grid: string[][] = [];
  main.eachRow({ includeEmpty: false }, (row) => {
    const r: string[] = [];
    for (let c = 1; c <= main.columnCount; c++) r.push(cellText(row.getCell(c).value));
    grid.push(r);
  });
  const profile = buildProfile(grid[0] ?? [], grid.slice(1), main.name);
  if (sheets.length > 1)
    profile.warnings.push(
      `Le classeur contient ${sheets.length} feuilles ; seule la plus grande (« ${main.name} ») est analysée.`,
    );
  return profile;
}

/** Profil des données de terrain : répondants, variables, types, valeurs manquantes, modalités (§9 P0.4). Calculs faits par du code. */
export async function profileDataFile(path: string, filename = path): Promise<DataProfile> {
  const ext = extname(filename).toLowerCase();
  try {
    if (ext === '.csv') return await profileCsv(path);
    if (ext === '.xlsx') return await profileXlsx(path);
  } catch (e) {
    throw new AppError('E_PARSE_FILE', `${filename} : ${(e as Error).message}`);
  }
  throw new AppError(
    'E_PARSE_FILE',
    `${filename} : seuls les fichiers CSV et XLSX sont acceptés pour les données de terrain`,
  );
}
