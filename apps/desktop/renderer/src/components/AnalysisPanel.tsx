import { BarChart3 } from 'lucide-react';
import { HYPOTHESIS_STATUS_LABEL_FR, type HypothesisStatus } from '@emilio/shared';
import { Skeleton, StatusBadge } from '@/components/ui';
import { ResultTable } from '@/components/Markdown';
import { useFieldAnalysis } from '@/lib/queries';

const TONE: Record<HypothesisStatus, 'success' | 'danger' | 'warning'> = {
  confirmee: 'success',
  infirmee: 'danger',
  nuancee: 'warning',
};

/** Résultats de l'analyse des données de terrain (CdC §9 P4) : tableaux calculés par le code, interprétation, statut des hypothèses. */
export function AnalysisPanel({ missionId }: { missionId: string }) {
  const { data, isLoading } = useFieldAnalysis(missionId);
  if (isLoading) return <Skeleton className="h-24" />;
  if (!data) return null;
  return (
    <section className="space-y-4" aria-label="Analyse des données">
      <h2 className="t-h2 flex items-center gap-2">
        <BarChart3 className="size-5 text-primary" aria-hidden />
        Analyse des données{' '}
        <span className="t-small font-normal text-text-muted">
          ({data.respondents} répondants · {data.fileName})
        </span>
      </h2>
      <p className="t-small rounded-md bg-primary-softer p-3 text-text-muted">
        Tous les chiffres sont calculés par le module statistique de l’application, jamais par un
        modèle d’IA ; l’interprétation ne peut employer que ces chiffres.
      </p>
      {data.warnings.length > 0 && (
        <ul className="t-small list-disc space-y-1 rounded-md bg-warning-soft p-3 pl-7 text-warning">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-x-8">
        {data.tables.map((t) => (
          <div key={t.id} className="min-w-0">
            <ResultTable t={t} />
            {t.warnings.map((w) => (
              <p key={w} className="t-caption text-warning">
                {w}
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="t-h3">Interprétation</h3>
        {data.interpretation.split(/\n{2,}/).map((p, i) => (
          <p key={i} className="t-body font-serif">
            {p}
          </p>
        ))}
        {data.sentencesDropped > 0 && (
          <p className="t-caption text-warning">
            {data.sentencesDropped} phrase(s) écartée(s) : elles contenaient un nombre absent des
            résultats calculés.
          </p>
        )}
      </div>
      {data.hypotheses.length > 0 && (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          aria-label="Hypothèses"
        >
          {data.hypotheses.map((h) => (
            <li key={h.hypothese} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="t-small font-medium">{h.hypothese}</p>
                {h.justification && <p className="t-small text-text-muted">{h.justification}</p>}
                {h.note && <p className="t-caption text-warning">{h.note}</p>}
              </div>
              <StatusBadge tone={TONE[h.statut]}>
                {HYPOTHESIS_STATUS_LABEL_FR[h.statut]}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      {data.limites.length > 0 && (
        <p className="t-small text-text-muted">Limites : {data.limites.join(' ')}</p>
      )}
    </section>
  );
}
