import type { JuryScopeView, JuryVerdict, RemarkSeverity, RevisionView } from '@emilio/shared';
import { SEVERITY_LABEL_FR, VERDICT_LABEL_FR } from '@emilio/shared';
import { ProgressBar, Skeleton, StatusBadge } from '@/components/ui';
import { useJury } from '@/lib/queries';

const TONE: Record<JuryVerdict, 'success' | 'warning' | 'danger'> = {
  valide: 'success',
  a_reviser: 'warning',
  a_reecrire: 'danger',
};
const SEV: Record<RemarkSeverity, 'danger' | 'warning' | 'neutral'> = {
  majeure: 'danger',
  mineure: 'warning',
  suggestion: 'neutral',
};
const note = (x: number | null) => (x === null ? 'n. a.' : x.toFixed(1).replace('.', ','));

function Revisions({ items, title }: { items: RevisionView[]; title: string }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <h5 className="t-small font-medium">{title}</h5>
      <ul className="space-y-1">
        {items.map((r, i) => (
          <li key={i} className="t-caption flex flex-wrap items-center gap-2 text-text-muted">
            <span className="text-text">{r.label}</span>
            <span className="tabular">
              v{r.fromVersion ?? '?'} → v{r.toVersion ?? '?'}
            </span>
            {r.outcome === 'reverted' ? (
              <StatusBadge tone="warning">Annulée (note dégradée)</StatusBadge>
            ) : (
              <StatusBadge tone="success">Conservée</StatusBadge>
            )}
            {r.remarks.length > 0 && <span>{r.remarks.join(' · ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Scope({ s }: { s: JuryScopeView }) {
  const last = s.rounds[s.rounds.length - 1];
  return (
    <article className="space-y-4 rounded-lg border border-border p-5" aria-label={s.title}>
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="t-h3 min-w-0 flex-1">{s.title}</h3>
        <span className="t-small text-text-muted">
          Seuil {note(s.threshold)} / 20 · {s.rounds.length} / {s.maxRounds + 1} évaluation(s)
        </span>
        {s.status === 'valide' && <StatusBadge tone="success">Validé</StatusBadge>}
        {s.status === 'accepte_avec_reserves' && (
          <StatusBadge tone="warning">Accepté avec réserves</StatusBadge>
        )}
        {s.status === 'en_cours' && <StatusBadge tone="info">En cours</StatusBadge>}
        {s.finalScore !== null && <span className="t-h3 tabular">{note(s.finalScore)} / 20</span>}
      </header>

      {s.reasons.length > 0 && (
        <ul className="t-small list-disc space-y-0.5 pl-5 text-text-muted">
          {s.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {s.rounds.length > 1 && (
        <div className="space-y-1.5" aria-label="Évolution de la note">
          <h4 className="t-small font-medium">Évolution de la note</h4>
          {s.rounds.map((r) => (
            <div key={r.round} className="flex items-center gap-3">
              <span className="t-caption w-16 shrink-0 text-text-subtle">Ronde {r.round}</span>
              <ProgressBar
                className="flex-1"
                value={r.total}
                max={20}
                tone={r.total >= s.threshold ? 'success' : 'primary'}
                label={`Note de la ronde ${r.round}`}
              />
              <span className="t-small tabular w-14 text-right">{note(r.total)}</span>
            </div>
          ))}
        </div>
      )}

      {s.rounds.map((r) => (
        <details key={r.round} open={r === last} className="rounded-lg bg-surface-muted p-4">
          <summary className="t-small flex cursor-pointer flex-wrap items-center gap-2 font-medium">
            Ronde {r.round} — {note(r.total)} / 20
            <StatusBadge tone={TONE[r.verdict]}>{VERDICT_LABEL_FR[r.verdict]}</StatusBadge>
          </summary>
          <div className="mt-3 space-y-4">
            {r.synthesis && <p className="t-body">{r.synthesis}</p>}
            {r.crossJustification && (
              <p className="t-small rounded-md border border-border p-3">
                <strong>Écart entre jurés : </strong>
                {r.crossJustification}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="t-small w-full text-left" aria-label="Grille d’évaluation">
                <thead className="text-text-subtle">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Critère</th>
                    {r.jurors.map((j) => (
                      <th key={j.role} className="px-2 py-1 font-medium">
                        {j.roleLabel}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right font-medium">Moyenne</th>
                  </tr>
                </thead>
                <tbody>
                  {r.criteria.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="py-1 pr-3">{c.label}</td>
                      {r.jurors.map((j) => {
                        const sc = j.scores.find((x) => x.id === c.id);
                        return (
                          <td key={j.role} className="tabular px-2 py-1" title={sc?.justification}>
                            {sc ? `${note(sc.note)} / ${sc.max}` : '—'}
                          </td>
                        );
                      })}
                      <td className="tabular px-2 py-1 text-right">
                        {note(c.avg)} / {c.max}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-medium">
                    <td className="py-1 pr-3">Total sur 20</td>
                    {r.jurors.map((j) => (
                      <td key={j.role} className="tabular px-2 py-1">
                        {note(j.total)}
                      </td>
                    ))}
                    <td className="tabular px-2 py-1 text-right">{note(r.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {r.jurors.some((j) => j.remarks.length > 0) && (
              <div className="space-y-1.5">
                <h5 className="t-small font-medium">Remarques</h5>
                <ul className="space-y-1.5">
                  {r.jurors.flatMap((j) =>
                    j.remarks.map((k) => (
                      <li key={`${j.role}-${k.id}`} className="t-small flex gap-2">
                        <StatusBadge tone={SEV[k.severity]}>
                          {SEVERITY_LABEL_FR[k.severity]}
                        </StatusBadge>
                        <span className="min-w-0 flex-1">
                          <span className="text-text-subtle">{j.roleLabel} · </span>
                          {k.problem}
                          <span className="block text-text-muted">→ {k.expected}</span>
                        </span>
                      </li>
                    )),
                  )}
                </ul>
              </div>
            )}
            {r.plan.length > 0 && (
              <div className="space-y-1.5">
                <h5 className="t-small font-medium">Plan de révision du président</h5>
                <ul className="t-small list-disc space-y-0.5 pl-5">
                  {r.plan.map((p) => (
                    <li key={p.nodeId}>
                      <strong>{p.label}</strong> — {p.actions.join(' ; ')}
                      {p.needsResearch && ' (recherche complémentaire)'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Revisions items={r.revisions} title="Révisions menées ensuite" />
          </div>
        </details>
      ))}

      <Revisions items={s.harmonisation} title="Harmonisation (modifications ciblées)" />
    </article>
  );
}

/** Onglet « Jury » (CdC §6.7, §13) : grille, jurés, remarques, révisions, évolution des notes. */
export function JuryPanel({ missionId }: { missionId: string }) {
  const { data, isLoading } = useJury(missionId);
  return (
    <section className="space-y-3" aria-label="Jury">
      <h2 className="t-h2">Jury</h2>
      {isLoading && <Skeleton className="h-24" />}
      {data && data.length === 0 && (
        <p className="t-small rounded-lg border border-dashed border-border p-5 text-text-muted">
          Le jury évalue chaque chapitre une fois la rédaction terminée.
        </p>
      )}
      {data?.map((s) => (
        <Scope key={`${s.scope}:${s.targetId}`} s={s} />
      ))}
    </section>
  );
}
