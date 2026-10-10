import type { BriefDraft } from '@emilio/shared';

export type StepProps = {
  brief: BriefDraft;
  patch: (p: BriefDraft) => void;
  draftId: string;
  errors: string[];
};

/** Fusionne un sous-objet du brief (terrain, établissement…) sans écraser les autres champs. */
export function sub<
  K extends
    | 'terrain'
    | 'etablissement'
    | 'auteur'
    | 'collecte'
    | 'execution'
    | 'livrables'
    | 'mise_en_page',
>(brief: BriefDraft, key: K, value: Record<string, unknown>): BriefDraft {
  return { [key]: { ...(brief[key] as object | undefined), ...value } } as BriefDraft;
}

export const DISCIPLINES = [
  'Sciences de gestion',
  'Droit',
  'Économie',
  'Sociologie',
  'Santé publique',
  'Informatique',
  'Agronomie',
  'Sciences de l’éducation',
  'Communication',
  'Sciences politiques',
  'Histoire',
  'Géographie',
];
