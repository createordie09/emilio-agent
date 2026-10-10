import type { ExportConfig } from './config';
import { frenchTypography } from './typography';
import type { Block, DocModel, FrontPage, Para, Run } from './model';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const runHtml = (r: Run): string => {
  if (r.note)
    return `<sup class="fnref"><a href="#fn${r.note}" id="r${r.note}">${r.note}</a></sup>`;
  let t = esc(r.text);
  if (r.bold) t = `<b>${t}</b>`;
  if (r.italic) t = `<i>${t}</i>`;
  if (r.sup) t = `<sup>${t}</sup>`;
  if (r.sub) t = `<sub>${t}</sub>`;
  if (r.highlight) t = `<mark>${t}</mark>`;
  return t;
};
const paraHtml = (p: Para): string => p.map(runHtml).join('');

export type TocEntry = { id: string; level: number; label: string; page: number | null };

/** Jeton invisible placé sur chaque titre à la première passe : il permet de retrouver la page d'un titre dans le PDF produit. */
export const pageMark = (id: string): string => `§§${id}§§`;

/** HTML paginé (CdC §16.2) : feuille de style d'impression A4, titres avec identifiants, sommaire calculé. */
export function buildHtml(
  doc: DocModel,
  cfg: ExportConfig,
  opts: { pages?: Map<string, number> | null; marks?: boolean; title?: string } = {},
): string {
  const L = doc.layout;
  const m = L.margins;
  let hid = 0;
  const heads: TocEntry[] = [];
  const idOf = (): string => `t${++hid}`;
  const noteBuf: number[] = [];

  const flushNotes = (): string => {
    if (!doc.notesMode || !noteBuf.length) return '';
    const ns = noteBuf.splice(0).sort((a, b) => a - b);
    return `<aside class="notes"><h4>Notes</h4><ol class="nl">${ns
      .map(
        (n) =>
          `<li id="fn${n}" value="${n}">${paraHtml(doc.footnotes.get(n) ?? [])} <a href="#r${n}">↩</a></li>`,
      )
      .join('')}</ol></aside>`;
  };
  const trackNotes = (p: Para) => p.forEach((r) => r.note && noteBuf.push(r.note));

  const mark = (id: string): string =>
    opts.marks ? `<span class="pgmark">${pageMark(id)}</span>` : '';

  const block = (b: Block): string => {
    switch (b.type) {
      case 'heading': {
        const id = idOf();
        const label = b.numbering
          ? `${b.numbering} ${b.text}`.replace(/^(Partie|Chapitre) (\S+) /, '$1 $2 : ')
          : b.text;
        if (b.toc && b.level <= cfg.docx.tocLevels)
          heads.push({ id, level: b.level, label: frenchTypography(label), page: null });
        const pre = b.pageBreak ? flushNotes() : '';
        return `${pre}<h${b.level} id="${id}"${b.pageBreak ? ' class="pb"' : ''}>${mark(id)}${esc(frenchTypography(label))}</h${b.level}>`;
      }
      case 'paragraph':
        trackNotes(b.runs);
        return `<p${b.style === 'quote' ? ' class="quote"' : ''}>${paraHtml(b.runs)}</p>`;
      case 'list': {
        b.items.forEach(trackNotes);
        const tag = b.ordered ? 'ol' : 'ul';
        return `<${tag}>${b.items.map((i) => `<li>${paraHtml(i)}</li>`).join('')}</${tag}>`;
      }
      case 'table':
        return `<figure class="tab">${b.number > 0 ? `<figcaption>${esc(frenchTypography(`Tableau ${b.number} : ${b.caption}`))}</figcaption>` : ''}<table><thead><tr>${b.headers
          .map((h) => `<th>${esc(frenchTypography(h))}</th>`)
          .join('')}</tr></thead><tbody>${b.rows
          .map(
            (r) =>
              `<tr>${b.headers.map((_h, i) => `<td>${esc(frenchTypography(r[i] ?? ''))}</td>`).join('')}</tr>`,
          )
          .join(
            '',
          )}</tbody></table>${b.source ? `<p class="src">${esc(frenchTypography(b.source))}</p>` : ''}</figure>`;
      case 'figure':
        return `<figure class="fig">${
          b.png
            ? `<img alt="${esc(b.caption)}" src="data:image/png;base64,${Buffer.from(b.png).toString('base64')}"/>`
            : '<p><mark>[À COMPLÉTER : figure indisponible]</mark></p>'
        }<figcaption>${esc(frenchTypography(`Figure ${b.number} : ${b.caption}`))}</figcaption><p class="src">${esc(frenchTypography(b.source))}</p></figure>`;
      case 'pagebreak':
        return '<div class="pb"></div>';
    }
  };

  const page = (p: FrontPage, first: boolean): string => {
    if (p.key === 'sommaire') return '@@TOC@@';
    const id = idOf();
    if (p.toc) heads.push({ id, level: 1, label: p.title, page: null });
    return `<section class="${first ? '' : 'pb'}"><h1 id="${id}">${mark(id)}${esc(p.title)}</h1>${p.blocks.map(block).join('')}</section>`;
  };

  const cover = doc.cover
    ? `<section class="cover">${doc.cover.lines
        .map(
          (l) =>
            `<p class="c-${l.role}">${l.highlight ? '<mark>' : ''}${esc(frenchTypography(l.text))}${l.highlight ? '</mark>' : ''}</p>`,
        )
        .join('')}</section>`
    : '';
  const front = doc.front.map((p, i) => page(p, i === 0 && !doc.cover)).join('');
  const body = doc.body.map(block).join('') + flushNotes();
  const bibId = idOf();
  heads.push({ id: bibId, level: 1, label: doc.bibliography.title, page: null });
  const bib = `<h1 class="pb" id="${bibId}">${mark(bibId)}${esc(doc.bibliography.title)}</h1>${doc.bibliography.groups
    .map(
      (g) =>
        `${g.label ? `<h2>${esc(g.label)}</h2>` : ''}${g.entries.map((e) => `<p class="ref">${paraHtml(e)}</p>`).join('')}`,
    )
    .join('')}`;
  const annexes = doc.annexes
    .map((a) => page(a, false).replace('<section class="">', '<section class="pb">'))
    .join('');

  const toc = `<section class="pb toc"><h1 class="toc-title">Sommaire</h1><nav>${heads
    .map((h) => {
      const pg = opts.pages?.get(h.id);
      return `<p class="toc-${h.level}"><a href="#${h.id}"><span class="lbl">${esc(h.label)}</span><span class="dots"></span><span class="pg">${pg ?? (opts.pages ? '' : '…')}</span></a></p>`;
    })
    .join('')}</nav></section>`;

  const css = `
@page { size: ${cfg.pdf.pageCss}; margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; }
html { font-family: "${L.font}", "Times New Roman", serif; font-size: ${L.fontSize}pt; }
body { margin: 0; line-height: ${L.lineSpacing}; color: #000; }
p { margin: 0 0 .5em; text-align: ${L.justify ? 'justify' : 'left'}; text-indent: ${L.paragraphIndent}cm; orphans: 3; widows: 3; }
h1 { font-size: 16pt; margin: 0 0 .8em; } h2 { font-size: 14pt; margin: 1em 0 .5em; } h3 { font-size: 13pt; margin: .9em 0 .4em; }
h4 { font-size: ${L.fontSize}pt; font-style: italic; margin: .8em 0 .3em; }
h1, h2, h3, h4 { break-after: avoid; line-height: 1.25; }
.pb { break-before: page; }
mark { background: #ffff00; }
.quote { margin: .5em 1.25cm; font-style: italic; text-indent: 0; }
.ref { text-indent: -1.25cm; margin-left: 1.25cm; text-align: left; line-height: 1.2; }
figure { margin: 1em 0; break-inside: avoid; }
figcaption { font-weight: bold; font-size: 10pt; margin: .3em 0; }
.tab figcaption { text-align: left; } .fig { text-align: center; } .fig img { max-width: 100%; }
.src { font-size: 9pt; font-style: italic; text-indent: 0; text-align: left; }
table { width: 100%; border-collapse: collapse; font-size: ${Math.max(9, L.fontSize - 2)}pt; line-height: 1.2; }
th, td { border: .5pt solid #999; padding: 3pt 5pt; text-align: center; } th { background: #ede9fe; } th:first-child, td:first-child { text-align: left; }
.cover { text-align: center; break-after: page; padding-top: 3cm; } .cover p { text-indent: 0; text-align: center; margin: .5em 0; }
.c-type { font-size: 16pt; font-weight: bold; margin-top: 2cm; } .c-title { font-size: 20pt; font-weight: bold; margin: 1.5cm 0; } .c-meta, .c-person { font-size: 13pt; }
.toc nav p { text-indent: 0; margin: .2em 0; } .toc a { display: flex; color: inherit; text-decoration: none; } .toc .lbl { flex: none; max-width: 85%; }
.toc .dots { flex: 1; border-bottom: 1px dotted #666; margin: 0 .3em .3em; } .toc-2 { margin-left: 1em !important; } .toc-3 { margin-left: 2em !important; }
.notes { font-size: ${L.footnotesFontSize}pt; border-top: .5pt solid #999; margin-top: 1.5em; line-height: 1.2; } .notes h4 { margin: .3em 0; } .nl { margin: 0; padding-left: 1.5em; } .nl li { text-align: left; }
.pgmark { font-size: 1px; line-height: 0; color: #fff; }
ul, ol { margin: 0 0 .6em; }`;

  const mid = front.includes('@@TOC@@') ? front.replace('@@TOC@@', toc) : front;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(opts.title ?? doc.title)}</title><style>${css}</style></head><body>${cover}${mid}${body}${bib}${annexes}</body></html>`;
}

/** Entrées du sommaire (titres du document dans l'ordre), pour retrouver leurs pages dans le PDF. */
export function tocHeadings(html: string): { id: string; label: string }[] {
  return [
    ...html.matchAll(
      /<h([1-3])\b[^>]*?id="(t\d+)"[^>]*>(?:<span class="pgmark">[^<]*<\/span>)?([^<]*)<\/h\1>/g,
    ),
  ].map((m) => ({
    id: m[2]!,
    label: m[3]!,
  }));
}
