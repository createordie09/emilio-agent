/** Nombres présents dans un texte français (« 12 500 », « 45,3 », « 0.031 »), sous forme canonique. */
const NUM =
  /(?<![\p{L}\d.,])\d{1,3}(?:[\u00a0\u202f ]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\p{L}\d.,])\d+(?:[.,]\d+)?(?![\d])/gu;

/** Forme canonique d'un nombre : « 45,0 » et « 45 » sont le même nombre ; « 45,3 » et « 45 » non. */
export const canonNumber = (n: number): string => String(Number(n.toPrecision(12)));

export const parseFrNumber = (s: string): number =>
  Number(s.replace(/[\u00a0\u202f ]/g, '').replace(',', '.'));

export type NumberToken = { raw: string; value: number; canon: string; index: number };

export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUM)) {
    // Numérotation hiérarchique « 2.3.1 » : pas un nombre.
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
    if (/^\.\d/.test(after)) continue;
    const value = parseFrNumber(m[0]);
    if (Number.isFinite(value))
      out.push({ raw: m[0], value, canon: canonNumber(value), index: m.index! });
  }
  return out;
}

export const numberSet = (text: string): Set<string> =>
  new Set(numberTokens(text).map((t) => t.canon));

/** Format français : 12 500 ; 45,3. */
export function fmtFr(n: number, digits = 1): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
    .format(n)
    .replace(/[\u202f]/g, '\u00a0');
}

export const fmtFrFixed = (n: number, digits: number): string =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(n)
    .replace(/[\u202f]/g, '\u00a0');

/** p-valeur : « p < 0,001 » ou « p = 0,031 ». */
export const fmtP = (p: number): string => (p < 0.001 ? 'p < 0,001' : `p = ${fmtFrFixed(p, 3)}`);
