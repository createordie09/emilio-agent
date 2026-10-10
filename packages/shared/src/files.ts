/** Types d'import de l'étape 5 (CdC §6.4) ↔ colonne `kind` de `mission_files` (§5.3). */
export const FILE_KINDS = [
  'user_document',
  'field_data',
  'institution_guidelines',
  'existing_work',
  'template',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABEL_FR: Record<FileKind, string> = {
  user_document: 'Document de référence',
  field_data: 'Données de terrain',
  institution_guidelines: "Guide de rédaction de l'établissement",
  existing_work: 'Travail déjà rédigé',
  template: "Gabarit Word de l'établissement",
};

export type FileStatus = 'pending' | 'parsing' | 'indexing' | 'done' | 'warning' | 'error';

export type ColumnProfile = {
  name: string;
  type: 'integer' | 'number' | 'boolean' | 'date' | 'categorical' | 'text';
  nonMissing: number;
  missing: number;
  distinct: number;
  /** Modalités et effectifs pour une variable catégorielle (20 max). */
  modalities?: { value: string; count: number }[];
  /** Statistiques calculées par du code (jamais par un modèle, CdC §17). */
  numeric?: { min: number; max: number; mean: number; median: number; sd: number };
};

/** Profil des données de terrain (CdC §9 P0.4). */
export type DataProfile = {
  sheet?: string;
  respondents: number;
  columns: ColumnProfile[];
  sample: Record<string, string>[];
  warnings: string[];
};

export type MissionFileInfo = {
  id: string;
  kind: FileKind;
  filename: string;
  size: number;
  mime: string | null;
  status: FileStatus;
  /** 0 à 1 pendant le traitement. */
  progress: number;
  message: string | null;
  chunks: number;
  pages: number | null;
  profile: DataProfile | null;
};
