import { DELIVERABLE_LABEL_FR, type FinalCheckItem } from '@emilio/shared';
import { Button, Skeleton, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { errorText } from '@/lib/fr';
import { useExports } from '@/lib/queries';
import { useToasts } from '@/stores/toasts';

const TONE: Record<FinalCheckItem['status'], 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  avertissement: 'warning',
  echec: 'danger',
};
const LABEL: Record<FinalCheckItem['status'], string> = {
  ok: 'Conforme',
  avertissement: 'À lire',
  echec: 'À vérifier',
};
const size = (n: number) =>
  n > 1_048_576
    ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} Mo`
    : `${Math.max(1, Math.round(n / 1024))} Ko`;

/** Onglet « Livrables » (CdC §16) : fichiers produits, contrôle final, emplacements à compléter, charte d'utilisation (§17.5). */
export function DeliverablesPanel({ missionId }: { missionId: string }) {
  const { data, isLoading } = useExports(missionId);
  const push = useToasts((s) => s.push);
  const run = async (
    f: () => Promise<{
      ok: boolean;
      error?: { code?: string; messageFr: string; detail?: string };
    }>,
  ) => {
    const r = await f();
    if (!r.ok && r.error)
      push({ tone: 'danger', title: 'Action impossible', description: errorText(r.error) });
  };

  return (
    <section className="space-y-4" aria-label="Livrables">
      <h2 className="t-h2">Livrables</h2>
      {isLoading && <Skeleton className="h-24" />}
      {data && data.deliverables.length === 0 && data.skipped.length === 0 && (
        <p className="t-small rounded-lg border border-dashed border-border p-5 text-text-muted">
          Les fichiers (Word, PDF, diaporama, rapport) sont produits à la fin de la mission.
        </p>
      )}
      {data && data.deliverables.length > 0 && (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          aria-label="Fichiers produits"
        >
          {data.deliverables.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="t-small block font-medium">{DELIVERABLE_LABEL_FR[d.kind]}</span>
                <span className="t-caption block truncate text-text-subtle">
                  {d.filename} · {size(d.sizeBytes)}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => run(() => api.exports.saveAs(d.id))}
              >
                Enregistrer sous…
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => run(() => api.exports.reveal(d.id))}
              >
                Afficher dans le dossier
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data?.skipped.map((s) => (
        <p key={s.kind} className="t-small rounded-lg border border-border bg-warning-soft p-3">
          <strong>{DELIVERABLE_LABEL_FR[s.kind]}</strong> n’a pas été produit : {s.reasonFr}
        </p>
      ))}
      {data?.bibliography && (
        <p className="t-small text-text-muted">
          Bibliographie : {data.bibliography.cited} source(s) citée(s) sur {data.bibliography.total}{' '}
          retenue(s), style « {data.bibliography.styleLabel} »
          {data.bibliography.notes ? ' (notes de bas de page)' : ''}.
        </p>
      )}
      {data?.finalCheck && (
        <div className="space-y-2" aria-label="Contrôle final">
          <h3 className="t-h3">
            Contrôle final{' '}
            <StatusBadge tone={data.finalCheck.ok ? 'success' : 'danger'}>
              {data.finalCheck.ok ? 'Aucun problème bloquant' : 'Points à vérifier'}
            </StatusBadge>
          </h3>
          <ul className="space-y-1.5">
            {data.finalCheck.items.map((i) => (
              <li key={i.id} className="t-small flex gap-2">
                <StatusBadge tone={TONE[i.status]}>{LABEL[i.status]}</StatusBadge>
                <span className="min-w-0 flex-1">
                  {i.label}
                  {i.detail && <span className="block text-text-muted">{i.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {data.finalCheck.placeholders.length > 0 && (
            <details className="rounded-lg border border-border px-4 py-2.5">
              <summary className="t-small cursor-pointer font-medium">
                {data.finalCheck.placeholders.length} emplacement(s) à compléter par vous
              </summary>
              <ul className="t-small mt-2 list-disc space-y-0.5 pl-5">
                {data.finalCheck.placeholders.map((p, i) => (
                  <li key={i}>
                    {p.section} : <span className="rounded bg-warning-soft px-1">{p.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {data && data.deliverables.length > 0 && (
        <div
          className="t-small rounded-lg border border-border bg-primary-softer p-4"
          aria-label="Charte d’utilisation"
        >
          <strong>Vous restez l’auteur responsable de votre travail.</strong> Relisez-le
          entièrement, appropriez-vous le contenu, vérifiez les sources clés et respectez les règles
          de votre établissement sur l’usage de l’IA (certaines exigent une déclaration d’usage : un
          modèle figure dans le rapport de mission).
        </div>
      )}
    </section>
  );
}
