import * as React from 'react';

import type { SectionClaimView, SectionDraftSummary } from '@emilio/shared';
import { Modal, Skeleton, StatusBadge } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { fmtInt } from '@/lib/fr';
import { useFieldAnalysis, useFrontMatter, useSection, useSections } from '@/lib/queries';

const SUPPORT: Record<
  NonNullable<SectionClaimView['supportLevel']>,
  { tone: 'success' | 'warning' | 'danger'; label: string }
> = {
  supported: { tone: 'success', label: 'Étayée' },
  partially: { tone: 'warning', label: 'Partiellement' },
  unsupported: { tone: 'danger', label: 'Non étayée' },
};
const STATUS: Record<
  SectionDraftSummary['status'],
  { tone: 'neutral' | 'info' | 'primary' | 'success'; label: string }
> = {
  planned: { tone: 'neutral', label: 'Prévue' },
  researching: { tone: 'info', label: 'Recherche' },
  drafting: { tone: 'primary', label: 'Rédaction' },
  in_review: { tone: 'success', label: 'Rédigée' },
  validated: { tone: 'success', label: 'Validée' },
};
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);

/** Onglet « Rédaction » (CdC §6.7) : sections, contrôles d'intégrité, lecture avec preuves d'ancrage, pages liminaires. */
export function WritingPanel({ missionId }: { missionId: string }) {
  const { data, isLoading } = useSections(missionId);
  const { data: front } = useFrontMatter(missionId);
  const [open, setOpen] = React.useState<string | null>(null);
  const detail = useSection(open);
  const analysis = useFieldAnalysis(missionId);
  const d = detail.data;
  const written = (data ?? []).filter((s) => s.version !== null);
  const words = written.reduce((s, x) => s + (x.words ?? 0), 0);

  return (
    <section className="space-y-3" aria-label="Rédaction">
      <h2 className="t-h2">
        Rédaction{' '}
        {data && (
          <span className="t-small font-normal text-text-muted">
            ({written.length} / {data.length} sections · {fmtInt(words)} mots)
          </span>
        )}
      </h2>
      {isLoading && <Skeleton className="h-24" />}
      {data && data.length === 0 && (
        <p className="t-small rounded-lg border border-dashed border-border p-5 text-text-muted">
          La rédaction démarre après la validation du plan.
        </p>
      )}
      {data && data.length > 0 && (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          aria-label="Sections rédigées"
        >
          {data.map((s) => (
            <li key={s.nodeId}>
              <button
                type="button"
                disabled={s.version === null}
                onClick={() => setOpen(s.nodeId)}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary-softer disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="t-small block truncate">
                    {s.numbering && (
                      <span className="tabular mr-1.5 text-text-muted">{s.numbering}</span>
                    )}
                    {s.title}
                  </span>
                  <span className="t-caption block text-text-subtle">
                    {s.version === null
                      ? `${fmtInt(s.wordsTarget)} mots visés`
                      : `${fmtInt(s.words ?? 0)} / ${fmtInt(s.wordsTarget)} mots`}
                  </span>
                </span>
                {s.placeholder && <StatusBadge tone="warning">À compléter</StatusBadge>}
                {s.groundingRate !== null && (
                  <StatusBadge tone={s.groundingRate >= 0.95 ? 'success' : 'warning'}>
                    Ancrage {pct(s.groundingRate)}
                  </StatusBadge>
                )}
                {s.removed > 0 && (
                  <StatusBadge tone="warning">{s.removed} phrase(s) supprimée(s)</StatusBadge>
                )}
                <StatusBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusBadge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {front && front.length > 0 && (
        <div className="space-y-2" aria-label="Pages liminaires">
          <h3 className="t-h3">Pages liminaires</h3>
          {front.map((f) => (
            <details key={f.key} className="rounded-lg border border-border px-4 py-2.5">
              <summary className="t-small flex cursor-pointer items-center gap-2 font-medium">
                {f.label}
                {f.kind === 'a_completer' ? (
                  <StatusBadge tone="warning">À compléter par vous</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Rédigée</StatusBadge>
                )}
              </summary>
              <Markdown text={f.markdown} className="t-body mt-2" />
            </details>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={d ? `${d.numbering ?? ''} ${d.title}`.trim() : 'Section'}
        cancelLabel={null}
        confirmLabel="Fermer"
        onConfirm={() => setOpen(null)}
        wide
      >
        {!d ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge>
                {fmtInt(d.wordCount)} mots (cible {fmtInt(d.checks?.wordsTarget ?? 0)})
              </StatusBadge>
              <StatusBadge>Version {d.version}</StatusBadge>
              {d.checks?.groundingRate !== null && d.checks && (
                <StatusBadge tone="success">Ancrage {pct(d.checks.groundingRate)}</StatusBadge>
              )}
              {d.checks && d.checks.rounds > 0 && (
                <StatusBadge tone="info">{d.checks.rounds} ronde(s) de correction</StatusBadge>
              )}
            </div>
            <Markdown
              text={d.markdown}
              sources={d.sources}
              tables={analysis.data?.tables ?? []}
              className="t-body"
            />
            {d.checks &&
              (d.checks.removed.length > 0 ||
                d.checks.warnings.length > 0 ||
                d.checks.manques.length > 0) && (
                <section
                  className="space-y-2 rounded-lg bg-warning-soft p-4"
                  aria-label="Contrôles d’intégrité"
                >
                  <h3 className="t-h3 text-warning">Points relevés par les contrôles</h3>
                  <ul className="t-small list-disc space-y-1 pl-5">
                    {d.checks.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                    {d.checks.manques.map((m) => (
                      <li key={m}>Information manquante : {m}</li>
                    ))}
                  </ul>
                  {d.checks.removed.length > 0 && (
                    <details className="t-small">
                      <summary className="cursor-pointer">
                        Phrases supprimées ({d.checks.removed.length})
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {d.checks.removed.map((r) => (
                          <li key={r.sentence}>
                            « {r.sentence} » — <span className="text-warning">{r.reasonFr}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}
            {d.claims.length > 0 && (
              <section className="space-y-2" aria-label="Preuves d’ancrage">
                <h3 className="t-h3">Affirmations sourcées ({d.claims.length})</h3>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {d.claims.map((c, i) => (
                    <li key={i} className="space-y-1 px-3.5 py-2.5">
                      <div className="flex items-start gap-2">
                        <p className="t-small min-w-0 flex-1 font-serif">{c.sentence}</p>
                        {c.supportLevel && (
                          <StatusBadge tone={SUPPORT[c.supportLevel].tone}>
                            {SUPPORT[c.supportLevel].label}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="t-caption text-text-subtle">
                        {c.sourceLabel ?? 'Source inconnue'}
                      </p>
                      {c.excerpt && (
                        <details className="t-caption text-text-muted">
                          <summary className="cursor-pointer">Extrait de la source</summary>
                          <blockquote className="mt-1 border-l-2 border-primary pl-3 font-serif">
                            {c.excerpt}
                          </blockquote>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.summary && (
              <details className="t-small">
                <summary className="cursor-pointer text-text-muted">
                  Résumé de la section (mémoire des sections suivantes)
                </summary>
                <p className="mt-1 font-serif">{d.summary}</p>
              </details>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
