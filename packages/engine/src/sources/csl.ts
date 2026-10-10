import type { CandidateSource, SourceType } from './types';

const CSL_TYPE: Record<SourceType, string> = {
  article: 'article-journal',
  ouvrage: 'book',
  chapitre: 'chapter',
  these: 'thesis',
  memoire: 'thesis',
  rapport: 'report',
  texte_officiel: 'legislation',
  site_web: 'webpage',
  donnees: 'dataset',
};

/** Notice au format CSL-JSON (colonne `sources.csl_json`, mise en forme bibliographique en J8). */
export function toCsl(c: CandidateSource, id: string): Record<string, unknown> {
  const author = c.authors.map((a) => {
    if (a.includes(',')) {
      const [family, given] = a.split(',').map((s) => s.trim());
      return { family, given };
    }
    const parts = a.trim().split(/\s+/);
    return parts.length > 1
      ? { family: parts.at(-1), given: parts.slice(0, -1).join(' ') }
      : { literal: a };
  });
  return {
    id,
    type: CSL_TYPE[c.type] ?? 'article-journal',
    title: c.title,
    ...(author.length ? { author } : {}),
    ...(c.year ? { issued: { 'date-parts': [[c.year]] } } : {}),
    ...(c.journal ? { 'container-title': c.journal } : {}),
    ...(c.volume ? { volume: c.volume } : {}),
    ...(c.issue ? { issue: c.issue } : {}),
    ...(c.pages ? { page: c.pages } : {}),
    ...(c.publisher ? { publisher: c.publisher } : {}),
    ...(c.doi ? { DOI: c.doi } : {}),
    ...(c.isbn ? { ISBN: c.isbn } : {}),
    ...(c.url ? { URL: c.url } : {}),
    ...(c.language ? { language: c.language } : {}),
  };
}
