import { AlertTriangle, Clock } from 'lucide-react';
import {
  FILE_KIND_LABEL_FR,
  WORK_TYPE_LABEL_FR,
  needsFieldDataWarning,
  type MissionFileInfo,
} from '@emilio/shared';
import { Checkbox, StatusBadge } from '@/components/ui';
import { fmtUsd } from '@/lib/fr';
import type { StepProps } from './types';

const APPROCHE: Record<string, string> = {
  quantitative: 'Quantitative',
  qualitative: 'Qualitative',
  mixte: 'Mixte',
  documentaire: 'Documentaire',
  a_proposer: 'À proposer par l’agent',
};
const EXIG: Record<string, string> = {
  standard: 'Standard',
  eleve: 'Élevé',
  tres_eleve: 'Très élevé',
};

const Block = ({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) => (
  <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
    <h3 className="t-h3">{title}</h3>
    <dl className="space-y-1.5">
      {rows
        .filter(([, v]) => v !== undefined && v !== '' && v !== null)
        .map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 t-small">
            <dt className="shrink-0 text-text-muted">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
    </dl>
  </section>
);

/** Étape 7 — Récapitulatif et confirmation (CdC §6.4, §7.3). */
export function StepSummary({
  brief,
  files,
  confirmed,
  onConfirm,
}: StepProps & { files: MissionFileInfo[]; confirmed: boolean; onConfirm: (c: boolean) => void }) {
  const fieldFiles = files.filter((f) => f.kind === 'field_data' && f.status !== 'error').length;
  const warn = needsFieldDataWarning(brief, fieldFiles);
  const l = brief.longueur;
  const ex = brief.execution;
  const liv = brief.livrables;
  const deliverables = [
    liv?.docx && 'Word',
    liv?.pdf && 'PDF',
    liv?.pptx && `Diaporama (${liv.nbDiapos ?? 15})`,
    liv?.fichePreparation && 'Fiche de soutenance',
    liv?.rapportMission && 'Rapport de mission',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="space-y-4">
      <Block
        title="Travail"
        rows={[
          ['Type', brief.workType ? WORK_TYPE_LABEL_FR[brief.workType] : ''],
          ['Exigence', EXIG[brief.exigence ?? 'standard']],
          ['Discipline', [brief.discipline, brief.specialite].filter(Boolean).join(' — ')],
          [
            'Établissement',
            [brief.etablissement?.nom, brief.etablissement?.faculte].filter(Boolean).join(', '),
          ],
        ]}
      />
      <Block
        title="Sujet"
        rows={[
          ['Titre', brief.titre],
          [
            'Problématique',
            brief.problematiqueAProposer
              ? 'À formuler avec l’aide de l’agent'
              : brief.problematique,
          ],
          ['Questions de recherche', brief.questionsRecherche?.length || ''],
          ['Hypothèses', brief.hypotheses?.length || ''],
          ['Approche', APPROCHE[brief.approche ?? 'a_proposer']],
          ['Mots-clés', brief.motsCles?.join(', ')],
        ]}
      />
      <Block
        title="Format"
        rows={[
          ['Longueur', l ? `${l.min} à ${l.max} ${l.unite}` : ''],
          ['Citations', brief.styleCitation === 'notes' ? 'Notes de bas de page' : 'Auteur-date'],
          ['Livrables', deliverables],
        ]}
      />
      <Block
        title="Documents"
        rows={
          files.length
            ? files.map((f): [string, React.ReactNode] => [
                f.filename,
                <span key={f.id} className="inline-flex items-center gap-2">
                  {FILE_KIND_LABEL_FR[f.kind]}
                  <StatusBadge
                    tone={
                      f.status === 'error'
                        ? 'danger'
                        : f.status === 'warning'
                          ? 'warning'
                          : 'success'
                    }
                  >
                    {f.status === 'error'
                      ? 'Erreur'
                      : f.status === 'warning'
                        ? 'À vérifier'
                        : 'Prêt'}
                  </StatusBadge>
                </span>,
              ])
            : [['Aucun fichier', '']]
        }
      />
      <Block
        title="Exécution"
        rows={[
          ['Préréglage', ex?.preset ?? ''],
          ['Budget maximal', ex?.budgetMaxUsd ? fmtUsd(ex.budgetMaxUsd) : ''],
          ['Agents en parallèle', ex?.parallelism],
          [
            'Rondes de révision',
            ex ? `${ex.rondesMaxParChapitre} par chapitre, ${ex.rondesMaxGlobales} globales` : '',
          ],
        ]}
      />
      <p className="t-small flex items-start gap-2 rounded-md bg-primary-softer p-3 text-text-muted">
        <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
        L'estimation détaillée du coût et de la durée vous sera présentée avec le plan proposé,
        avant tout lancement de la recherche. Votre budget maximal sert de plafond.
      </p>
      {warn && (
        <div
          role="alert"
          className="space-y-3 rounded-lg border-2 border-warning bg-warning-soft p-4"
        >
          <p className="t-h3 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            Aucune donnée de terrain importée
          </p>
          <p className="t-small">
            Votre approche est empirique, mais aucune donnée n'a été fournie. Le chapitre résultats
            sera remplacé par des emplacements « DONNÉES À INSÉRER » et une trame d'analyse :
            l'agent n'invente jamais de données.
          </p>
          <Checkbox
            checked={confirmed}
            onCheckedChange={onConfirm}
            label="Je comprends et je souhaite continuer sans données de terrain"
          />
        </div>
      )}
    </div>
  );
}
