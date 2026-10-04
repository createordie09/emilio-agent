/** Livrables (CdC §16) : fichiers produits, contrôle final et bibliographie. */
export type DeliverableKind = 'docx' | 'pdf' | 'pptx' | 'fiche' | 'rapport';

export const DELIVERABLE_LABEL_FR: Record<DeliverableKind, string> = {
  docx: 'Mémoire (Word)',
  pdf: 'Mémoire (PDF)',
  pptx: 'Diaporama de soutenance',
  fiche: 'Fiche de préparation à la soutenance',
  rapport: 'Rapport de mission',
};

export type DeliverableView = {
  id: string;
  kind: DeliverableKind;
  filename: string;
  sizeBytes: number;
  createdAt: string;
};

export type FinalCheckStatus = 'ok' | 'avertissement' | 'echec';

export type FinalCheckItem = {
  id: string;
  label: string;
  status: FinalCheckStatus;
  detail: string | null;
};

export type PlaceholderView = { section: string; text: string };

export type FinalCheckView = {
  at: string;
  /** Vrai si aucun contrôle n'est en échec (les avertissements restent à lire). */
  ok: boolean;
  items: FinalCheckItem[];
  /** Liste exhaustive des emplacements à compléter restant dans le document (§16.5). */
  placeholders: PlaceholderView[];
};

export type ExportOverview = {
  deliverables: DeliverableView[];
  /** Livrables demandés mais non produits, avec la raison (jamais silencieux). */
  skipped: { kind: DeliverableKind; reasonFr: string }[];
  finalCheck: FinalCheckView | null;
  bibliography: {
    styleLabel: string;
    cited: number;
    total: number;
    notes: boolean;
  } | null;
};
