import { cleanAbstract, normalizeDoi, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, SearchQuery, SourceConnector } from './types';
import { asArray, str, url } from './util';

type R = {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  pubYear?: string | number;
  authorList?: { author?: { fullName?: string; lastName?: string; firstName?: string }[] };
  journalInfo?: { volume?: string; issue?: string; journal?: { title?: string } };
  pageInfo?: string;
  abstractText?: string;
  language?: string;
  citedByCount?: number;
  pubType?: string;
  isOpenAccess?: string;
  fullTextUrlList?: {
    fullTextUrl?: { url?: string; documentStyle?: string; availability?: string }[];
  };
};

export function mapResult(r: R): CandidateSource | null {
  const title = str(r.title)
    ?.replace(/<[^>]+>/g, '')
    .replace(/\.$/, '');
  if (!title) return null;
  const authors = (r.authorList?.author ?? [])
    .map((a) => str(a.fullName) ?? str([a.lastName, a.firstName].filter(Boolean).join(', ')))
    .filter((x): x is string => !!x);
  const pdf = asArray(r.fullTextUrlList?.fullTextUrl).find(
    (u) => u.documentStyle === 'pdf' && /open/i.test(u.availability ?? ''),
  )?.url;
  const doi = normalizeDoi(r.doi);
  return {
    origin: 'europepmc',
    externalId: r.source && r.id ? `${r.source}:${r.id}` : r.id,
    type: /book/i.test(r.pubType ?? '') ? 'ouvrage' : 'article',
    title,
    authors: authors.length
      ? authors
      : (r.authorString ?? '')
          .split(/,\s*/)
          .map(str)
          .filter((x): x is string => !!x),
    year: parseYear(r.pubYear),
    journal: str(r.journalInfo?.journal?.title),
    volume: str(r.journalInfo?.volume),
    issue: str(r.journalInfo?.issue),
    pages: str(r.pageInfo),
    doi,
    url: doi
      ? `https://doi.org/${doi}`
      : r.pmid
        ? `https://europepmc.org/article/MED/${r.pmid}`
        : undefined,
    oaPdfUrl: pdf,
    language: str(r.language),
    abstract: cleanAbstract(r.abstractText),
    citationCount: r.citedByCount,
  };
}

/** Europe PMC — santé publique, médecine (CdC §11.2). `resultType=core` pour résumé et liens de texte intégral. */
export class EuropePmcConnector implements SourceConnector {
  readonly id = 'europepmc';
  readonly label = 'Europe PMC';
  readonly requestsPerSecond = 5;
  constructor(private readonly http: SourceHttp) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const years =
      q.yearFrom || q.yearTo
        ? ` AND (PUB_YEAR:[${q.yearFrom ?? 1900} TO ${q.yearTo ?? new Date().getFullYear()}])`
        : '';
    const data = await this.http.getJson<{ resultList?: { result?: R[] } }>(
      this.id,
      this.requestsPerSecond,
      url('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
        query: q.text + years,
        format: 'json',
        resultType: 'core',
        pageSize: Math.min(q.limit, 100),
      }),
    );
    return (data?.resultList?.result ?? [])
      .map(mapResult)
      .filter((x): x is CandidateSource => x !== null);
  }
}
