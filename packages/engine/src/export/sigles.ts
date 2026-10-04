export type Sigle = { sigle: string; definition: string | null };

const SMALL = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'et',
  'en',
  'au',
  'aux',
  'pour',
  'sur',
  'dans',
  "d'",
  'l',
  'à',
  'a',
  'un',
  'une',
  'par',
]);
const ROMAN = /^[IVXLCDM]+$/;
/** Sigles courants qui n'ont pas besoin d'être définis (et formats de fichiers). */
const COMMON = new Set([
  'PDF',
  'URL',
  'DOI',
  'ISBN',
  'ISSN',
  'OK',
  'ISO',
  'APA',
  'CSV',
  'XLSX',
  'TVA',
  'PIB',
  'ONG',
]);

const words = (s: string): string[] => s.split(/[\s’'-]+/).filter(Boolean);
const initialOf = (w: string): string => w.normalize('NFD').replace(/[̀-ͯ]/g, '')[0]!.toUpperCase();

/** Cherche, juste avant « (SIGLE) », les mots dont les initiales forment le sigle. */
function definitionBefore(before: string, sigle: string): string | null {
  const ws = words(before).slice(-(sigle.length + 5));
  const letters = [...sigle.replace(/s$/, '')];
  let li = letters.length - 1;
  let start = ws.length;
  for (let i = ws.length - 1; i >= 0 && li >= 0; i--) {
    const w = ws[i]!;
    if (SMALL.has(w.toLowerCase())) {
      start = i;
      continue;
    }
    if (initialOf(w) === letters[li]) {
      li--;
      start = i;
    } else return null;
  }
  if (li >= 0) return null;
  // Reconstitue la définition telle qu'écrite (premier mot retenu → fin).
  const first = ws[start]!;
  const idx = before.lastIndexOf(first);
  return idx >= 0 ? before.slice(idx).trim() : ws.slice(start).join(' ');
}

/**
 * Sigles et abréviations (CdC §9 P8.3) : extraction automatique. Le sigle est défini quand le texte le définit lui-même
 * (« Institution de microfinance (IMF) ») ; un sigle utilisé sans définition n'est jamais défini par le code (aucune invention) :
 * `definition = null` → emplacement « [À COMPLÉTER] » dans le document.
 */
export function extractSigles(
  texts: string[],
  opts: { minLetters: number; maxLetters: number; minOccurrences: number },
): Sigle[] {
  const defined = new Map<string, string>();
  const counts = new Map<string, number>();
  const all = texts.join('\n');
  const defRe = /([^()\n]{3,120}?)\s*\(\s*([A-ZÉÈ][A-ZÉÈ]{1,7}s?)\s*\)/gu;
  for (const m of all.matchAll(defRe)) {
    const sigle = m[2]!;
    if (defined.has(sigle)) continue;
    const def = definitionBefore(m[1]!, sigle);
    if (def) defined.set(sigle, def.charAt(0).toUpperCase() + def.slice(1));
  }
  const reUse = new RegExp(
    `(?<![\\p{L}\\d])[A-ZÉÈ]{${opts.minLetters},${opts.maxLetters}}s?(?![\\p{L}\\d])`,
    'gu',
  );
  for (const m of all.matchAll(reUse)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const out: Sigle[] = [];
  for (const [s, n] of counts) {
    if (ROMAN.test(s) || COMMON.has(s)) continue;
    const def = defined.get(s) ?? null;
    if (def || n >= Math.max(2, opts.minOccurrences)) out.push({ sigle: s, definition: def });
  }
  return out.sort((a, b) => a.sigle.localeCompare(b.sigle, 'fr'));
}
