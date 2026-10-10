import * as React from 'react';
import { Button, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errorText, fmtUsd } from '@/lib/fr';
import { useToasts } from '@/stores/toasts';

/** Budget atteint (CdC §8.6, §20 E_BUDGET) : relever le plafond, ou passer directement à la finalisation (P8–P9) avec l'état actuel. */
export function BudgetActions({
  missionId,
  spent,
  budget,
}: {
  missionId: string;
  spent: number;
  budget: number;
}) {
  const push = useToasts((s) => s.push);
  const [value, setValue] = React.useState(String(Math.max(Math.ceil(spent * 1.5), budget + 1)));
  const [busy, setBusy] = React.useState(false);
  const run = async (
    f: () => Promise<{
      ok: boolean;
      error?: { code?: string; messageFr: string; detail?: string };
    }>,
  ) => {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (!r.ok && r.error)
      push({ tone: 'danger', title: 'Action impossible', description: errorText(r.error) });
  };
  return (
    <section aria-label="Budget atteint" className="space-y-3 rounded-lg bg-warning-soft p-5">
      <p className="t-small">
        <strong>Le budget de {fmtUsd(budget)} est atteint</strong> ({fmtUsd(spent, 2)} dépensés). La
        mission est en pause. Relevez le budget pour continuer, ou finalisez avec ce qui est déjà
        rédigé : les sections non rédigées seront signalées dans le document.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="t-small flex flex-col gap-1">
          Nouveau budget (en dollars)
          <Input
            type="number"
            min={Math.ceil(spent)}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-40"
          />
        </label>
        <Button
          disabled={busy}
          onClick={() => void run(() => api.ops.raiseBudget(missionId, Number(value)))}
        >
          Relever le budget et reprendre
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => api.ops.finalizeNow(missionId))}
        >
          Finaliser avec l’état actuel
        </Button>
      </div>
    </section>
  );
}
