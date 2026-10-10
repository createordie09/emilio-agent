import { cleanAbstract, normalizeDoi, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, SearchQuery, SourceConnector } from './types';
import { asArray, str, url } from './util';

type Hit = {
  id?: string;
  bibjson?: {
    title?: string;
    abstract?: string;
    year?: string | number;
    start_page?: string;
    end_page?: string;
    author?: { name?: string }[];
    journal?: {
      title?: string;
      volume?: string;
      number?: string;
      publisher?: string;
      language?: string[];
    };
    identifier?: { type?: string; id?: string }[];
    link?: { type?: string; url?: string; content_type?: string }[];
  };
};

export function mapHit(h: Hit): CandidateSource | null {
  const b = h.bibjson;
  const title = str(b?.title);
  if (!b || !title) return null;
  const doi = normalizeDoi(b.identifier?.find((i) => i.type?.toLowerCase() === 'doi')?.id);
  const full = asArray(b.link).find((l) => l.type === 'fulltext');
  return {
    origin: 'doaj',
    externalId: h.id,
    type: 'article',
    title,
    authors: asArray(b.author)
      .map((a) => str(a.name))
      .filter((x): x is string => !!x),
    year: parseYear(b.year),
    publisher: str(b.journal?.publisher),
    journal: str(b.journal?.title),
    volume: str(b.journal?.volume),
    issue: str(b.journal?.number),
    pages: [b.start_page, b.end_page].filter(Boolean).join('-') || undefined,
    doi,
    url: str(full?.url) ?? (doi ? `https://doi.org/${doi}` : undefined),
    oaPdfUrl: /pdf/i.test(full?.content_type ?? '') ? str(full?.url) : undefined,
    language: str(b.journal?.language?.[0])?.toLowerCase(),
    abstract: cleanAbstract(b.abstract),
    // Revues indexées au DOAJ : sélection éditoriale (critères de qualité du répertoire).
    peerReviewed: true,
  };
}

/** DOAJ — revues en accès ouvert (CdC §11.2). */
export class DoajConnector implements SourceConnector {
  readonly id = 'doaj';
  readonly label = 'DOAJ';
  readonly requestsPerSecond = 2;
  constructor(private readonly http: SourceHttp) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const data = await this.http.getJson<{ results?: Hit[] }>(
      this.id,
      this.requestsPerSecond,
      url(`https://doaj.org/api/search/articles/${encodeURIComponent(q.text)}`, {
        pageSize: Math.min(q.limit, 100),
      }),
    );
    const all = (data?.results ?? []).map(mapHit).filter((x): x is CandidateSource => x !== null);
    return all.filter(
      (c) =>
        (!q.yearFrom || (c.year ?? 0) >= q.yearFrom) && (!q.yearTo || (c.year ?? 9999) <= q.yearTo),
    );
  }
}
