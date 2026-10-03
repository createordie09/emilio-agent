import { normalizeForQuote } from '../research/reading-note';

/** Une phrase du texte, avec sa position dans le Markdown (pour la retrouver et la supprimer). */
export type Sentence = { text: string; start: number; end: number };

const ABBREV = new Set([
  'p',
  'pp',
  'al',
  'cf',
  'etc',
  'vol',
  'n',
  'no',
  'dr',
  'm',
  'mme',
  'mlle',
  'pr',
  'st',
  'fig',
  'éd',
  'ed',
  'ibid',
  'op',
  'cit',
  'ex',
  'env',
  'chap',
  'sect',
  'art',
]);
const MARKER = /\[@([A-Za-z]\d+)(?:\s*,\s*(?:pp?\.\s*)?([^\]]+))?\]/g;
const ANY_MARKER = /\[@[^\]]*\]/g;
const TABLE_TOKEN = /^\s*\{\{TABLEAU:([A-Za-z0-9_-]+)\}\}\s*$/;

export type Marker = { alias: string; page: string | null; raw: string; index: number };

export function markersOf(text: string): { valid: Marker[]; malformed: string[] } {
  const valid: Marker[] = [];
  for (const m of text.matchAll(MARKER))
    valid.push({ alias: m[1]!, page: m[2]?.trim() ?? null, raw: m[0], index: m.index! });
  const validRaw = new Set(valid.map((v) => v.raw));
  const malformed = [...text.matchAll(ANY_MARKER)].map((m) => m[0]).filter((r) => !validRaw.has(r));
  return { valid, malformed };
}

export const stripMarkers = (t: string): string =>
  t
    .replace(ANY_MARKER, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

export type BlockKind = 'heading' | 'table' | 'list' | 'paragraph' | 'table_token' | 'placeholder';
export type Block = { kind: BlockKind; text: string; start: number; end: number };

/** Découpe le Markdown en blocs (séparés par des lignes vides) en conservant les positions. */
export function blocksOf(md: string): Block[] {
  const out: Block[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  for (const m of md.matchAll(re)) {
    const text = m[0];
    const first = text.trimStart();
    const kind: BlockKind = /^#{1,6}\s/.test(first)
      ? 'heading'
      : TABLE_TOKEN.test(text)
        ? 'table_token'
        : /^\|/.test(first)
          ? 'table'
          : /^([-*]|\d+[.)])\s/.test(first)
            ? 'list'
            : 'paragraph';
    out.push({ kind, text, start: m.index!, end: m.index! + text.length });
  }
  return out;
}

/** Phrases des paragraphes et des listes (les titres, tableaux et jetons de tableau n'en sont pas). */
export function sentencesOf(md: string): Sentence[] {
  const out: Sentence[] = [];
  for (const b of blocksOf(md)) {
    if (b.kind !== 'paragraph' && b.kind !== 'list') continue;
    const lines = b.kind === 'list' ? b.text.split('\n') : [b.text];
    let offset = b.start;
    for (const line of lines) {
      out.push(...splitSentences(line, offset));
      offset += line.length + 1;
    }
  }
  return out;
}

function splitSentences(text: string, base: number): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const re = /[.!?…]+["»”)\]]*\s+/g;
  for (const m of text.matchAll(re)) {
    const end = m.index! + m[0].length;
    const before = text.slice(start, m.index! + 1);
    const lastWord = /([\p{L}]+)\.$/u.exec(before)?.[1]?.toLowerCase();
    const next = text.slice(end, end + 1);
    const isDecimal = /\d$/.test(text.slice(0, m.index!)) && /^\d/.test(next);
    if ((lastWord && ABBREV.has(lastWord) && m[0].startsWith('.')) || isDecimal) continue;
    if (!next || !/[\p{Lu}«[(\d{]/u.test(next)) continue;
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;

  function push(s: number, e: number) {
    const raw = text.slice(s, e);
    const t = raw.trim();
    if (!t) return;
    const lead = raw.length - raw.trimStart().length;
    out.push({ text: t, start: base + s + lead, end: base + s + lead + t.length });
  }
}

export const wordCount = (md: string): number =>
  md
    .replace(/\{\{TABLEAU:[^}]*\}\}/g, ' ')
    .replace(ANY_MARKER, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Citations directes entre guillemets français (« … »). */
export function quotesOf(text: string): string[] {
  return [...text.matchAll(/«\s*([^»]{2,}?)\s*»/g)].map((m) => m[1]!.trim());
}

export const stripQuotes = (text: string): string => text.replace(/«[^»]*»/g, ' ');

const wordsNorm = (s: string): string[] =>
  normalizeForQuote(s)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Ensemble des n-grammes de mots (n = 8, §12.4) d'un texte. */
export function ngrams(text: string, n = 8): Set<string> {
  const w = wordsNorm(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

/** Nombre de n-grammes de la phrase (hors citations entre guillemets et marqueurs) présents dans la référence. */
export function copiedNgrams(sentence: string, reference: Set<string>, n = 8): number {
  const own = ngrams(stripMarkers(stripQuotes(sentence)), n);
  let c = 0;
  for (const g of own) if (reference.has(g)) c++;
  return c;
}

/** Retire des phrases du Markdown (par position), puis les blocs devenus vides. */
export function removeSentences(md: string, sentences: Sentence[]): string {
  let out = md;
  for (const s of [...sentences].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + out.slice(s.end);
  }
  return out
    .split(/\n{2,}/)
    .map((b) =>
      b
        .replace(/[ \t]+\n/g, '\n')
        .replace(/ {2,}/g, ' ')
        .trim(),
    )
    .filter((b) => b && !/^[-*]\s*$/.test(b))
    .join('\n\n');
}

export const tableTokenId = (blockText: string): string | null =>
  TABLE_TOKEN.exec(blockText)?.[1] ?? null;
