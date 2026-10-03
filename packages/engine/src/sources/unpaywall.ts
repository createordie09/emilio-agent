import { AppError } from '@emilio/shared';
import type { SourceHttp } from './http';
import type { CandidateSource, OaLocation, SearchQuery, SourceConnector } from './types';
import { str, url } from './util';

type Loc = {
  url?: string | null;
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  license?: string | null;
  version?: string | null;
  host_type?: string | null;
};
type Resp = { is_oa?: boolean; best_oa_location?: Loc | null; oa_locations?: Loc[] };

export function locationsOf(r: Resp): OaLocation[] {
  const all = [r.best_oa_location, ...(r.oa_locations ?? [])].filter((l): l is Loc => !!l);
  const seen = new Set<string>();
  const out: OaLocation[] = [];
  for (const l of all) {
    const key = `${l.url_for_pdf ?? ''}|${l.url ?? ''}`;
    if (seen.has(key) || !(l.url_for_pdf || l.url)) continue;
    seen.add(key);
    out.push({
      pdfUrl: str(l.url_for_pdf),
      landingUrl: str(l.url_for_landing_page) ?? str(l.url),
      license: str(l.license),
      version: str(l.version),
      hostType: str(l.host_type),
    });
  }
  // PDF direct d'abord, puis version publiée > acceptée > soumise.
  const rank = (l: OaLocation) =>
    (l.pdfUrl ? 0 : 10) +
    (l.version === 'publishedVersion' ? 0 : l.version === 'acceptedVersion' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Unpaywall — version en accès ouvert d'un DOI. L'adresse e-mail de contact est OBLIGATOIRE (paramètre `email`). */
export class UnpaywallConnector implements SourceConnector {
  readonly id = 'unpaywall';
  readonly label = 'Unpaywall';
  readonly requestsPerSecond = 5;
  constructor(private readonly http: SourceHttp) {}

  async search(_q: SearchQuery): Promise<CandidateSource[]> {
    return []; // Unpaywall ne propose pas de recherche : il ne sert qu'à résoudre un DOI.
  }

  async openAccess(doi: string): Promise<OaLocation[]> {
    const email = this.http.email();
    if (!email)
      throw new AppError(
        'E_KEY_MISSING',
        'Unpaywall exige une adresse e-mail de contact (Paramètres → Sources documentaires).',
      );
    const r = await this.http.getJson<Resp>(
      this.id,
      this.requestsPerSecond,
      url(`https://api.unpaywall.org/v2/${doi.split('/').map(encodeURIComponent).join('/')}`, {
        email,
      }),
      { notFoundIsNull: true },
    );
    return r ? locationsOf(r) : [];
  }
}
