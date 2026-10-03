import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { AppError } from '@emilio/shared';

export type ExtractedPage = { page: number | null; text: string };
export type ExtractedDoc = {
  kind: 'pdf' | 'docx' | 'text';
  pages: ExtractedPage[];
  meta: { title?: string; author?: string; year?: number };
  /** PDF sans couche de texte (scanné) : l'OCR n'est pas disponible en V1 (§4.1, V1.1). */
  scanned: boolean;
  warnings: string[];
};

export const TEXT_EXT = new Set(['.pdf', '.docx', '.txt', '.md']);
export const DATA_EXT = new Set(['.csv', '.xlsx']);

type PdfTextItem = { str: string; transform: number[]; hasEOL?: boolean };

/** Reconstitue les lignes d'une page PDF à partir des éléments de texte (regroupés par ordonnée). */
export function linesFromItems(items: PdfTextItem[]): string {
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round((it.transform[5] ?? 0) / 2) * 2;
    const arr = rows.get(y) ?? [];
    arr.push({ x: it.transform[4] ?? 0, s: it.str });
    rows.set(y, arr);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) =>
      r
        .sort((a, b) => a.x - b.x)
        .map((c) => c.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

async function extractPdf(buf: Buffer): Promise<ExtractedDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push({ page: i, text: linesFromItems(tc.items as PdfTextItem[]) });
    page.cleanup();
  }
  let title: string | undefined;
  let author: string | undefined;
  let year: number | undefined;
  try {
    const m = (await doc.getMetadata()).info as Record<string, string | undefined>;
    title = m.Title?.trim() || undefined;
    author = m.Author?.trim() || undefined;
    const y = /(\d{4})/.exec(m.CreationDate ?? '');
    year = y ? Number(y[1]) : undefined;
  } catch {
    /* métadonnées absentes */
  }
  await task.destroy();
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  const scanned = pages.length > 0 && chars / pages.length < 40;
  return {
    kind: 'pdf',
    pages,
    meta: { title, author, year },
    scanned,
    warnings: scanned
      ? [
          'Ce PDF semble scanné (aucun texte exploitable) : la reconnaissance de caractères (OCR) n’est pas encore disponible.',
        ]
      : [],
  };
}

async function extractDocx(buf: Buffer): Promise<ExtractedDoc> {
  const mammoth = await import('mammoth');
  const r = await mammoth.extractRawText({ buffer: buf });
  return {
    kind: 'docx',
    pages: [{ page: null, text: r.value }],
    meta: {},
    scanned: false,
    warnings: r.messages.filter((m) => m.type === 'warning').map((m) => m.message),
  };
}

/** Extraction de texte d'un fichier PDF / DOCX / TXT / MD. Lève E_PARSE_FILE avec la raison en français. */
export async function extractText(path: string, filename = path): Promise<ExtractedDoc> {
  const ext = extname(filename).toLowerCase();
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (e) {
    throw new AppError(
      'E_PARSE_FILE',
      `${filename} : fichier introuvable ou illisible (${(e as Error).message})`,
    );
  }
  try {
    if (ext === '.pdf') return await extractPdf(buf);
    if (ext === '.docx') return await extractDocx(buf);
    if (ext === '.txt' || ext === '.md') {
      return {
        kind: 'text',
        pages: [{ page: null, text: buf.toString('utf8') }],
        meta: {},
        scanned: false,
        warnings: [],
      };
    }
  } catch (e) {
    throw new AppError(
      'E_PARSE_FILE',
      `${filename} : ${(e as Error).message || 'format non reconnu'}`,
    );
  }
  throw new AppError(
    'E_PARSE_FILE',
    `${filename} : format « ${ext || 'inconnu'} » non pris en charge`,
  );
}
