import type { CostEstimate } from '@emilio/shared';
import { ESTIMATE_SCENARIOS, ESTIMATE_SCENARIO_LABEL_FR } from '@emilio/shared';
import { Clock, Coins } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtDuration, fmtUsd } from '@/lib/fr';

/** Estimation du coût et de la durée (§14.5) : trois scénarios, détail par phase, avertissements de budget. */
export function EstimateCard({ estimate }: { estimate: CostEstimate }) {
  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
      aria-label="Estimation du coût et de la durée"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-h2">Coût et durée estimés</h2>
        <div className="flex gap-2">
          {estimate.simulated && (
            <StatusBadge tone="info">Prix d’exemple (mode simulé)</StatusBadge>
          )}
          {estimate.partial && (
            <StatusBadge tone="warning">Minimum : prix inconnu pour certains modèles</StatusBadge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {ESTIMATE_SCENARIOS.map((s) => {
          const e = estimate.scenarios[s];
          const over = estimate.exceedsBudget[s];
          return (
            <div
              key={s}
              data-testid={`scenario-${s}`}
              className={cn(
                'space-y-1 rounded-lg border-2 p-4',
                s === 'moyen' ? 'border-primary bg-primary-softer' : 'border-border',
              )}
            >
              <p className="t-caption text-text-muted">
                Scénario {ESTIMATE_SCENARIO_LABEL_FR[s].toLowerCase()}
              </p>
              <p className="t-kpi flex items-center gap-2">
                <Coins className="size-4 text-primary" aria-hidden />
                <span className={cn(over && 'text-danger')}>{fmtUsd(e.costUsd)}</span>
              </p>
              <p className="t-small flex items-center gap-2 text-text-muted">
                <Clock className="size-4" aria-hidden />
                {fmtDuration(e.durationSec)}
              </p>
            </div>
          );
        })}
      </div>
      <p className="t-small text-text-muted">
        Scénario bas : 1 ronde de jury par chapitre · moyen : 2 rondes · haut : le maximum permis
        partout.
        {estimate.budgetMaxUsd ? ` Budget maximal : ${fmtUsd(estimate.budgetMaxUsd)}.` : ''}
        {estimate.spentUsd > 0 ? ` Déjà dépensé : ${fmtUsd(estimate.spentUsd, 3)}.` : ''}
      </p>
      <details className="t-small">
        <summary className="cursor-pointer text-text-muted">
          Détail par phase (scénario moyen)
        </summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="t-caption text-left text-text-subtle">
              <th className="py-1 font-medium">Phase</th>
              <th className="py-1 text-right font-medium">Coût</th>
              <th className="py-1 text-right font-medium">Durée</th>
            </tr>
          </thead>
          <tbody>
            {estimate.phases.map((p) => (
              <tr key={p.phase} className="border-t border-border">
                <td className="py-1.5">
                  <span className="text-text-subtle">{p.phase}</span> {p.labelFr}
                </td>
                <td className="tabular py-1.5 text-right">{fmtUsd(p.costUsd.moyen)}</td>
                <td className="tabular py-1.5 text-right">{fmtDuration(p.durationSec.moyen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="t-caption text-text-subtle">{estimate.assumptions.join(' ')}</p>
    </section>
  );
}
