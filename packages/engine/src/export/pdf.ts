import { readFileSync } from 'node:fs';
import { pageMark } from './html';

/** Adaptateur de rendu PDF : fourni par l'application (Electron `printToPDF`), absent dans les tests et les environnements sans interface. */
export interface PdfAdapter {
  render(htmlPath: string, pdfPath: string): Promise<void>;
}

/** Pages (1-based) où figurent les jetons de titres du PDF (`§§t12§§`). */
export async function findMarkPages(pdfPath: string, ids: string[]): Promise<Map<string, number>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const out = new Map<string, number>();
  const want = new Set(ids);
  for (let p = 1; p <= doc.numPages && out.size < want.size; p++) {
    const page = await doc.getPage(p);
    const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    page.cleanup();
    for (const id of want) if (!out.has(id) && text.includes(pageMark(id))) out.set(id, p);
  }
  await task.destroy();
  return out;
}
