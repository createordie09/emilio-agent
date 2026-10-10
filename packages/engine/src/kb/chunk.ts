import type { ExtractedPage } from './extract';

export type Chunk = {
  ordinal: number;
  text: string;
  pageFrom: number | null;
  pageTo: number | null;
  sectionTitle: string | null;
  tokenCount: number;
  isBibliography: boolean;
};

export type ChunkOptions = {
  minWords: number;
  targetWords: number;
  maxWords: number;
  /** Nombre de paragraphes repris au début du chunk suivant (§11.5 : 1). */
  overlapParagraphs: number;
};

/** Découpage de CdC §11.5 : extraits de 300 à 800 mots, chevauchement d'un paragraphe. */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  minWords: 300,
  targetWords: 500,
  maxWords: 800,
  overlapParagraphs: 1,
};

type Para = {
  text: string;
  page: number | null;
  section: string | null;
  bib: boolean;
  words: number;
  heading: boolean;
};

const words = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

const PAGE_NUMBER = /^\s*(page\s*)?[-–—]?\s*\d{1,4}\s*([/\\]\s*\d{1,4})?\s*[-–—]?\s*$/i;
const BIB_HEADING =
  /^(\d+[.)]?\s*)?(bibliographie|r[ée]f[ée]rences( bibliographiques)?|webographie|references|sources documentaires)\s*:?\s*$/i;
const ANNEX_HEADING = /^(annexes?)\b/i;

const normLine = (l: string): string =>
  l.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/** Retire en-têtes, pieds de page répétés et numéros de page (§11.5). Opère sur les 2 premières / dernières lignes de chaque page. */
export function stripRunningHeaders(pages: ExtractedPage[]): ExtractedPage[] {
  const paged = pages.filter((p) => p.page !== null);
  if (paged.length < 3) {
    return pages.map((p) => ({
      ...p,
      text: p.text
        .split('\n')
        .filter(
          (l, i, a) => !(p.page !== null && (i === 0 || i === a.length - 1) && PAGE_NUMBER.test(l)),
        )
        .join('\n'),
    }));
  }
  const edges = (lines: string[]): [number, string][] => {
    const out: [number, string][] = [];
    for (const i of [0, 1, lines.length - 2, lines.length - 1]) {
      if (i >= 0 && i < lines.length && !out.some(([j]) => j === i))
        out.push([i, normLine(lines[i]!)]);
    }
    return out;
  };
  const count = new Map<string, number>();
  for (const p of paged) {
    const seen = new Set(edges(p.text.split('\n')).map(([, n]) => n));
    for (const n of seen) if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(paged.length * 0.5));
  return pages.map((p) => {
    const lines = p.text.split('\n');
    const drop = new Set<number>();
    for (const [i, n] of edges(lines)) {
      if ((count.get(n) ?? 0) >= threshold || PAGE_NUMBER.test(lines[i]!)) drop.add(i);
    }
    return { ...p, text: lines.filter((_, i) => !drop.has(i)).join('\n') };
  });
}

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90 || /[.!?;,]$/.test(t)) return false;
  if (BIB_HEADING.test(t) || ANNEX_HEADING.test(t)) return true;
  if (/^(\d+(\.\d+)*[.)]?|[IVXLC]+[.)]|[A-Z][.)])\s+\p{Lu}/u.test(t)) return true;
  if (
    /^(chapitre|partie|section|introduction|conclusion|r[ée]sum[ée]|abstract|remerciements|d[ée]dicace|sommaire)\b/i.test(
      t,
    ) &&
    t.split(/\s+/).length <= 12
  )
    return true;
  const letters = t.replace(/[^\p{L}]/gu, '');
  return letters.length >= 4 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 12;
}

/** Transforme les lignes d'une page en paragraphes : coupure sur ligne vide, ou fin de phrase suivie d'une ligne courte. */
function toParagraphs(text: string, pdfLike: boolean): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join(' ').replace(/\s+/g, ' ').trim());
    cur = [];
  };
  const lines = text.split('\n');
  const lens = lines
    .map((l) => l.length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] ?? 80;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l) {
      flush();
      continue;
    }
    if (isHeading(l)) {
      flush();
      out.push(`\u0001${l}`); // marqueur de titre
      continue;
    }
    cur.push(l);
    if (pdfLike && l.length < median * 0.6 && /[.!?:»)]$/.test(l)) flush();
    if (!pdfLike && !/\S/.test(lines[i + 1] ?? '')) flush();
  }
  flush();
  return out;
}

/** Découpe un paragraphe trop long en morceaux de ≤ `max` mots, aux frontières de phrases. */
function splitLong(text: string, max: number): string[] {
  if (words(text) <= max) return [text];
  const sentences = text.split(/(?<=[.!?»])\s+/);
  const parts: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const s of sentences) {
    const w = words(s);
    if (n + w > max && cur.length) {
      parts.push(cur.join(' '));
      cur = [];
      n = 0;
    }
    // phrase unique plus longue que max : coupe dure
    if (w > max) {
      const tokens = s.split(/\s+/);
      for (let i = 0; i < tokens.length; i += max) parts.push(tokens.slice(i, i + max).join(' '));
      continue;
    }
    cur.push(s);
    n += w;
  }
  if (cur.length) parts.push(cur.join(' '));
  return parts;
}

export function chunkDocument(pages: ExtractedPage[], opts: Partial<ChunkOptions> = {}): Chunk[] {
  const o = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
  const cleaned = stripRunningHeaders(pages);
  const pdfLike = cleaned.some((p) => p.page !== null);

  // 1. paragraphes annotés (page, section, bibliographie)
  const paras: Para[] = [];
  let section: string | null = null;
  let bib = false;
  for (const p of cleaned) {
    for (const raw of toParagraphs(p.text, pdfLike)) {
      if (raw.startsWith('\u0001')) {
        const h = raw.slice(1);
        if (BIB_HEADING.test(h)) bib = true;
        else if (ANNEX_HEADING.test(h)) bib = false;
        section = h;
        paras.push({ text: h, page: p.page, section, bib, words: words(h), heading: true });
        continue;
      }
      for (const piece of splitLong(raw, o.targetWords + 100)) {
        paras.push({
          text: piece,
          page: p.page,
          section,
          bib,
          words: words(piece),
          heading: false,
        });
      }
    }
  }

  // 2. regroupement en chunks avec chevauchement
  const chunks: Chunk[] = [];
  let cur: Para[] = [];
  let curWords = 0;
  const close = () => {
    const body = cur.filter((p) => !p.heading || cur.length === 1);
    if (!cur.length || !body.length) return;
    const pg = cur.map((p) => p.page).filter((x): x is number => x !== null);
    chunks.push({
      ordinal: chunks.length,
      text: cur.map((p) => p.text).join('\n\n'),
      pageFrom: pg.length ? Math.min(...pg) : null,
      pageTo: pg.length ? Math.max(...pg) : null,
      sectionTitle: cur.find((p) => p.section)?.section ?? null,
      tokenCount: Math.ceil(curWords * 1.3),
      isBibliography: cur[0]!.bib,
    });
  };
  for (const p of paras) {
    if (cur.length && cur[0]!.bib !== p.bib) {
      close();
      cur = [];
      curWords = 0;
    }
    if (cur.length && curWords + p.words > o.maxWords) {
      close();
      const keep = cur
        .filter((x) => !x.heading)
        .slice(-o.overlapParagraphs)
        .filter((x) => x.words <= o.maxWords * 0.3);
      cur = keep;
      curWords = keep.reduce((n, x) => n + x.words, 0);
    }
    cur.push(p);
    curWords += p.words;
    if (curWords >= o.targetWords && !p.heading) {
      close();
      const keep = cur
        .filter((x) => !x.heading)
        .slice(-o.overlapParagraphs)
        .filter((x) => x.words <= o.maxWords * 0.3);
      cur = keep;
      curWords = keep.reduce((n, x) => n + x.words, 0);
    }
  }
  // reste : on ne l'émet que s'il apporte du texte nouveau (hors paragraphe de chevauchement)
  const lastEmitted = chunks.at(-1)?.text ?? '';
  const novel = cur.filter((p) => !lastEmitted.includes(p.text) || p.heading);
  if (novel.length) {
    const tail = { words: curWords, bib: cur[0]!.bib };
    const prev = chunks.at(-1);
    if (
      prev &&
      tail.words < o.minWords * 0.4 &&
      prev.isBibliography === tail.bib &&
      words(prev.text) + words(novel.map((p) => p.text).join(' ')) <= o.maxWords + 100
    ) {
      prev.text += '\n\n' + novel.map((p) => p.text).join('\n\n');
      const pg = novel.map((p) => p.page).filter((x): x is number => x !== null);
      if (pg.length) prev.pageTo = Math.max(prev.pageTo ?? 0, ...pg);
      prev.tokenCount = Math.ceil(words(prev.text) * 1.3);
    } else {
      close();
    }
  }
  return chunks;
}
