import * as React from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import type { OutlineNodeView } from '@emilio/shared';
import { OUTLINE_LEVEL_LABEL_FR } from '@emilio/shared';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/fr';

type Zone = 'before' | 'inside' | 'after';

/** Profondeur de chaque nœud (parcours en profondeur : l'ordre fourni par le moteur est l'ordre de lecture). */
function depths(nodes: OutlineNodeView[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, number>();
  for (const n of nodes) {
    let d = 0;
    for (let p = n.parentId; p; p = byId.get(p)?.parentId ?? null) d++;
    out.set(n.id, d);
  }
  return out;
}

/** Arbre du plan en cartes compactes, glissables (§6.5). Glisser = déplacer ; zone haute/basse = avant/après, centre = dedans. */
export function PlanTree({
  nodes,
  selectedId,
  onSelect,
  editable,
  onMove,
}: {
  nodes: OutlineNodeView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  editable: boolean;
  onMove: (nodeId: string, parentId: string | null, index: number) => void;
}) {
  const depth = React.useMemo(() => depths(nodes), [nodes]);
  // `dragRef` : lecture synchrone dans les gestionnaires (dragover peut précéder le rendu React) ; `dragId` : style seulement.
  const dragRef = React.useRef<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<{ id: string; zone: Zone } | null>(null);
  const wordsOf = React.useMemo(() => {
    const kids = new Map<string | null, OutlineNodeView[]>();
    for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    const sum = (n: OutlineNodeView): number => {
      const c = kids.get(n.id) ?? [];
      return c.length ? c.reduce((s, x) => s + sum(x), 0) : n.targetWords;
    };
    return new Map(nodes.map((n) => [n.id, sum(n)]));
  }, [nodes]);

  const zoneOf = (e: React.DragEvent<HTMLElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
  };

  const drop = (target: OutlineNodeView, zone: Zone) => {
    const moved = dragRef.current;
    if (!moved || moved === target.id) return;
    const without = (parent: string | null) =>
      nodes.filter((n) => n.parentId === parent && n.id !== moved);
    if (zone === 'inside') return onMove(moved, target.id, without(target.id).length);
    const sibs = without(target.parentId);
    const at = sibs.findIndex((n) => n.id === target.id);
    onMove(moved, target.parentId, zone === 'before' ? at : at + 1);
  };

  return (
    <ul aria-label="Plan" className="space-y-1.5">
      {nodes.map((n) => {
        const sel = n.id === selectedId;
        const o = over?.id === n.id ? over.zone : null;
        const dim = n.kind !== 'corps' ? 'italic' : '';
        return (
          <li
            key={n.id}
            style={{ marginLeft: `${(depth.get(n.id) ?? 0) * 16}px` }}
            draggable={editable}
            onDragStart={(e) => {
              dragRef.current = n.id;
              setDragId(n.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', n.id);
            }}
            onDragEnd={() => {
              dragRef.current = null;
              setDragId(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!editable || !dragRef.current || dragRef.current === n.id) return;
              e.preventDefault();
              setOver({ id: n.id, zone: zoneOf(e) });
            }}
            onDragLeave={() => setOver((cur) => (cur?.id === n.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              drop(n, zoneOf(e));
              dragRef.current = null;
              setDragId(null);
              setOver(null);
            }}
            className={cn(
              'relative rounded-md border bg-surface transition-colors',
              sel
                ? 'border-primary bg-primary-softer shadow-sm'
                : 'border-border hover:bg-primary-softer',
              dragId === n.id && 'opacity-50',
              o === 'inside' && 'border-primary ring-2 ring-primary',
              o === 'before' &&
                'before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:bg-primary',
              o === 'after' &&
                'after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:bg-primary',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              aria-current={sel ? 'true' : undefined}
              aria-label={`${n.numbering ? n.numbering + ' ' : ''}${n.title}`}
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left"
            >
              {editable && (
                <GripVertical className="size-4 shrink-0 text-text-subtle" aria-hidden />
              )}
              {n.level === 'partie' || n.level === 'chapitre' ? null : (
                <ChevronRight className="size-3.5 shrink-0 text-text-subtle" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    't-small block truncate',
                    dim,
                    n.level === 'partie' && 'font-semibold',
                  )}
                >
                  {n.numbering && (
                    <span className="tabular mr-1.5 text-text-muted">{n.numbering}</span>
                  )}
                  {n.title}
                </span>
                <span className="t-caption block text-text-subtle">
                  {OUTLINE_LEVEL_LABEL_FR[n.level]}
                  {n.kind === 'introduction' ? ' · introduction générale' : ''}
                  {n.kind === 'conclusion' ? ' · conclusion générale' : ''}
                </span>
              </span>
              <span className="t-caption tabular shrink-0 text-text-muted">
                {fmtInt(wordsOf.get(n.id) ?? 0)} mots
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
