import { AppError } from '@emilio/shared';
import { cleanAbstract, normalizeDoi, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, SearchQuery, SourceConnector } from './types';
import { asArray, str, url } from './util';

type W = {
  id?: number | string;
  doi?: string | null;
  title?: string;
  authors?: { name?: string }[];
  abstract?: string | null;
  yearPublished?: number | null;
  downloadUrl?: string | null;
  publisher?: string | null;
  language?: { code?: string } | null;
  journals?: { title?: string }[];
  documentType?: string | null;
  links?: { type?: string; url?: string }[];
};

export function mapCoreWork(w: W): CandidateSource | null {
  const title = str(w.title);
  if (!title) return null;
  const doi = normalizeDoi(w.doi);
  const dt = (w.documentType ?? '').toLowerCase();
  return {
    origin: 'core',
    externalId: w.id !== undefined ? String(w.id) : undefined,
    type: dt.includes('thesis')
      ? 'these'
      : dt.includes('book')
        ? 'ouvrage'
        : dt.includes('report')
          ? 'rapport'
          : 'article',
    title,
    authors: asArray(w.authors)
      .map((a) => str(a.name))
      .filter((x): x is string => !!x),
    year: parseYear(w.yearPublished),
    publisher: str(w.publisher),
    journal: str(w.journals?.[0]?.title),
    doi,
    url: doi
      ? `https://doi.org/${doi}`
      : (str(w.links?.find((l) => l.type === 'reader')?.url) ?? str(w.downloadUrl)),
    oaPdfUrl: str(w.downloadUrl),
    language: str(w.language?.code),
    abstract: cleanAbstract(w.abstract),
  };
}

/** CORE — textes intégraux en accès ouvert (CdC §11.2). Clé d'API gratuite requise (en-tête `Authorization: Bearer`). */
export class CoreConnector implements SourceConnector {
  readonly id = 'core';
  readonly label = 'CORE';
  readonly requestsPerSecond = 0.15;
  constructor(
    private readonly http: SourceHttp,
    private readonly apiKey: () => string | undefined,
  ) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const key = this.apiKey();
    if (!key)
      throw new AppError(
        'E_KEY_MISSING',
        'CORE exige une clé d’API gratuite (Paramètres → Sources documentaires).',
      );
    const yr =
      q.yearFrom || q.yearTo
        ? ` AND yearPublished>=${q.yearFrom ?? 1900} AND yearPublished<=${q.yearTo ?? new Date().getFullYear()}`
        : '';
    const data = await this.http.getJson<{ results?: W[] }>(
      this.id,
      this.requestsPerSecond,
      url('https://api.core.ac.uk/v3/search/works', {
        q: q.text + yr,
        limit: Math.min(q.limit, 100),
      }),
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return (data?.results ?? []).map(mapCoreWork).filter((x): x is CandidateSource => x !== null);
  }
}
