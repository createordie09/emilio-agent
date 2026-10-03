import { normalizeTitle } from './normalize';
import type { CandidateSource } from './types';

const filled = (c: CandidateSource): number =>
  [
    c.doi,
    c.isbn,
    c.year,
    c.journal,
    c.volume,
    c.issue,
    c.pages,
    c.publisher,
    c.url,
    c.oaPdfUrl,
    c.language,
  ].filter(Boolean).length +
  c.authors.length * 0.1 +
  Math.min(2, (c.abstract?.length ?? 0) / 500);

/** Fusionne deux notices du même document : on garde la plus complète et on complète ses trous (CdC §11.3). */
export function mergeTwo(a: CandidateSource, b: CandidateSource): CandidateSource {
  const [main, other] = filled(a) >= filled(b) ? [a, b] : [b, a];
  const seenIn = [
    ...new Set([...(main.seenIn ?? [main.origin]), ...(other.seenIn ?? [other.origin])]),
  ];
  return {
    ...main,
    authors: main.authors.length >= other.authors.length ? main.authors : other.authors,
    year: main.year ?? other.year,
    publisher: main.publisher ?? other.publisher,
    journal: main.journal ?? other.journal,
    volume: main.volume ?? other.volume,
    issue: main.issue ?? other.issue,
    pages: main.pages ?? other.pages,
    doi: main.doi ?? other.doi,
    isbn: main.isbn ?? other.isbn,
    url: main.url ?? other.url,
    oaPdfUrl: main.oaPdfUrl ?? other.oaPdfUrl,
    language: main.language ?? other.language,
    abstract:
      (main.abstract?.length ?? 0) >= (other.abstract?.length ?? 0)
        ? main.abstract
        : other.abstract,
    citationCount: Math.max(main.citationCount ?? 0, other.citationCount ?? 0) || undefined,
    peerReviewed: main.peerReviewed ?? other.peerReviewed,
    africa: main.africa || other.africa || undefined,
    seenIn,
  };
}

/**
 * Déduplication (CdC §11.3) : 1) même DOI (normalisé) ; 2) sinon titre normalisé + année identique.
 * Deux notices sans année et de même titre sont aussi regroupées. L'ordre d'arrivée est conservé.
 */
export function dedupe(list: CandidateSource[]): CandidateSource[] {
  const byDoi = new Map<string, number>();
  const byTitle = new Map<string, number>();
  const out: CandidateSource[] = [];
  for (const c of list) {
    const tk = `${normalizeTitle(c.title)}|${c.year ?? ''}`;
    const idx =
      (c.doi ? byDoi.get(c.doi) : undefined) ??
      (normalizeTitle(c.title) ? byTitle.get(tk) : undefined);
    if (idx === undefined) {
      out.push({ ...c, seenIn: c.seenIn ?? [c.origin] });
      const i = out.length - 1;
      if (c.doi) byDoi.set(c.doi, i);
      byTitle.set(tk, i);
    } else {
      const merged = mergeTwo(out[idx]!, c);
      out[idx] = merged;
      if (merged.doi) byDoi.set(merged.doi, idx);
      byTitle.set(`${normalizeTitle(merged.title)}|${merged.year ?? ''}`, idx);
    }
  }
  return out;
}
