/** Diff au niveau des phrases entre deux versions d'une section (plus longue sous-suite commune). */
export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string; brk: boolean };

/** Phrases du texte ; `brk` marque le début d'un nouveau paragraphe (ou titre). */
const split = (t: string): { text: string; brk: boolean }[] =>
  t
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .flatMap((p) => {
      const parts = /^#{1,6}\s/.test(p.trim())
        ? [p.trim()]
        : (p.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) ?? [p]).map((x) => x.trim()).filter(Boolean);
      return parts.map((text, k) => ({ text, brk: k === 0 }));
    });

export function diffSentences(before: string, after: string): DiffPart[] {
  const sa = split(before);
  const sb = split(after);
  const a = sa.map((x) => x.text);
  const b = sb.map((x) => x.text);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]!, brk: sa[i]!.brk });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!)
      out.push({ kind: 'removed', text: a[i]!, brk: sa[i++]!.brk });
    else out.push({ kind: 'added', text: b[j]!, brk: sb[j++]!.brk });
  }
  while (i < n) out.push({ kind: 'removed', text: a[i]!, brk: sa[i++]!.brk });
  while (j < m) out.push({ kind: 'added', text: b[j]!, brk: sb[j++]!.brk });
  return out;
}
