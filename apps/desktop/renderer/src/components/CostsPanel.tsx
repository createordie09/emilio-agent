import type { CostLine } from '@emilio/shared';
import { ProgressBar, Skeleton } from '@/components/ui';
import { fmtInt, fmtUsd } from '@/lib/fr';
import { useCosts } from '@/lib/queries';

function Table({ title, lines, total }: { title: string; lines: CostLine[]; total: number }) {
  return (
    <div className="space-y-2">
      <h3 className="t-h3">{title}</h3>
      {lines.length === 0 ? (
        <p className="t-small text-text-muted">Aucun appel pour l’instant.</p>
      ) : (
        <table className="t-small w-full text-left" aria-label={title}>
          <thead className="text-text-subtle">
            <tr>
              <th className="py-1 pr-3 font-medium">Nom</th>
              <th className="px-2 py-1 text-right font-medium">Appels</th>
              <th className="px-2 py-1 text-right font-medium">Jetons envoyés</th>
              <th className="px-2 py-1 text-right font-medium">Jetons reçus</th>
              <th className="px-2 py-1 text-right font-medium">Coût</th>
              <th className="w-28 py-1 pl-3 font-medium" aria-label="Part du coût" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-border">
                <td className="py-1.5 pr-3">{l.label}</td>
                <td className="tabular px-2 text-right">{fmtInt(l.calls)}</td>
                <td className="tabular px-2 text-right">{fmtInt(l.tokensIn)}</td>
                <td className="tabular px-2 text-right">{fmtInt(l.tokensOut)}</td>
                <td className="tabular px-2 text-right">{fmtUsd(l.costUsd, 3)}</td>
                <td className="py-1.5 pl-3">
                  <ProgressBar
                    value={total ? (l.costUsd / total) * 100 : 0}
                    label={`Part de ${l.label}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Onglet « Coûts » (CdC §6.7) : par phase, par agent et par modèle ; projection du coût restant. */
export function CostsPanel({ missionId }: { missionId: string }) {
  const { data, isLoading } = useCosts(missionId);
  return (
    <section className="space-y-5" aria-label="Coûts">
      <h2 className="t-h2">Coûts</h2>
      {isLoading && <Skeleton className="h-24" />}
      {data && (
        <>
          <p className="t-small text-text-muted">
            <strong className="text-text">{fmtUsd(data.totalUsd, 3)}</strong> dépensés
            {data.budgetMaxUsd ? ` sur un budget de ${fmtUsd(data.budgetMaxUsd)}` : ''} ·{' '}
            {fmtInt(data.calls)} appel(s) · {fmtInt(data.tokensIn)} jetons envoyés,{' '}
            {fmtInt(data.tokensOut)} reçus.
            {data.projectedRemainingUsd !== null &&
              ` Coût restant estimé : environ ${fmtUsd(data.projectedRemainingUsd, 2)}.`}
          </p>
          <Table title="Par phase" lines={data.byPhase} total={data.totalUsd} />
          <Table title="Par agent" lines={data.byRole} total={data.totalUsd} />
          <Table title="Par modèle d’IA" lines={data.byModel} total={data.totalUsd} />
        </>
      )}
    </section>
  );
}
