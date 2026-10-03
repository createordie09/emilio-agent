import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Rocket, TriangleAlert, WandSparkles } from 'lucide-react';
import type { OutlineNodeView, PlanOverview, Result } from '@emilio/shared';
import {
  Button,
  Composer,
  Modal,
  OptionCard,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@/components/ui';
import { EstimateCard } from '@/components/plan/EstimateCard';
import { NodeDetail } from '@/components/plan/NodeDetail';
import { PlanTree } from '@/components/plan/PlanTree';
import { api } from '@/lib/api';
import { errorText, fmtInt } from '@/lib/fr';
import { usePlan } from '@/lib/queries';
import { useToasts } from '@/stores/toasts';

/** Écran de validation du plan (CdC §6.5) : arbre éditable, détail de la section, problématique, estimation, nouvelle version ou validation. */
export function PlanPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const { data: plan, error } = usePlan(id);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'regen' | 'validate' | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [own, setOwn] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (plan && (!selected || !plan.nodes.some((n) => n.id === selected)))
      setSelected(plan.nodes[0]?.id ?? null);
  }, [plan, selected]);

  if (error)
    return (
      <div className="p-8">
        <p role="alert" className="t-small rounded-md bg-danger-soft p-3 text-danger">
          {(error as { messageFr?: string }).messageFr ?? 'Le plan est indisponible.'}
        </p>
      </div>
    );
  if (!plan || !id)
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );

  const editable = plan.status === 'awaiting_plan_validation';
  const node = plan.nodes.find((n) => n.id === selected) ?? null;
  const children = (n: OutlineNodeView) => plan.nodes.filter((c) => c.parentId === n.id);
  const sum = (n: OutlineNodeView): number =>
    children(n).length ? children(n).reduce((s, c) => s + sum(c), 0) : n.targetWords;
  const siblings = node ? plan.nodes.filter((n) => n.parentId === node.parentId) : [];
  const pos = node ? siblings.findIndex((n) => n.id === node.id) : -1;

  /** Exécute une action sur le plan ; la réponse met à jour le cache, l'échec s'affiche en français. */
  const edit = async (f: () => Promise<Result<PlanOverview>>) => {
    const r = await f();
    if (!r.ok) {
      push({
        tone: 'danger',
        title: 'Modification impossible',
        description: errorText(r.error),
      });
      return null;
    }
    qc.setQueryData(['plan', id], r.value);
    return r.value;
  };
  const instructions = comment ?? plan.instructions ?? '';

  const regenerate = async () => {
    if (!instructions.trim()) {
      push({
        tone: 'warning',
        title: 'Précisez votre demande',
        description: 'Écrivez ce que vous voulez changer dans « Instructions supplémentaires ».',
      });
      return;
    }
    setBusy('regen');
    const r = await api.plan.regenerate(id, instructions);
    setBusy(null);
    if (!r.ok)
      return push({ tone: 'danger', title: 'Action impossible', description: errorText(r.error) });
    nav(`/missions/${id}`);
  };
  const validate = async () => {
    setBusy('validate');
    const r = await api.plan.validate(id);
    setBusy(null);
    if (!r.ok)
      return push({
        tone: 'danger',
        title: 'Validation impossible',
        description: errorText(r.error),
      });
    push({
      tone: 'success',
      title: 'Plan validé',
      description: 'La recherche documentaire démarre.',
    });
    nav(`/missions/${id}`);
  };

  const w = plan.words;
  const target =
    w.unit === 'pages'
      ? `${w.targetMin} à ${w.targetMax} pages`
      : `${fmtInt(w.targetMin)} à ${fmtInt(w.targetMax)} mots`;
  const maxChapter = Math.max(1, ...w.chapters.map((c) => c.words));

  return (
    <>
      <PageHeader
        title={editable ? 'Valider le plan' : 'Plan de la mission'}
        breadcrumb={['Mes missions', plan.title, 'Plan']}
        onBack={() => nav(`/missions/${id}`)}
        actions={
          <>
            <StatusBadge tone="neutral">Version {plan.version}</StatusBadge>
            {plan.simulated && <StatusBadge tone="info">Mode simulé</StatusBadge>}
          </>
        }
      />
      <div className="space-y-6 px-8 pb-10">
        {/* En haut : problématique, hypothèses, méthodologie, répartition des mots (§6.5) */}
        <div className="grid grid-cols-5 gap-6">
          <section
            className="col-span-3 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
            aria-label="Problématique et méthode"
          >
            <h2 className="t-h2">Problématique retenue</h2>
            {plan.problematiqueAProposer ? (
              <div role="radiogroup" aria-label="Problématique" className="space-y-2">
                <p className="t-small text-text-muted">
                  Votre brief ne fixait pas de problématique : choisissez l’une des formulations
                  proposées, ou écrivez la vôtre.
                </p>
                {(plan.cadrage?.problematiques ?? []).map((p, i) => (
                  <OptionCard
                    key={p.formulation}
                    selected={plan.problematiqueChoisie === p.formulation}
                    disabled={!editable}
                    title={`Formulation ${i + 1}`}
                    description={`${p.formulation} — ${p.justification}`}
                    onSelect={() =>
                      void edit(() =>
                        api.plan.saveMeta(id, { problematiqueChoisie: p.formulation }),
                      )
                    }
                  />
                ))}
                <Textarea
                  aria-label="Votre propre problématique"
                  placeholder="Ou saisissez votre propre problématique"
                  rows={2}
                  disabled={!editable}
                  value={
                    own ??
                    (plan.cadrage?.problematiques.some(
                      (p) => p.formulation === plan.problematiqueChoisie,
                    )
                      ? ''
                      : (plan.problematiqueChoisie ?? ''))
                  }
                  onChange={(e) => setOwn(e.target.value)}
                  onBlur={() =>
                    own !== null &&
                    void edit(() => api.plan.saveMeta(id, { problematiqueChoisie: own }))
                  }
                />
              </div>
            ) : (
              <p className="t-body font-serif">{plan.problematique}</p>
            )}
            {plan.hypotheses.length > 0 && (
              <div>
                <h3 className="t-h3">Hypothèses</h3>
                <ul className="t-body mt-1 list-disc space-y-1 pl-5">
                  {plan.hypotheses.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.methodologie && (
              <div>
                <h3 className="t-h3">Méthode de vérification proposée</h3>
                <p className="t-body mt-1">{plan.methodologie}</p>
              </div>
            )}
            {plan.justification && (
              <div>
                <h3 className="t-h3">Pourquoi ce plan</h3>
                <p className="t-small mt-1 text-text-muted">{plan.justification}</p>
              </div>
            )}
          </section>

          <section
            className="col-span-2 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
            aria-label="Répartition des mots"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="t-h2">Répartition des mots</h2>
              <StatusBadge tone={w.status === 'ok' ? 'success' : 'warning'}>
                {w.status === 'ok'
                  ? 'Longueur conforme'
                  : w.status === 'trop_court'
                    ? 'Trop court'
                    : 'Trop long'}
              </StatusBadge>
            </div>
            <p className="t-small">
              <span className="t-kpi tabular">{fmtInt(w.planned)}</span> mots prévus, soit environ{' '}
              <strong>{w.plannedPages} pages</strong> avec les pages liminaires. Longueur demandée :{' '}
              {target}.
            </p>
            <ul className="space-y-2">
              {w.chapters.map((c) => (
                <li key={c.nodeId} className="space-y-1">
                  <div className="t-caption flex justify-between gap-2">
                    <span className="truncate">{c.label}</span>
                    <span className="tabular shrink-0 text-text-muted">{fmtInt(c.words)}</span>
                  </div>
                  <ProgressBar value={c.words} max={maxChapter} label={c.label} />
                </li>
              ))}
            </ul>
            {plan.liminaires.length > 0 && (
              <p className="t-caption text-text-subtle">
                Pages liminaires prévues : {plan.liminaires.join(', ')}.
              </p>
            )}
          </section>
        </div>

        {(plan.warnings.length > 0 || plan.risques.length > 0) && (
          <section
            className="space-y-2 rounded-lg bg-warning-soft p-4"
            aria-label="Points d’attention"
          >
            <h2 className="t-h3 flex items-center gap-2 text-warning">
              <TriangleAlert className="size-4" aria-hidden />
              Points d’attention
            </h2>
            <ul className="t-small list-disc space-y-1 pl-5">
              {[...plan.warnings, ...plan.risques].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        )}

        {plan.cadrage && plan.cadrage.incoherences.length > 0 && (
          <section
            className="space-y-2 rounded-lg border border-border p-4"
            aria-label="Incohérences du brief"
          >
            <h2 className="t-h3">Incohérences relevées dans votre brief</h2>
            <ul className="space-y-2">
              {plan.cadrage.incoherences.map((x) => (
                <li key={x.element + x.probleme} className="t-small">
                  <strong>{x.element}</strong> — {x.probleme}{' '}
                  <span className="text-text-muted">Proposition : {x.proposition}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Arbre + détail */}
        <div className="grid grid-cols-[360px_1fr] gap-6">
          <section
            className="max-h-[640px] space-y-3 overflow-auto rounded-lg border border-border bg-surface p-4 shadow-sm"
            aria-label="Arbre du plan"
          >
            <div className="flex items-center justify-between">
              <h2 className="t-h2">Plan</h2>
              {editable && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void edit(() =>
                      api.plan.addNode(id, {
                        parentId: null,
                        title: 'Nouveau chapitre',
                        level: 'chapitre',
                      }),
                    )
                  }
                >
                  Ajouter un chapitre
                </Button>
              )}
            </div>
            {editable && (
              <p className="t-caption text-text-subtle">
                Glissez-déposez une carte pour la déplacer (haut ou bas = avant ou après, centre = à
                l’intérieur).
              </p>
            )}
            <PlanTree
              nodes={plan.nodes}
              selectedId={selected}
              onSelect={setSelected}
              editable={editable}
              onMove={(nid, parentId, index) =>
                void edit(() => api.plan.moveNode(id, nid, parentId, index))
              }
            />
          </section>
          <section
            className="rounded-lg border border-border bg-surface p-5 shadow-sm"
            aria-label="Détail de la section"
          >
            {node ? (
              <NodeDetail
                node={node}
                hasChildren={children(node).length > 0}
                childWords={sum(node)}
                sources={plan.exploratory}
                editable={editable}
                canUp={pos > 0}
                canDown={pos >= 0 && pos < siblings.length - 1}
                onPatch={(p) => void edit(() => api.plan.updateNode(id, node.id, p))}
                onAddChild={() =>
                  void edit(() =>
                    api.plan.addNode(id, { parentId: node.id, title: 'Nouvelle section' }),
                  )
                }
                onAddSibling={() =>
                  void edit(() =>
                    api.plan.addNode(id, {
                      parentId: node.parentId,
                      index: pos + 1,
                      title: 'Nouvelle section',
                      level: node.level,
                    }),
                  )
                }
                onDelete={() => setConfirmDelete(true)}
                onShift={(d) =>
                  void edit(() => api.plan.moveNode(id, node.id, node.parentId, pos + d))
                }
              />
            ) : (
              <p className="t-small text-text-muted">Sélectionnez une section pour la consulter.</p>
            )}
          </section>
        </div>

        {plan.estimate && <EstimateCard estimate={plan.estimate} />}

        {editable && (
          <section className="space-y-4" aria-label="Validation">
            <Composer
              placeholder="Instructions supplémentaires pour l’agent (ex. : développer davantage le cadre théorique)"
              value={instructions}
              onChange={setComment}
              onSubmit={() => void regenerate()}
              loading={busy === 'regen'}
            />
            <p className="t-small flex items-center gap-2 text-text-muted">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              Après validation, l’agent travaille en autonomie. Vous pourrez suivre l’avancement et
              mettre en pause à tout moment.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                variant="secondary"
                size="lg"
                loading={busy === 'regen'}
                onClick={() => void regenerate()}
              >
                <WandSparkles className="size-4" />
                Demander une nouvelle version du plan
              </Button>
              <Button size="lg" loading={busy === 'validate'} onClick={() => void validate()}>
                <Rocket className="size-4" />
                Valider le plan et lancer la mission
              </Button>
            </div>
          </section>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette section ?"
        description={
          node ? `« ${node.title} » et ses sous-sections seront retirées du plan.` : undefined
        }
        confirmLabel="Supprimer"
        onConfirm={() => {
          if (!node) return;
          setConfirmDelete(false);
          void edit(() => api.plan.deleteNode(id, node.id));
        }}
      />
    </>
  );
}
