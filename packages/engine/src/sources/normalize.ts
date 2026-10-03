import { foldText } from '../kb/embeddings';

/** DOI normalisé : minuscules, sans `https://doi.org/` ni `doi:` ; `undefined` si invalide. */
export function normalizeDoi(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /10\.\d{4,9}\/\S+/i.exec(decodeURIComponentSafe(raw.trim()));
  return m ? m[0].toLowerCase().replace(/[)\].,;]+$/, '') : undefined;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Titre normalisé pour la comparaison : sans accents, minuscules, sans ponctuation ni balises. */
export function normalizeTitle(t: string): string {
  return foldText(t.replace(/<[^>]+>/g, ' '))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Similarité de titres dans [0,1] : coefficient de Dice sur les bigrammes de caractères. */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++)
      m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let inter = 0;
  for (const [g, n] of gx) inter += Math.min(n, gy.get(g) ?? 0);
  return (2 * inter) / (Math.max(1, x.length - 1) + Math.max(1, y.length - 1));
}

/** Nom de famille d'un auteur (« Prénom Nom », « Nom, Prénom » ou nom seul), sans accents. */
export function authorSurname(name: string): string {
  const n = name.trim();
  const part = n.includes(',') ? n.split(',')[0]! : (n.split(/\s+/).at(-1) ?? n);
  return foldText(part).replace(/[^a-z]/g, '');
}

/** Année plausible (1400 → année en cours + 1) ou `undefined`. */
export function parseYear(v: unknown): number | undefined {
  const n =
    typeof v === 'number' ? v : Number(/\b(1[4-9]\d{2}|20\d{2})\b/.exec(String(v ?? ''))?.[1]);
  return Number.isFinite(n) && n >= 1400 && n <= new Date().getFullYear() + 1 ? n : undefined;
}

/** Retire les balises JATS / HTML d'un résumé et normalise les espaces. */
export function cleanAbstract(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 20 ? t : undefined;
}

/** ISBN-10 / ISBN-13 normalisé (chiffres seuls) si la somme de contrôle est valide. */
export function normalizeIsbn(raw: string | null | undefined): string | undefined {
  const s = (raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 10) {
    const sum = [...s].reduce((a, c, i) => a + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0 ? s : undefined;
  }
  if (s.length === 13) {
    const sum = [...s].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? s : undefined;
  }
  return undefined;
}

/** Pays africains (ISO 3166-1 alpha-2) — pour le bonus `prioriteAfrique` (§11.4). */
export const AFRICA_ISO2 = new Set(
  'DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.split(
    ' ',
  ),
);
