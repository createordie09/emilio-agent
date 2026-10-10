import { normalizeIsbn } from './normalize';
import type { SourceHttp } from './http';
import { asArray, str, url } from './util';

export type BookRecord = {
  title: string;
  authors: string[];
  publishers: string[];
  publishDate?: string;
  url?: string;
};

type Raw = {
  title?: string;
  authors?: { name?: string }[];
  publishers?: { name?: string }[];
  publish_date?: string;
  url?: string;
};

/** Open Library — vérification d'un ISBN (CdC §12.1.2) : `GET /api/books?bibkeys=ISBN:…&format=json&jscmd=data`. */
export class OpenLibrary {
  readonly id = 'openlibrary';
  readonly requestsPerSecond = 2;
  constructor(private readonly http: SourceHttp) {}

  async byIsbn(isbn: string): Promise<BookRecord | null> {
    const n = normalizeIsbn(isbn);
    if (!n) return null;
    const data = await this.http.getJson<Record<string, Raw>>(
      this.id,
      this.requestsPerSecond,
      url('https://openlibrary.org/api/books', {
        bibkeys: `ISBN:${n}`,
        format: 'json',
        jscmd: 'data',
      }),
    );
    const r = data?.[`ISBN:${n}`];
    const title = str(r?.title);
    if (!r || !title) return null;
    return {
      title,
      authors: asArray(r.authors)
        .map((a) => str(a.name))
        .filter((x): x is string => !!x),
      publishers: asArray(r.publishers)
        .map((p) => str(p.name))
        .filter((x): x is string => !!x),
      publishDate: str(r.publish_date),
      url: str(r.url),
    };
  }
}
