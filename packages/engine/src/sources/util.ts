import type { SourceType } from './types';

export function url(
  base: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

export const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
export const first = <T>(v: T | T[] | undefined | null): T | undefined => asArray(v)[0];
export const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Mots du titre / résumé évoquant l'Afrique francophone (indice de repli quand aucune affiliation n'est connue). */
const AFRICA_WORDS =
  /\b(afrique|africain\w*|b[ée]nin|cameroun|s[ée]n[ée]gal|c[ôo]te d'ivoire|mali|burkina|togo|niger|gabon|congo|madagascar|maroc|tunisie|alg[ée]rie|rwanda|burundi|tchad|guin[ée]e|mauritanie|uemoa|cedeao|cemac|cames)\b/i;
export const mentionsAfrica = (...texts: (string | undefined)[]): boolean =>
  texts.some((t) => !!t && AFRICA_WORDS.test(t));

export const TYPE_BY_OPENALEX: Record<string, SourceType> = {
  article: 'article',
  review: 'article',
  preprint: 'article',
  letter: 'article',
  editorial: 'article',
  'peer-review': 'article',
  book: 'ouvrage',
  monograph: 'ouvrage',
  'reference-book': 'ouvrage',
  'book-chapter': 'chapitre',
  dissertation: 'these',
  report: 'rapport',
  'report-component': 'rapport',
  dataset: 'donnees',
  standard: 'texte_officiel',
};

export const TYPE_BY_CROSSREF: Record<string, SourceType> = {
  'journal-article': 'article',
  'proceedings-article': 'article',
  'posted-content': 'article',
  'peer-review': 'article',
  book: 'ouvrage',
  monograph: 'ouvrage',
  'edited-book': 'ouvrage',
  'reference-book': 'ouvrage',
  'book-chapter': 'chapitre',
  'book-section': 'chapitre',
  dissertation: 'these',
  report: 'rapport',
  'report-component': 'rapport',
  dataset: 'donnees',
  standard: 'texte_officiel',
};

export const TYPE_BY_HAL: Record<string, SourceType> = {
  ART: 'article',
  COMM: 'article',
  POSTER: 'article',
  PREPRINT: 'article',
  COUV: 'chapitre',
  OUV: 'ouvrage',
  DOUV: 'ouvrage',
  THESE: 'these',
  HDR: 'these',
  MEM: 'memoire',
  REPORT: 'rapport',
  OTHER: 'rapport',
  UNDEFINED: 'article',
  NOTICE: 'article',
};
