import { MOCK_CORPUS } from './mock';

/** Octets WinAnsi (Latin-1) d'une chaîne, avec échappement des caractères spéciaux PDF. */
function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code < 128) out += ch;
    else if (code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
    else out += code === 0x2019 ? "'" : code === 0x2013 || code === 0x2014 ? '-' : '?';
  }
  return out;
}

/** PDF minimal valide (Helvetica, une page par bloc de lignes) — sert au mode simulé pour exercer le texte intégral. */
export function makeTextPdf(lines: string[], linesPerPage = 40): Buffer {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
  if (!pages.length) pages.push(['']);
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) && objs.length;
  const catalog = add('');
  const pagesObj = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const pageIds: number[] = [];
  for (const pg of pages) {
    const content = `BT /F1 10 Tf 40 800 Td 13 TL ${pg.map((l) => `(${pdfString(l)}) Tj T*`).join(' ')} ET`;
    const c = add(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((b, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/** Texte « d'article » simulé pour une notice du corpus : le titre puis le résumé répété par paragraphes (≈ 350 mots). */
export function mockArticleLines(title: string, abstract: string): string[] {
  const lines: string[] = [title, ''];
  for (let p = 0; p < 8; p++) {
    const words = `${abstract} ${abstract}`.split(/\s+/);
    for (let i = 0; i < words.length; i += 12) lines.push(words.slice(i, i + 12).join(' '));
    lines.push('');
  }
  return lines;
}

/** Remplace `fetch` pour les PDF du corpus simulé. */
export const mockFullTextHttp = {
  async download(url: string): Promise<Buffer> {
    const c = MOCK_CORPUS.find((x) => x.oaPdfUrl === url);
    if (!c) throw new Error('PDF introuvable (simulé)');
    return makeTextPdf(mockArticleLines(c.title, c.abstract ?? c.title));
  },
};

/** Pages « web » simulées pour la vérification des sources connues par URL seule. */
export const mockPageHttp = {
  async getText(_connector: string, _rps: number, url: string): Promise<string | null> {
    const c = MOCK_CORPUS.find((x) => x.url === url);
    return c ? `<html><title>${c.title}</title><body>${c.abstract ?? ''}</body></html>` : null;
  },
};

/** Open Library simulé : un seul ISBN du corpus. */
export const mockBooks = {
  async byIsbn(isbn: string) {
    const c = MOCK_CORPUS.find((x) => x.isbn === isbn);
    return c
      ? {
          title: c.title,
          authors: c.authors,
          publishers: c.publisher ? [c.publisher] : [],
          publishDate: String(c.year ?? ''),
        }
      : null;
  },
};
