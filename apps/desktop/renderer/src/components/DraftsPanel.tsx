import * as React from 'react';

import { Skeleton, StatusBadge } from '@/components/ui';
import { diffSentences } from '@/lib/diff';
import { fmtInt } from '@/lib/fr';
import { useSections, useVersion, useVersions } from '@/lib/queries';

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = React.useMemo(() => diffSentences(before, after), [before, after]);
  return (
    <div className="t-body rounded-lg border border-border p-4" aria-label="Différences">
      {parts.map((p, i) => {
        const text = p.text.replace(/^#{1,6}\s/, '');
        const head = p.text !== text;
        const node =
          p.kind === 'same' ? (
            <span className={head ? 'font-semibold' : undefined}>{text} </span>
          ) : p.kind === 'added' ? (
            <ins className="rounded bg-success-soft px-0.5 no-underline">{text} </ins>
          ) : (
            <del className="rounded bg-danger-soft px-0.5">{text} </del>
          );
        return (
          <React.Fragment key={i}>
            {p.brk && i > 0 && <div className="h-2" />}
            {node}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** Onglet « Brouillons » (CdC §6.7) : toutes les versions de chaque section, comparaison phrase par phrase. */
export function DraftsPanel({ missionId }: { missionId: string }) {
  const { data: sections } = useSections(missionId);
  const written = (sections ?? []).filter((s) => s.version !== null);
  const [node, setNode] = React.useState<string | null>(null);
  const nodeId =
    node ?? written.find((s) => (s.version ?? 0) > 1)?.nodeId ?? written[0]?.nodeId ?? null;
  const { data: versions } = useVersions(nodeId);
  const [pick, setPick] = React.useState<{ a: string | null; b: string | null }>({
    a: null,
    b: null,
  });
  const list = versions ?? [];
  const b = pick.b ?? list.find((v) => v.current)?.id ?? list[list.length - 1]?.id ?? null;
  const a = pick.a ?? list.filter((v) => v.id !== b).slice(-1)[0]?.id ?? null;
  const va = useVersion(a);
  const vb = useVersion(b);

  return (
    <section className="space-y-3" aria-label="Brouillons">
      <h2 className="t-h2">Brouillons</h2>
      {written.length === 0 && (
        <p className="t-small rounded-lg border border-dashed border-border p-5 text-text-muted">
          Les versions des sections apparaissent dès qu’elles sont rédigées.
        </p>
      )}
      {written.length > 0 && (
        <div className="grid grid-cols-[260px_1fr] gap-4">
          <ul className="max-h-[420px] divide-y divide-border overflow-auto rounded-lg border border-border">
            {written.map((s) => (
              <li key={s.nodeId}>
                <button
                  type="button"
                  onClick={() => {
                    setNode(s.nodeId);
                    setPick({ a: null, b: null });
                  }}
                  aria-current={s.nodeId === nodeId}
                  className="t-small flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-primary-softer aria-[current=true]:bg-primary-soft"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {s.numbering && (
                      <span className="tabular mr-1 text-text-muted">{s.numbering}</span>
                    )}
                    {s.title}
                  </span>
                  <StatusBadge tone={(s.version ?? 1) > 1 ? 'info' : 'neutral'}>
                    v{s.version}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 space-y-3">
            {!versions && <Skeleton className="h-24" />}
            {versions && (
              <ul className="space-y-1.5" aria-label="Versions">
                {list.map((v) => (
                  <li key={v.id} className="t-small flex flex-wrap items-center gap-2">
                    <span className="tabular w-8 font-medium">v{v.version}</span>
                    <span className="text-text-subtle">
                      {v.round === 0 ? 'Rédaction initiale' : `Ronde ${v.round}`} ·{' '}
                      {fmtInt(v.words)} mots
                    </span>
                    {v.current && <StatusBadge tone="success">Version courante</StatusBadge>}
                    <span className="min-w-0 flex-1 truncate text-text-muted">
                      {v.changeSummary}
                    </span>
                    <button
                      type="button"
                      className="t-caption cursor-pointer text-primary-strong underline"
                      onClick={() => setPick({ a: v.id, b })}
                    >
                      Avant
                    </button>
                    <button
                      type="button"
                      className="t-caption cursor-pointer text-primary-strong underline"
                      onClick={() => setPick({ a, b: v.id })}
                    >
                      Après
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {list.length < 2 && versions && (
              <p className="t-small text-text-muted">Une seule version : rien à comparer.</p>
            )}
            {list.length >= 2 && va.data && vb.data && (
              <>
                <p className="t-caption text-text-subtle">
                  Comparaison v{va.data.version} → v{vb.data.version} : ajouts en vert, suppressions
                  en rouge.
                </p>
                <DiffView before={va.data.markdown} after={vb.data.markdown} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
