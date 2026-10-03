import { cleanAbstract, normalizeDoi, normalizeIsbn, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, SearchQuery, SourceConnector } from './types';
import { TYPE_BY_HAL, asArray, first, mentionsAfrica, str, url } from './util';

type Doc = Record<string, unknown>;
const FIELDS =
  'docid,halId_s,title_s,authFullName_s,producedDateY_i,doiId_s,uri_s,abstract_s,docType_s,language_s,fileMain_s,journalTitle_s,publisher_s,volume_s,issue_s,page_s,isbn_s,country_s';

export function mapDoc(d: Doc): CandidateSource | null {
  const title = str(first(d.title_s as string | string[]));
  if (!title) return null;
  const abstract = cleanAbstract(first(d.abstract_s as string | string[]));
  const doi = normalizeDoi(first(d.doiId_s as string | string[]));
  const country = str(first(d.country_s as string | string[]));
  return {
    origin: 'hal',
    externalId: str(d.halId_s) ?? (d.docid !== undefined ? String(d.docid) : undefined),
    type: TYPE_BY_HAL[String(d.docType_s ?? '')] ?? 'article',
    title,
    authors: asArray(d.authFullName_s as string | string[])
      .map(str)
      .filter((x): x is string => !!x),
    year: parseYear(d.producedDateY_i),
    publisher: str(first(d.publisher_s as string | string[])),
    journal: str(d.journalTitle_s),
    volume: str(first(d.volume_s as string | string[])),
    issue: str(first(d.issue_s as string | string[])),
    pages: str(first(d.page_s as string | string[])),
    doi,
    isbn: normalizeIsbn(first(d.isbn_s as string | string[])),
    url: str(d.uri_s),
    oaPdfUrl: str(d.fileMain_s),
    language: str(first(d.language_s as string | string[])),
    abstract,
    africa: country ? undefined : mentionsAfrica(title, abstract) || undefined,
  };
}

const BASE = 'https://api.archives-ouvertes.fr/search/';

/** HAL — littérature francophone : thèses, mémoires, articles (CdC §11.2). API Solr : q, fl, fq, rows, wt=json. */
export class HalConnector implements SourceConnector {
  readonly id = 'hal';
  readonly label = 'HAL';
  readonly requestsPerSecond = 3;
  constructor(private readonly http: SourceHttp) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const fq: string[] = [];
    if (q.yearFrom || q.yearTo)
      fq.push(`producedDateY_i:[${q.yearFrom ?? '*'} TO ${q.yearTo ?? '*'}]`);
    if (q.language) fq.push(`language_s:${q.language}`);
    const u = new URL(
      url(BASE, { q: q.text, wt: 'json', rows: Math.min(q.limit, 100), fl: FIELDS }),
    );
    for (const f of fq) u.searchParams.append('fq', f);
    const data = await this.http.getJson<{ response?: { docs?: Doc[] } }>(
      this.id,
      this.requestsPerSecond,
      u.toString(),
    );
    return (data?.response?.docs ?? []).map(mapDoc).filter((x): x is CandidateSource => x !== null);
  }

  async fetchByDoi(doi: string): Promise<CandidateSource | null> {
    const data = await this.http.getJson<{ response?: { docs?: Doc[] } }>(
      this.id,
      this.requestsPerSecond,
      url(BASE, { q: `doiId_s:"${doi}"`, wt: 'json', rows: 1, fl: FIELDS }),
    );
    const d = data?.response?.docs?.[0];
    return d ? mapDoc(d) : null;
  }
}
