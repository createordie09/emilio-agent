import * as React from 'react';
import { ArrowDown, ArrowUp, FolderPlus, Plus, Trash2 } from 'lucide-react';
import type { ExploratorySource, OutlineNodeView, PlanNodePatch } from '@emilio/shared';
import { Button, Field, Input, ListEditor, StatusBadge, Textarea } from '@/components/ui';
import { fmtInt } from '@/lib/fr';

const VERIF = {
  verified: { tone: 'success', label: 'Vérifiée' },
  partially_verified: { tone: 'info', label: 'Partiellement vérifiée' },
  unverified: { tone: 'neutral', label: 'Non vérifiée' },
  rejected: { tone: 'danger', label: 'Rejetée' },
} as const;

/** Panneau droit : détail et édition de la section sélectionnée (§6.5). Enregistrement à la sortie du champ. */
export function NodeDetail({
  node,
  hasChildren,
  childWords,
  sources,
  editable,
  canUp,
  canDown,
  onPatch,
  onAddChild,
  onAddSibling,
  onDelete,
  onShift,
}: {
  node: OutlineNodeView;
  hasChildren: boolean;
  childWords: number;
  sources: ExploratorySource[];
  editable: boolean;
  canUp: boolean;
  canDown: boolean;
  onPatch: (p: PlanNodePatch) => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onDelete: () => void;
  onShift: (dir: -1 | 1) => void;
}) {
  const [title, setTitle] = React.useState(node.title);
  const [objective, setObjective] = React.useState(node.objective);
  const [words, setWords] = React.useState(String(node.targetWords));
  const [minSources, setMinSources] = React.useState(String(node.requiredSourcesMin));
  React.useEffect(() => {
    setTitle(node.title);
    setObjective(node.objective);
    setWords(String(node.targetWords));
    setMinSources(String(node.requiredSourcesMin));
  }, [node.id, node.title, node.objective, node.targetWords, node.requiredSourcesMin]);

  const known = new Map(sources.map((s) => [s.id, s]));
  const pressenties = node.sourceIds.flatMap((id) => (known.get(id) ? [known.get(id)!] : []));
  const intro = node.kind !== 'corps';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <>
            <Button variant="secondary" size="sm" onClick={onAddChild} disabled={intro}>
              <FolderPlus className="size-4" />
              Ajouter une sous-section
            </Button>
            <Button variant="secondary" size="sm" onClick={onAddSibling}>
              <Plus className="size-4" />
              Ajouter à la suite
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Monter"
              disabled={!canUp}
              onClick={() => onShift(-1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Descendre"
              disabled={!canDown}
              onClick={() => onShift(1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="size-4" />
              Supprimer
            </Button>
          </>
        )}
      </div>

      <Field label="Titre" htmlFor="plan-titre">
        <Input
          id="plan-titre"
          value={title}
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== node.title && onPatch({ title })}
        />
      </Field>
      <Field label="Objectif de la section" htmlFor="plan-objectif">
        <Textarea
          id="plan-objectif"
          rows={3}
          value={objective}
          disabled={!editable}
          onChange={(e) => setObjective(e.target.value)}
          onBlur={() => objective !== node.objective && onPatch({ objective })}
        />
      </Field>
      <Field label="Questions clés" hint="Elles guident la recherche de sources et la rédaction.">
        {editable ? (
          <ListEditor
            label="Question clé"
            placeholder="Ajouter une question puis Entrée"
            items={node.keyQuestions}
            onChange={(keyQuestions) => onPatch({ keyQuestions })}
          />
        ) : (
          <ul className="t-body list-disc space-y-1 pl-5">
            {node.keyQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Nombre de mots visé"
          htmlFor="plan-mots"
          hint={hasChildren ? 'Somme des sous-sections (à modifier dans chacune).' : undefined}
        >
          <Input
            id="plan-mots"
            type="number"
            min={0}
            step={50}
            value={hasChildren ? String(childWords) : words}
            disabled={!editable || hasChildren}
            onChange={(e) => setWords(e.target.value)}
            onBlur={() => {
              const n = Number(words);
              if (!hasChildren && Number.isFinite(n) && n !== node.targetWords)
                onPatch({ targetWords: n });
            }}
          />
        </Field>
        <Field label="Sources vérifiées minimales" htmlFor="plan-src">
          <Input
            id="plan-src"
            type="number"
            min={0}
            value={minSources}
            disabled={!editable || hasChildren || intro}
            onChange={(e) => setMinSources(e.target.value)}
            onBlur={() => {
              const n = Number(minSources);
              if (Number.isFinite(n) && n !== node.requiredSourcesMin)
                onPatch({ requiredSourcesMin: n });
            }}
          />
        </Field>
      </div>

      <section className="space-y-2">
        <h3 className="t-h3">Sources pressenties</h3>
        {pressenties.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {pressenties.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="t-small truncate font-medium">{s.title}</p>
                  <p className="t-caption text-text-muted">
                    {s.authors[0] ?? 'Auteur inconnu'}
                    {s.authors.length > 1 ? ' et al.' : ''} · {s.year ?? 's.d.'}
                  </p>
                </div>
                <StatusBadge tone={VERIF[s.verificationStatus].tone}>
                  {VERIF[s.verificationStatus].label}
                </StatusBadge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-small text-text-muted">
            {intro
              ? 'Cette partie s’appuie sur les sources de l’ensemble du travail.'
              : 'Aucune source pressentie à ce stade : la recherche approfondie en cherchera.'}
          </p>
        )}
      </section>

      {node.remarks && (
        <p className="t-small rounded-md bg-warning-soft p-3 text-warning">
          <span className="font-medium">Remarque de l’agent : </span>
          {node.remarks}
        </p>
      )}
      <p className="t-caption text-text-subtle">
        {fmtInt(hasChildren ? childWords : node.targetWords)} mots visés pour cette section.
      </p>
    </div>
  );
}
