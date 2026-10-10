import { cleanAbstract, normalizeDoi, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, OaLocation, SearchQuery, SourceConnector } from './types';
import { str, url } from './util';

type Paper = {
  paperId?: string;
  title?: string;
  year?: number | null;
  externalIds?: { DOI?: string };
  abstract?: string | null;
  authors?: { name?: string }[];
  openAccessPdf?: { url?: string } | null;
  citationCount?: number;
  venue?: string;
  journal?: { name?: string; volume?: string; pages?: string } | null;
  publicationTypes?: string[] | null;
};

export function mapPaper(p: Paper): CandidateSource | null {
  const title = str(p.title);
  if (!title) return null;
  const doi = normalizeDoi(p.externalIds?.DOI);
  const types = p.publicationTypes ?? [];
  return {
    origin: 'semantic_scholar',
    externalId: p.paperId,
    type: types.includes('Book')
      ? 'ouvrage'
      : types.includes('BookSection')
        ? 'chapitre'
        : 'article',
    title,
    authors: (p.authors ?? []).map((a) => str(a.name)).filter((x): x is string => !!x),
    year: parseYear(p.year),
    journal: str(p.journal?.name) ?? str(p.venue),
    volume: str(p.journal?.volume),
    pages: str(p.journal?.pages),
    doi,
    url: doi
      ? `https://doi.org/${doi}`
      : p.paperId
        ? `https://www.semanticscholar.org/paper/${p.paperId}`
        : undefined,
    oaPdfUrl: str(p.openAccessPdf?.url),
    abstract: cleanAbstract(p.abstract),
    citationCount: p.citationCount,
    peerReviewed: types.includes('JournalArticle') ? true : undefined,
  };
}

const BASE = 'https://api.semanticscholar.org/graph/v1';
const FIELDS =
  'title,year,externalIds,abstract,authors,openAccessPdf,citationCount,venue,journal,publicationTypes';

/** Semantic Scholar — recherche complémentaire, résumés, citations. Clé facultative (en-tête `x-api-key`). */
export class SemanticScholarConnector implements SourceConnector {
  readonly id = 'semantic_scholar';
  readonly label = 'Semantic Scholar';
  /** Sans clé, le quota est partagé et faible (≈ 100 requêtes / 5 min) : on reste très en dessous. */
  readonly requestsPerSecond: number;
  constructor(
    private readonly http: SourceHttp,
    private readonly apiKey: () => string | undefined = () => undefined,
  ) {
    this.requestsPerSecond = 0.3;
  }

  private headers(): Record<string, string> | undefined {
    const k = this.apiKey();
    return k ? { 'x-api-key': k } : undefined;
  }

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const year = q.yearFrom || q.yearTo ? `${q.yearFrom ?? ''}-${q.yearTo ?? ''}` : undefined;
    const data = await this.http.getJson<{ data?: Paper[] }>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/paper/search`, {
        query: q.text,
        limit: Math.min(q.limit, 100),
        fields: FIELDS,
        year,
      }),
      { headers: this.headers() },
    );
    return (data?.data ?? []).map(mapPaper).filter((x): x is CandidateSource => x !== null);
  }

  async fetchByDoi(doi: string): Promise<CandidateSource | null> {
    const p = await this.http.getJson<Paper>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/paper/DOI:${doi}`, { fields: FIELDS }),
      { headers: this.headers(), notFoundIsNull: true },
    );
    return p ? mapPaper(p) : null;
  }

  async openAccess(doi: string): Promise<OaLocation[]> {
    const p = await this.fetchByDoi(doi);
    return p?.oaPdfUrl ? [{ pdfUrl: p.oaPdfUrl }] : [];
  }
}
