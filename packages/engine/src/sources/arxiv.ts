import { XMLParser } from 'fast-xml-parser';
import { cleanAbstract, normalizeDoi, parseYear } from './normalize';
import type { SourceHttp } from './http';
import type { CandidateSource, SearchQuery, SourceConnector } from './types';
import { asArray, str, url } from './util';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: false,
});

type Entry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  'arxiv:doi'?: string | { '#text'?: string };
  'arxiv:journal_ref'?: string | { '#text'?: string };
  author?: { name?: string } | { name?: string }[];
  link?:
    | { '@_href'?: string; '@_title'?: string; '@_type'?: string }
    | { '@_href'?: string; '@_title'?: string; '@_type'?: string }[];
};

const text = (v: string | { '#text'?: string } | undefined) =>
  typeof v === 'string' ? v : v?.['#text'];

/** Analyse du flux Atom 1.0 de l'API arXiv (manuel officiel : `<entry>`, `<title>`, `<summary>`, `<published>`, `<author><name>`, lien `title="pdf"`). */
export function parseAtom(xml: string): CandidateSource[] {
  const feed = (parser.parse(xml) as { feed?: { entry?: Entry | Entry[] } }).feed;
  const out: CandidateSource[] = [];
  for (const e of asArray(feed?.entry)) {
    const title = str(e.title)?.replace(/\s+/g, ' ');
    if (!title || /^error$/i.test(title)) continue; // en cas d'erreur, l'API renvoie une unique entrée « Error »
    const pdf = asArray(e.link).find((l) => l['@_title'] === 'pdf')?.['@_href'];
    const doi = normalizeDoi(text(e['arxiv:doi']));
    out.push({
      origin: 'arxiv',
      externalId: str(e.id)?.replace(/^https?:\/\/arxiv\.org\/abs\//, ''),
      type: 'article',
      title,
      authors: asArray(e.author)
        .map((a) => str(a.name))
        .filter((x): x is string => !!x),
      year: parseYear(e.published),
      journal: str(text(e['arxiv:journal_ref'])),
      doi,
      url: str(e.id),
      oaPdfUrl: pdf?.replace(/^http:/, 'https:'),
      abstract: cleanAbstract(e.summary),
      language: 'en',
    });
  }
  return out;
}

/** arXiv — sciences exactes, informatique, économie (CdC §11.2). Limite du service : ≈ 1 requête / 3 s. */
export class ArxivConnector implements SourceConnector {
  readonly id = 'arxiv';
  readonly label = 'arXiv';
  readonly requestsPerSecond = 0.33;
  constructor(private readonly http: SourceHttp) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    const terms = q.text
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `all:${t.replace(/[^\p{L}\p{N}]/gu, '')}`)
      .filter((t) => t.length > 4);
    if (!terms.length) return [];
    const xml = await this.http.getText(
      this.id,
      this.requestsPerSecond,
      url('https://export.arxiv.org/api/query', {
        search_query: terms.join(' AND '),
        start: 0,
        max_results: Math.min(q.limit, 100),
        sortBy: 'relevance',
      }),
    );
    const all = xml ? parseAtom(xml) : [];
    return all.filter(
      (c) =>
        (!q.yearFrom || (c.year ?? 0) >= q.yearFrom) && (!q.yearTo || (c.year ?? 9999) <= q.yearTo),
    );
  }
}
