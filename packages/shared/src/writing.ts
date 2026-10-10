/** Analyse des données de terrain (P4) et sections rédigées (P5) — CdC §9, §12. */

export type AnalysisTableView = {
  id: string;
  tableNumber: number;
  /** « Tableau 3 : … » */
  caption: string;
  /** « Source : enquête de terrain, mars 2026 » */
  source: string;
  headers: string[];
  rows: string[][];
  /** Phrases calculées par le code (chiffres exacts). */
  facts: string[];
  warnings: string[];
  hypothese: string | null;
  figure: { number: number; caption: string } | null;
};

export type HypothesisStatus = 'confirmee' | 'infirmee' | 'nuancee';
export const HYPOTHESIS_STATUS_LABEL_FR: Record<HypothesisStatus, string> = {
  confirmee: 'Confirmée',
  infirmee: 'Infirmée',
  nuancee: 'Nuancée',
};

export type FieldAnalysisView = {
  fileName: string;
  respondents: number;
  tables: AnalysisTableView[];
  interpretation: string;
  hypotheses: {
    hypothese: string;
    statut: HypothesisStatus;
    analyses: string[];
    justification: string;
    note: string | null;
  }[];
  limites: string[];
  warnings: string[];
  /** Phrases d'interprétation écartées parce qu'elles contenaient un nombre absent des résultats calculés (§12.3). */
  sentencesDropped: number;
};

export type SectionStatus = 'planned' | 'researching' | 'drafting' | 'in_review' | 'validated';

/** Bilan des contrôles d'intégrité d'une version de section (§12.1 à §12.4). */
export type SectionChecks = {
  wordsTarget: number;
  wordsActual: number;
  /** Rondes de correction ciblée effectuées (0 à 2). */
  rounds: number;
  claims: number;
  supported: number;
  partially: number;
  unsupported: number;
  /** Taux d'ancrage avant toute correction et après (§12.2). */
  groundingRateInitial: number | null;
  groundingRate: number | null;
  /** Phrases supprimées par le code parce qu'elles restaient non étayées, citaient une source non citable, avaient un chiffre orphelin, une citation inexacte ou recopiaient une source. */
  removed: { sentence: string; reasonFr: string }[];
  /** Points restants à surveiller (longueur, informations manquantes…). */
  warnings: string[];
  manques: string[];
};

export type SectionDraftSummary = {
  nodeId: string;
  numbering: string | null;
  title: string;
  kind: 'corps' | 'introduction' | 'conclusion';
  status: SectionStatus;
  version: number | null;
  words: number | null;
  wordsTarget: number;
  groundingRate: number | null;
  removed: number;
  warnings: number;
  /** Section remplacée par des emplacements « DONNÉES À INSÉRER » faute de données de terrain. */
  placeholder: boolean;
};

export type SectionClaimView = {
  sentence: string;
  sourceLabel: string | null;
  supportLevel: 'supported' | 'partially' | 'unsupported' | null;
  excerpt: string | null;
};

export type SectionDraftDetail = {
  nodeId: string;
  numbering: string | null;
  title: string;
  version: number;
  markdown: string;
  summary: string | null;
  wordCount: number;
  checks: SectionChecks | null;
  claims: SectionClaimView[];
  /** Libellés lisibles des sources citées, par identifiant (pour afficher « Adjovi et al., 2021 »). */
  sources: Record<string, string>;
};

export type FrontMatterView = {
  key: string;
  label: string;
  kind: 'genere' | 'a_completer';
  markdown: string;
};
