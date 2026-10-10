import * as React from 'react';
import type { AnalysisTableView } from '@emilio/shared';
import { cn } from '@/lib/cn';

const PLACEHOLDER = /(\[(?:INFORMATION MANQUANTE|DONNÉES À INSÉRER|À COMPLÉTER)[^\]]*\])/g;
const CITATION = /\[@([0-9a-f-]{36})(?:\s*,\s*(?:pp?\.\s*)?([^\]]+))?\]/g;

/** Texte en ligne : citations [@id, p. 3] en pastilles lisibles, emplacements à compléter surlignés, **gras** et *italique*. */
function Inline({ text, sources }: { text: string; sources: Record<string, string> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  const push = (t: string) =>
    t.split(PLACEHOLDER).forEach((seg, i) => {
      if (!seg) return;
      if (i % 2 === 1)
        parts.push(
          <mark key={`p${k++}`} className="rounded bg-warning-soft px-1 text-warning">
            {seg}
          </mark>,
        );
      else
        seg.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).forEach((x) => {
          if (/^\*\*[^*]+\*\*$/.test(x))
            parts.push(<strong key={`b${k++}`}>{x.slice(2, -2)}</strong>);
          else if (/^\*[^*]+\*$/.test(x)) parts.push(<em key={`i${k++}`}>{x.slice(1, -1)}</em>);
          else if (x) parts.push(x);
        });
    });
  for (const m of text.matchAll(CITATION)) {
    push(text.slice(last, m.index));
    const label = sources[m[1]!] ?? 'source';
    parts.push(
      <span
        key={`c${k++}`}
        title={`${label}${m[2] ? `, p. ${m[2]}` : ''}`}
        className="mx-0.5 whitespace-nowrap rounded-full bg-primary-soft px-2 py-0.5 text-[0.8em] text-primary-strong dark:text-primary"
      >
        {label.replace(/\s*\(([^)]*)\)$/, ', $1')}
        {m[2] ? `, p. ${m[2]}` : ''}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  push(text.slice(last));
  return <>{parts}</>;
}

/** Tableau de résultats calculés (légende, tableau, source). */
export function ResultTable({ t }: { t: AnalysisTableView }) {
  return (
    <figure className="my-4 space-y-1.5 overflow-x-auto" aria-label={t.caption}>
      <figcaption className="t-small font-semibold">{t.caption}</figcaption>
      <table className="t-small w-full border-collapse">
        <thead>
          <tr>
            {t.headers.map((h) => (
              <th
                key={h}
                className="border-b border-border px-2.5 py-1.5 text-left font-medium text-text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {r.map((c, j) => (
                <td key={j} className="tabular px-2.5 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-caption italic text-text-subtle">{t.source}</p>
    </figure>
  );
}

/** Rendu minimal du Markdown des sections (titres, paragraphes, listes, tableaux, jetons de tableau de résultats). */
export function Markdown({
  text,
  sources = {},
  tables = [],
  className,
}: {
  text: string;
  sources?: Record<string, string>;
  tables?: AnalysisTableView[];
  className?: string;
}) {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className={cn('space-y-3 font-serif leading-7', className)}>
      {blocks.map((b, i) => {
        const tok = /^\s*\{\{TABLEAU:([A-Za-z0-9_-]+)\}\}\s*$/.exec(b);
        if (tok) {
          const t = byId.get(tok[1]!);
          return t ? <ResultTable key={i} t={t} /> : null;
        }
        const h = /^(#{1,6})\s+(.*)$/.exec(b);
        if (h)
          return (
            <h4 key={i} className="t-h3 font-sans">
              <Inline text={h[2]!} sources={sources} />
            </h4>
          );
        if (/^([-*]|\d+[.)])\s/.test(b))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.split('\n').map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^([-*]|\d+[.)])\s+/, '')} sources={sources} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            <Inline text={b} sources={sources} />
          </p>
        );
      })}
    </div>
  );
}
