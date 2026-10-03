export type VerificationStatusUi = 'unverified' | 'verified' | 'partially_verified' | 'rejected';
export type FulltextStatusUi = 'none' | 'abstract_only' | 'fulltext';

/** Ligne du tableau « Sources » (CdC §6.7). */
export type SourceSummary = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  type: string;
  origin: string;
  doi: string | null;
  url: string | null;
  verificationStatus: VerificationStatusUi;
  /** Raison du rejet ou de l'avertissement, en français. */
  verificationNote: string | null;
  fulltextStatus: FulltextStatusUi;
  relevance: number | null;
  quality: number | null;
  /** Sections du plan qui s'appuient sur cette source. */
  sections: string[];
  usedInText: number;
};

export type ReadingNoteView = {
  sectionKey: string;
  these_principale: string;
  methode: string;
  resultats_cles: string[];
  citations: { texte: string; pageFrom: number | null; pageTo: number | null }[];
  limites: string[];
  pertinence: string;
  citationsEcartees: number;
};

/** Fiche détaillée d'une source : preuves de vérification, fiches de lecture. */
export type SourceDetail = SourceSummary & {
  abstract: string | null;
  journal: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  isbn: string | null;
  language: string | null;
  oaPdfUrl: string | null;
  evidence: Record<string, unknown> | null;
  notes: ReadingNoteView[];
  chunks: number;
};

export type ConnectorStatus = {
  id: string;
  label: string;
  enabled: boolean;
  ok: boolean | null;
  message: string | null;
  latencyMs: number | null;
};

export type ConnectorInfo = {
  id: string;
  label: string;
  enabled: boolean;
  needsKey: boolean;
  keyConfigured: boolean;
  keyMasked: string | null;
};

/** Réglages « Sources documentaires » (Paramètres). Les clés ne sont jamais renvoyées, seulement leur état. */
export type SourcesConfigInfo = { contactEmail: string; connectors: ConnectorInfo[] };

export type SectionResearchSummary = {
  sectionKey: string;
  iterations: number;
  found: number;
  merged: number;
  verified: number;
  rejected: { title: string; reasonFr: string }[];
  retained: number;
  notes: number;
  quotesDropped: number;
  byConnector: Record<string, number>;
  warnings: string[];
  coverageOk: boolean;
};
