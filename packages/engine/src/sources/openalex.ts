import { AFRICA_ISO2, cleanAbstract, normalizeDoi, normalizeIsbn, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, OaLocation, SearchQuery, SourceConnector } from './types';
import { TYPE_BY_OPENALEX, asArray, str, url } from './util';

type Loc = {
  is_oa?: boolean;
  landing_page_url?: string | null;
  pdf_url?: string | null;
  license?: string | null;
  version?: string | null;
  source?: { display_name?: string; type?: string } | null;
};
type Work = {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_year?: number | null;
  type?: string | null;
  language?: string | null;
  authorships?: {
    author?: { display_name?: string };
    institutions?: { country_code?: string }[];
    countries?: string[];
  }[];
  primary_location?: Loc | null;
  best_oa_location?: Loc | null;
  locations?: Loc[];
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  biblio?: {
    volume?: string | null;
    issue?: string | null;
    first_page?: string | null;
    last_page?: string | null;
  };
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  ids?: { doi?: string; isbn?: string };
};

/** Reconstitue le résumé depuis l'index inversé (OpenAlex ne publie pas de texte brut, docs « Work object »). */
export function abstractFromInverted(
  idx: Record<string, number[]> | null | undefined,
): string | undefined {
  if (!idx) return undefined;
  const words: string[] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return cleanAbstract(words.filter((w) => w !== undefined).join(' '));
}

const SELECT =
  'id,doi,display_name,publication_year,type,language,authorships,primary_location,best_oa_location,open_access,biblio,cited_by_count,abstract_inverted_index,ids';

export function mapOpenAlexWork(w: Work): CandidateSource | null {
  const title = str(w.display_name) ?? str(w.title);
  if (!title) return null;
  const countries = new Set<string>();
  for (const a of w.authorships ?? []) {
    for (const c of asArray(a.countries)) countries.add(c.toUpperCase());
    for (const i of a.institutions ?? [])
      if (i.country_code) countries.add(i.country_code.toUpperCase());
  }
  const doi = normalizeDoi(w.doi);
  const loc = w.primary_location;
  const pages = [w.biblio?.first_page, w.biblio?.last_page].filter(Boolean).join('-') || undefined;
  return {
    origin: 'openalex',
    externalId: w.id,
    type: TYPE_BY_OPENALEX[w.type ?? ''] ?? 'article',
    title,
    authors: (w.authorships ?? [])
      .map((a) => str(a.author?.display_name))
      .filter((x): x is string => !!x),
    year: parseYear(w.publication_year),
    journal: str(loc?.source?.display_name),
    volume: str(w.biblio?.volume),
    issue: str(w.biblio?.issue),
    pages,
    doi,
    isbn: normalizeIsbn(w.ids?.isbn),
    url: str(loc?.landing_page_url) ?? (doi ? `https://doi.org/${doi}` : undefined),
    oaPdfUrl: str(w.best_oa_location?.pdf_url) ?? str(w.open_access?.oa_url),
    language: str(w.language),
    abstract: abstractFromInverted(w.abstract_inverted_index),
    citationCount: w.cited_by_count,
    peerReviewed: loc?.source?.type === 'journal' ? true : undefined,
    africa: [...countries].some((c) => AFRICA_ISO2.has(c)) || undefined,
  };
}

const BASE = 'https://api.openalex.org';

/** OpenAlex — recherche principale (CdC §11.2). Documentation : search, filter, select, per-page, mailto (polite pool). */
export class OpenAlexConnector implements SourceConnector {
  readonly id = 'openalex';
  readonly label = 'OpenAlex';
  readonly requestsPerSecond = 8;
  constructor(private readonly http: SourceHttp) {}

  private mailto() {
    return this.http.email();
  }

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const filters: string[] = [];
    if (q.language) filters.push(`language:${q.language}`);
    if (q.yearFrom) filters.push(`from_publication_date:${q.yearFrom}-01-01`);
    if (q.yearTo) filters.push(`to_publication_date:${q.yearTo}-12-31`);
    const data = await this.http.getJson<{ results?: Work[] }>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/works`, {
        search: q.text,
        filter: filters.join(',') || undefined,
        'per-page': Math.min(q.limit, 200),
        select: SELECT,
        mailto: this.mailto(),
      }),
    );
    return (data?.results ?? [])
      .map(mapOpenAlexWork)
      .filter((x): x is CandidateSource => x !== null);
  }

  async fetchByDoi(doi: string): Promise<CandidateSource | null> {
    const w = await this.http.getJson<Work>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/works/https://doi.org/${doi}`, { select: SELECT, mailto: this.mailto() }),
      { notFoundIsNull: true },
    );
    return w ? mapOpenAlexWork(w) : null;
  }

  async openAccess(doi: string): Promise<OaLocation[]> {
    const w = await this.http.getJson<Work>(
      this.id,
      this.requestsPerSecond,
      url(`${BASE}/works/https://doi.org/${doi}`, {
        select: 'best_oa_location,locations,open_access',
        mailto: this.mailto(),
      }),
      { notFoundIsNull: true },
    );
    return [w?.best_oa_location, ...(w?.locations ?? [])]
      .filter((l): l is Loc => !!l && l.is_oa !== false && !!(l.pdf_url || l.landing_page_url))
      .map((l) => ({
        pdfUrl: l.pdf_url ?? undefined,
        landingUrl: l.landing_page_url ?? undefined,
        license: l.license ?? undefined,
        version: l.version ?? undefined,
      }));
  }
}
