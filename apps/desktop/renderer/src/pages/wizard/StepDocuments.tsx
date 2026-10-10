import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck, FolderOpen } from 'lucide-react';
import {
  FILE_KINDS,
  FILE_KIND_LABEL_FR,
  needsFieldDataWarning,
  type DataProfile,
  type FileKind,
  type MissionFileInfo,
} from '@emilio/shared';
import { Button, Dropzone, Field, FileRow, Input, Select, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtInt } from '@/lib/fr';
import { useToasts } from '@/stores/toasts';
import { sub, type StepProps } from './types';

const KIND_HELP: Record<FileKind, string> = {
  user_document:
    'Cours, articles, ouvrages en PDF : intégrés à la base de connaissances, prioritaires.',
  field_data: 'Questionnaires dépouillés (CSV, XLSX) : analysés par du code, jamais inventés.',
  institution_guidelines:
    'Le guide de rédaction de votre établissement : ses règles seront extraites.',
  existing_work: 'Chapitres déjà rédigés à intégrer ou à améliorer.',
  template: 'Gabarit Word de l’établissement : ses styles serviront à l’export.',
};

const STATUS_UI: Record<
  MissionFileInfo['status'],
  { tone: 'neutral' | 'info' | 'primary' | 'success' | 'warning' | 'danger'; label: string }
> = {
  pending: { tone: 'neutral', label: 'En attente' },
  parsing: { tone: 'info', label: 'Lecture' },
  indexing: { tone: 'primary', label: 'Indexation' },
  done: { tone: 'success', label: 'Prêt' },
  warning: { tone: 'warning', label: 'À vérifier' },
  error: { tone: 'danger', label: 'Erreur' },
};

const fmtSize = (n: number) =>
  n > 1048576
    ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`
    : `${Math.max(1, Math.round(n / 1024))} Ko`;

function ProfileCard({ p }: { p: DataProfile }) {
  return (
    <details className="rounded-md border border-border bg-surface-muted p-3 t-small">
      <summary className="cursor-pointer font-medium">
        {fmtInt(p.respondents)} répondant(s) · {p.columns.length} variable(s)
        {p.columns.some((c) => c.identifying) && (
          <span className="ml-2 inline-flex items-center gap-1 text-success">
            <ShieldCheck className="size-4" aria-hidden />
            {p.columns.filter((c) => c.identifying).length} colonne(s) d’identification protégée(s)
          </span>
        )}
      </summary>
      <table className="mt-2 w-full">
        <thead className="text-left text-text-muted">
          <tr>
            <th className="py-1 font-medium">Variable</th>
            <th className="font-medium">Type</th>
            <th className="font-medium">Manquants</th>
          </tr>
        </thead>
        <tbody>
          {p.columns.map((c) => (
            <tr key={c.name} className="border-t border-border">
              <td className="py-1">{c.name}</td>
              <td>{c.identifying ? 'identification — exclue, jamais envoyée à l’IA' : c.type}</td>
              <td className="tabular">{c.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.warnings.map((w) => (
        <p key={w} className="mt-2 flex items-start gap-2 text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {w}
        </p>
      ))}
    </details>
  );
}

/** Étape 5 — Documents et données de terrain (CdC §6.4) ; traitement P0 en direct. */
export function StepDocuments({ brief, patch, draftId }: StepProps) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [kind, setKind] = React.useState<FileKind>('user_document');
  const { data } = useQuery({
    queryKey: ['draft', draftId],
    queryFn: async () => {
      const r = await api.drafts.get(draftId);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
  const files = data?.files ?? [];
  const col = brief.collecte ?? {};
  const fieldFiles = files.filter((f) => f.kind === 'field_data' && f.status !== 'error').length;

  const addPaths = async (paths: string[]) => {
    if (!paths.length) return;
    const r = await api.files.add(
      draftId,
      paths.map((path) => ({ path, kind })),
    );
    if (!r.ok)
      return push({ tone: 'danger', title: 'Import impossible', description: r.error.messageFr });
    for (const x of r.value)
      if (x.errorFr) push({ tone: 'danger', title: 'Fichier refusé', description: x.errorFr });
    void qc.invalidateQueries({ queryKey: ['draft', draftId] });
  };
  const pick = async () => {
    const r = await api.files.pick(kind);
    if (r.ok) await addPaths(r.value);
  };
  const remove = async (id: string) => {
    await api.files.remove(draftId, id);
    void qc.invalidateQueries({ queryKey: ['draft', draftId] });
  };

  return (
    <div className="space-y-6">
      <p
        role="note"
        className="t-small flex items-start gap-2 rounded-md bg-warning-soft p-3 text-text"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        L'agent n'invente jamais de données. Si votre travail nécessite une enquête de terrain,
        importez vos données ici. Sans données, le chapitre résultats sera limité à une analyse
        documentaire.
      </p>
      <Field label="Type de document à importer" hint={KIND_HELP[kind]}>
        <Select
          aria-label="Type de document à importer"
          value={kind}
          onChange={(e) => setKind(e.target.value as FileKind)}
          className="w-full"
        >
          {FILE_KINDS.map((k) => (
            <option key={k} value={k}>
              {FILE_KIND_LABEL_FR[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Dropzone
        title="Déposez vos fichiers ici"
        help="PDF, DOCX, TXT pour les documents ; CSV ou XLSX pour les données. Vos fichiers restent sur votre ordinateur."
        onFiles={(list) => void addPaths(api.files.pathsFor(Array.from(list)))}
      />
      <div className="flex justify-center">
        <Button variant="secondary" onClick={pick}>
          <FolderOpen className="size-4" />
          Parcourir mes fichiers…
        </Button>
      </div>

      {files.length > 0 && (
        <ul className="space-y-3" aria-label="Fichiers importés">
          {files.map((f) => (
            <li key={f.id} className="space-y-2">
              <FileRow
                name={f.filename}
                meta={`${FILE_KIND_LABEL_FR[f.kind]} · ${fmtSize(f.size)} · ${f.message ?? ''}`}
                progress={f.status === 'error' ? undefined : f.progress * 100}
                onRemove={() => void remove(f.id)}
              />
              <div className="flex items-center gap-2 pl-1">
                <StatusBadge tone={STATUS_UI[f.status].tone}>
                  {STATUS_UI[f.status].label}
                </StatusBadge>
              </div>
              {f.profile && <ProfileCard p={f.profile} />}
            </li>
          ))}
        </ul>
      )}

      {(fieldFiles > 0 || !needsFieldDataWarning(brief, 0)) && (
        <fieldset className="space-y-3">
          <legend className="t-h3">Méthode de collecte des données</legend>
          <p className="t-small text-text-muted">
            Ces informations alimentent le chapitre méthodologique.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Input
              aria-label="Taille de l'échantillon"
              placeholder="Taille de l'échantillon"
              value={col.echantillon ?? ''}
              onChange={(e) => patch(sub(brief, 'collecte', { echantillon: e.target.value }))}
            />
            <Input
              aria-label="Mode d'échantillonnage"
              placeholder="Mode d'échantillonnage"
              value={col.mode ?? ''}
              onChange={(e) => patch(sub(brief, 'collecte', { mode: e.target.value }))}
            />
            <Input
              aria-label="Période de collecte"
              placeholder="Période de collecte"
              value={col.periode ?? ''}
              onChange={(e) => patch(sub(brief, 'collecte', { periode: e.target.value }))}
            />
            <Input
              aria-label="Outil de collecte"
              placeholder="Outil (questionnaire, guide d'entretien…)"
              value={col.outil ?? ''}
              onChange={(e) => patch(sub(brief, 'collecte', { outil: e.target.value }))}
            />
          </div>
        </fieldset>
      )}
    </div>
  );
}
