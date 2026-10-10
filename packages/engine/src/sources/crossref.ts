import { cleanAbstract, normalizeDoi, normalizeIsbn, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, SearchQuery, SourceConnector } from './types';
import { TYPE_BY_CROSSREF, first, str, url } from './util';

type Item = {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { 'date-parts'?: (number | null)[][] };
  'container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  type?: string;
  URL?: string;
  ISBN?: string[];
  abstract?: string;
  'is-referenced-by-count'?: number;
  language?: string;
  link?: { URL?: string; 'content-type'?: string }[];
};

export function mapItem(w: Item): CandidateSource | null {
  const title = str(first(w.title));
  if (!title) return null;
  const doi = normalizeDoi(w.DOI);
  const pdf = w.link?.find(
    (l) => /pdf/i.test(l.URL ?? '') || l['content-type'] === 'application/pdf',
  )?.URL;
  return {
    origin: 'crossref',
    externalId: doi,
    type: TYPE_BY_CROSSREF[w.type ?? ''] ?? 'article',
    title,
    authors: (w.author ?? [])
      .map((a) => str([a.family, a.given].filter(Boolean).join(', ')) ?? str(a.name))
      .filter((x): x is string => !!x),
    year: parseYear(w.issued?.['date-parts']?.[0]?.[0]),
    publisher: str(w.publisher),
    journal: str(first(w['container-title'])),
    volume: str(w.volume),
    issue: str(w.issue),
    pages: str(w.page),
    doi,
    isbn: normalizeIsbn(first(w.ISBN)),
    url: str(w.URL) ?? (doi ? `https://doi.org/${doi}` : undefined),
    oaPdfUrl: pdf,
    language: str(w.language),
    abstract: cleanAbstract(w.abstract),
    citationCount: w['is-referenced-by-count'],
    // Crossref ne dit pas si une revue est évaluée par les pairs : on ne l'affirme pas.
  };
}

const BASE = 'https://api.crossref.org';
const SELECT =
  'DOI,title,author,issued,container-title,volume,issue,page,publisher,type,URL,ISBN,abstract,is-referenced-by-count,language,link';

/** Crossref — vérification des DOI et métadonnées de référence (CdC §11.2, §12.1). */
export class CrossrefConnector implements SourceConnector {
  readonly id = 'crossref';
  readonly label = 'Crossref';
  readonly requestsPerSecond = 5;
  constructor(private readonly http: SourceHttp) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const filter = [
      q.yearFrom && `from-pub-date:${q.yearFrom}`,
      q.yearTo && `until-pub-date:${q.yearTo}`,
    ]
      .filter(Boolean)
      .join(',');
    const data = await this.http.getJson<{ message?: { items?: Item[] } }>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/works`, {
        'query.bibliographic': q.text,
        rows: Math.min(q.limit, 100),
        select: SELECT,
        filter: filter || undefined,
        mailto: this.http.email(),
      }),
    );
    return (data?.message?.items ?? [])
      .map(mapItem)
      .filter((x): x is CandidateSource => x !== null);
  }

  async fetchByDoi(doi: string): Promise<CandidateSource | null> {
    const data = await this.http.getJson<{ message?: Item }>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/works/${doi.split('/').map(encodeURIComponent).join('/')}`, {
        mailto: this.http.email(),
      }),
      { notFoundIsNull: true },
    );
    return data?.message ? mapItem(data.message) : null;
  }
}
