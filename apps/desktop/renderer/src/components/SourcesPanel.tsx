import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Quote } from 'lucide-react';
import type { SourceSummary } from '@emilio/shared';
import { Button, Modal, Select, Skeleton, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useToasts } from '@/stores/toasts';
import { useUi } from '@/stores/ui';

const VERIF: Record<
  SourceSummary['verificationStatus'],
  { tone: 'success' | 'info' | 'danger' | 'neutral'; label: string }
> = {
  verified: { tone: 'success', label: 'Vérifiée' },
  partially_verified: { tone: 'info', label: 'Partiellement vérifiée' },
  rejected: { tone: 'danger', label: 'Rejetée' },
  unverified: { tone: 'neutral', label: 'Non vérifiée' },
};
const FULLTEXT = {
  fulltext: 'Texte intégral',
  abstract_only: 'Résumé seul',
  none: 'Aucun texte',
} as const;
const TYPE_FR: Record<string, string> = {
  article: 'Article',
  ouvrage: 'Ouvrage',
  chapitre: 'Chapitre',
  these: 'Thèse',
  memoire: 'Mémoire',
  rapport: 'Rapport',
  texte_officiel: 'Texte officiel',
  site_web: 'Site web',
  donnees: 'Données',
};
const ORIGIN_FR: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  hal: 'HAL',
  semantic_scholar: 'Semantic Scholar',
  unpaywall: 'Unpaywall',
  arxiv: 'arXiv',
  europepmc: 'Europe PMC',
  doaj: 'DOAJ',
  core: 'CORE',
  user_upload: 'Importé',
  mock: 'Simulé',
};

const authors = (a: string[]) =>
  a.length > 2 ? `${a[0]} et al.` : a.join(' ; ') || 'Auteur inconnu';

/** Onglet « Sources » (CdC §6.7) : tableau filtrable, fiche détaillée avec preuves de vérification et fiches de lecture. */
export function SourcesPanel({ missionId, simulated }: { missionId: string; simulated: boolean }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const devMode = useUi((s) => s.devMode);
  const [status, setStatus] = React.useState('');
  const [origin, setOrigin] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sources', missionId],
    queryFn: async () => {
      const r = await api.sources.list(missionId);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
  const detail = useQuery({
    queryKey: ['source', open],
    enabled: Boolean(open),
    queryFn: async () => {
      const r = await api.sources.get(open!);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
  const demo = useMutation({
    mutationFn: async () => {
      const r = await api.sources.demoResearch(missionId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['sources', missionId] });
      void qc.invalidateQueries({ queryKey: ['mission', missionId] });
      push({
        tone: r.coverageOk ? 'success' : 'warning',
        title: 'Recherche terminée',
        description: `${r.retained} source(s) retenue(s), ${r.verified} vérifiée(s), ${r.rejected.length} rejetée(s).`,
      });
    },
    onError: (e: { messageFr?: string }) =>
      push({ tone: 'danger', title: 'Recherche impossible', description: e.messageFr }),
  });

  const rows = (data ?? []).filter(
    (s) => (!status || s.verificationStatus === status) && (!origin || s.origin === origin),
  );
  const origins = [...new Set((data ?? []).map((s) => s.origin))];
  const d = detail.data;

  return (
    <section className="space-y-3" aria-label="Sources">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-h2">
          Sources{' '}
          {data ? (
            <span className="t-small font-normal text-text-muted">({data.length})</span>
          ) : null}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Filtrer par statut"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(VERIF).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filtrer par origine"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="h-9"
          >
            <option value="">Toutes les origines</option>
            {origins.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_FR[o] ?? o}
              </option>
            ))}
          </Select>
          {devMode && simulated && (
            <Button variant="ink" size="sm" loading={demo.isPending} onClick={() => demo.mutate()}>
              <FlaskConical className="size-4" />
              Recherche de démonstration
            </Button>
          )}
        </div>
      </div>
      {isLoading && <Skeleton className="h-24" />}
      {data && data.length === 0 && (
        <p className="t-small rounded-lg border border-dashed border-border p-5 text-text-muted">
          Aucune source pour l'instant. La recherche documentaire démarre après la validation du
          plan.
        </p>
      )}
      {rows.length > 0 && (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          aria-label="Liste des sources"
        >
          {rows.map((s) => {
            const v = VERIF[s.verificationStatus];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(s.id)}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-primary-softer"
                >
                  <div className="min-w-0 flex-1">
                    <p className="t-h3 truncate">{s.title}</p>
                    <p className="t-small truncate text-text-muted">
                      {authors(s.authors)} · {s.year ?? 's.d.'} · {TYPE_FR[s.type] ?? s.type} ·{' '}
                      {ORIGIN_FR[s.origin] ?? s.origin}
                    </p>
                    {s.verificationNote && s.verificationStatus === 'rejected' && (
                      <p className="t-caption mt-0.5 text-danger">{s.verificationNote}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge tone={v.tone}>{v.label}</StatusBadge>
                    <span className="t-caption text-text-subtle">{FULLTEXT[s.fulltextStatus]}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={d?.title ?? 'Source'}
        cancelLabel={null}
        confirmLabel="Fermer"
        onConfirm={() => setOpen(null)}
        wide
      >
        {!d ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-4">
            <p className="t-small text-text-muted">
              {authors(d.authors)} · {d.year ?? 's.d.'}
              {d.journal ? ` · ${d.journal}` : ''}
              {d.volume ? `, vol. ${d.volume}` : ''}
              {d.pages ? `, p. ${d.pages}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={VERIF[d.verificationStatus].tone}>
                {VERIF[d.verificationStatus].label}
              </StatusBadge>
              <StatusBadge>{FULLTEXT[d.fulltextStatus]}</StatusBadge>
              {d.doi && <StatusBadge tone="primary">DOI {d.doi}</StatusBadge>}
              {d.quality !== null && (
                <StatusBadge>Qualité {(d.quality * 100).toFixed(0)} %</StatusBadge>
              )}
              {d.relevance !== null && (
                <StatusBadge>Pertinence {(d.relevance * 100).toFixed(0)} %</StatusBadge>
              )}
            </div>
            {d.abstract && <p className="t-small font-serif leading-6">{d.abstract}</p>}
            <section>
              <h3 className="t-h3">Preuves de vérification</h3>
              {d.evidence ? (
                <div className="mt-1 space-y-2">
                  {d.verificationNote && <p className="t-small">{d.verificationNote}</p>}
                  <details className="t-caption text-text-muted">
                    <summary className="cursor-pointer">Détails techniques</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-surface-muted p-3">
                      {JSON.stringify(d.evidence, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <p className="t-small text-text-muted">Pas encore vérifiée.</p>
              )}
            </section>
            {d.notes.map((n) => (
              <section key={n.sectionKey} className="space-y-2 rounded-lg bg-primary-softer p-4">
                <h3 className="t-h3">Fiche de lecture — {n.sectionKey}</h3>
                <p className="t-small">
                  <span className="font-medium">Thèse : </span>
                  {n.these_principale}
                </p>
                <p className="t-small">
                  <span className="font-medium">Pertinence : </span>
                  {n.pertinence}
                </p>
                {n.citations.map((c) => (
                  <blockquote
                    key={c.texte}
                    className={cn('t-small flex gap-2 border-l-2 border-primary pl-3 font-serif')}
                  >
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    <span>
                      « {c.texte} »{c.pageFrom ? ` (p. ${c.pageFrom})` : ''}
                    </span>
                  </blockquote>
                ))}
                {n.citationsEcartees > 0 && (
                  <p className="t-caption text-warning">
                    {n.citationsEcartees} citation(s) proposée(s) par l'IA écartée(s) :
                    introuvable(s) dans le texte source.
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </Modal>
    </section>
  );
}
