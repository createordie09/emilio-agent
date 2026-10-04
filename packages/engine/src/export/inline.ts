import type { Para, Run } from './model';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });

/** Convertit la sortie HTML de citeproc (`<i>`, `<b>`, `<sup>`, `<sub>`, entités) en segments de texte mis en forme. */
export function cslHtmlToRuns(html: string): Para {
  const out: Run[] = [];
  const st = { bold: 0, italic: 0, sup: 0, sub: 0 };
  const re = /<(\/?)(i|em|b|strong|sup|sub|span|div)(?:\s[^>]*)?>|([^<]+)|<[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      const text = decode(m[3]).replace(/\s+/g, ' ');
      if (!text) continue;
      const r: Run = { text };
      if (st.bold) r.bold = true;
      if (st.italic) r.italic = true;
      if (st.sup) r.sup = true;
      if (st.sub) r.sub = true;
      out.push(r);
    } else if (m[2]) {
      const closing = m[1] === '/';
      const d = closing ? -1 : 1;
      const tag = m[2].toLowerCase();
      if (tag === 'i' || tag === 'em') st.italic = Math.max(0, st.italic + d);
      else if (tag === 'b' || tag === 'strong') st.bold = Math.max(0, st.bold + d);
      else if (tag === 'sup') st.sup = Math.max(0, st.sup + d);
      else if (tag === 'sub') st.sub = Math.max(0, st.sub + d);
    }
  }
  // Fusionne les segments voisins de même mise en forme et retire les espaces de bord.
  const merged: Run[] = [];
  for (const r of out) {
    const p = merged[merged.length - 1];
    if (
      p &&
      !!p.bold === !!r.bold &&
      !!p.italic === !!r.italic &&
      !!p.sup === !!r.sup &&
      !!p.sub === !!r.sub
    )
      p.text += r.text;
    else merged.push({ ...r });
  }
  if (merged[0]) merged[0].text = merged[0].text.replace(/^\s+/, '');
  const last = merged[merged.length - 1];
  if (last) last.text = last.text.replace(/\s+$/, '');
  return merged.filter((r) => r.text);
}

/** Markdown en ligne (`**gras**`, `*italique*`, `_italique_`) → segments ; les emplacements `[À COMPLÉTER : …]` / `[DONNÉES À INSÉRER …]` sont surlignés. */
export function markdownInline(text: string): Para {
  const out: Run[] = [];
  const re =
    /(\[(?:À COMPLÉTER|DONNÉES À INSÉRER)[^\]]*\])|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*)_(?![\w_])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1]) out.push({ text: m[1], highlight: true });
    else if (m[2]) out.push({ text: m[2], bold: true });
    else out.push({ text: (m[3] ?? m[4])!, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
