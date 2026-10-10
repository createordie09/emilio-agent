import { Skeleton, StatusBadge } from '@/components/ui';
import { fmtInt, fmtUsd } from '@/lib/fr';
import { useTechLog } from '@/lib/queries';

/** Onglet « Journal technique » (CdC §6.6, §18) : appels de modèle, sans le contenu des échanges. */
export function TechLogPanel({ missionId }: { missionId: string }) {
  const { data, isLoading } = useTechLog(missionId);
  return (
    <section className="space-y-3" aria-label="Journal technique">
      <h2 className="t-h2">Journal technique</h2>
      <p className="t-small text-text-muted">
        Les {data?.length ?? 0} derniers appels aux modèles d’IA. Le contenu des échanges n’est pas
        conservé ici, et la clé n’apparaît jamais.
      </p>
      {isLoading && <Skeleton className="h-24" />}
      {data && data.length > 0 && (
        <div className="max-h-[460px] overflow-auto rounded-lg border border-border">
          <table className="t-small w-full text-left" aria-label="Appels aux modèles">
            <thead className="sticky top-0 bg-surface text-text-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">Heure</th>
                <th className="px-2 py-2 font-medium">Agent</th>
                <th className="px-2 py-2 font-medium">Modèle</th>
                <th className="px-2 py-2 text-right font-medium">Jetons</th>
                <th className="px-2 py-2 text-right font-medium">Coût</th>
                <th className="px-2 py-2 text-right font-medium">Durée</th>
                <th className="px-3 py-2 font-medium">État</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="tabular px-3 py-1.5">
                    {new Date(c.at).toLocaleTimeString('fr-FR')}
                  </td>
                  <td className="px-2">{c.role ?? '—'}</td>
                  <td className="max-w-48 truncate px-2" title={c.model}>
                    {c.model}
                  </td>
                  <td className="tabular px-2 text-right">
                    {fmtInt(c.tokensIn ?? 0)} / {fmtInt(c.tokensOut ?? 0)}
                  </td>
                  <td className="tabular px-2 text-right">{fmtUsd(c.costUsd ?? 0, 4)}</td>
                  <td className="tabular px-2 text-right">
                    {c.latencyMs ? `${fmtInt(c.latencyMs)} ms` : '—'}
                  </td>
                  <td className="px-3">
                    {c.error ? (
                      <StatusBadge tone="danger">{c.error}</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">OK</StatusBadge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
