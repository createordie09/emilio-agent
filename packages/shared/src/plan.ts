import type { MissionStatus } from './constants';

/** Plan de la mission (CdC §5.8, §6.5, §9 P2) et estimation du coût (§14.5). */
export const OUTLINE_LEVELS = ['partie', 'chapitre', 'section', 'sous_section'] as const;
export type OutlineLevel = (typeof OUTLINE_LEVELS)[number];

export const OUTLINE_LEVEL_LABEL_FR: Record<OutlineLevel, string> = {
  partie: 'Partie',
  chapitre: 'Chapitre',
  section: 'Section',
  sous_section: 'Sous-section',
};

/** `introduction` / `conclusion` : introduction et conclusion générales (non numérotées, rédigées en dernier, §9 P5). */
export const OUTLINE_KINDS = ['corps', 'introduction', 'conclusion'] as const;
export type OutlineKind = (typeof OUTLINE_KINDS)[number];

export type OutlineNodeView = {
  id: string;
  parentId: string | null;
  ordinal: number;
  level: OutlineLevel;
  kind: OutlineKind;
  numbering: string | null;
  title: string;
  objective: string;
  keyQuestions: string[];
  targetWords: number;
  requiredSourcesMin: number;
  /** Identifiants de sources (recherche exploratoire) pressenties pour cette section. */
  sourceIds: string[];
  /** Remarques de l'agent (risques, manque de littérature…). */
  remarks: string | null;
  /** Clé du gabarit de structure (§15.3) ; null pour un nœud ajouté. */
  templateKey: string | null;
};

export type CadrageView = {
  incoherences: { element: string; probleme: string; proposition: string }[];
  problematiques: { formulation: string; justification: string }[];
  concepts: { nom: string; a_definir: boolean }[];
  cadres_theoriques_pistes: string[];
  manques: string[];
  nbRequetes: number;
};

export type ExploratorySource = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  verificationStatus: 'unverified' | 'verified' | 'partially_verified' | 'rejected';
};

export type EstimateScenario = 'bas' | 'moyen' | 'haut';
export const ESTIMATE_SCENARIOS: readonly EstimateScenario[] = ['bas', 'moyen', 'haut'];
export const ESTIMATE_SCENARIO_LABEL_FR: Record<EstimateScenario, string> = {
  bas: 'Bas',
  moyen: 'Moyen',
  haut: 'Haut',
};

export type EstimatePhase = {
  phase: string;
  labelFr: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: Record<EstimateScenario, number>;
  durationSec: Record<EstimateScenario, number>;
};

export type CostEstimate = {
  scenarios: Record<EstimateScenario, { costUsd: number; durationSec: number }>;
  phases: EstimatePhase[];
  /** Déjà dépensé (planification) : s'ajoute aux scénarios. */
  spentUsd: number;
  budgetMaxUsd: number | null;
  exceedsBudget: Record<EstimateScenario, boolean>;
  /** Des modèles sans prix connu : le total est un minimum. */
  partial: boolean;
  missingPrice: string[];
  /** Mission simulée : prix d'exemple de la configuration, aucune dépense réelle. */
  simulated: boolean;
  sectionCount: number;
  targetWords: number;
  assumptions: string[];
  computedAt: string;
};

export type WordsSummary = {
  unit: 'pages' | 'mots';
  targetMin: number;
  targetMax: number;
  /** Mots prévus par le plan (hors liminaires, bibliographie, annexes). */
  planned: number;
  plannedPages: number;
  status: 'ok' | 'trop_court' | 'trop_long';
  chapters: { nodeId: string; label: string; words: number }[];
};

export type PlanOverview = {
  missionId: string;
  title: string;
  status: MissionStatus;
  /** Numéro de la version du plan (1 = première proposition). */
  version: number;
  versionsAdvisedMax: number;
  problematique: string | null;
  /** Formulation choisie parmi les propositions de l'agent (si la problématique était à proposer). */
  problematiqueChoisie: string | null;
  problematiqueAProposer: boolean;
  hypotheses: string[];
  methodologie: string;
  justification: string;
  risques: string[];
  cadrage: CadrageView | null;
  nodes: OutlineNodeView[];
  exploratory: ExploratorySource[];
  words: WordsSummary;
  instructions: string | null;
  estimate: CostEstimate | null;
  /** Avertissements affichés à l'écran de validation (structure, sections trop courtes, littérature rare…). */
  warnings: string[];
  liminaires: string[];
  simulated: boolean;
};

export type PlanNodePatch = Partial<
  Pick<
    OutlineNodeView,
    'title' | 'objective' | 'keyQuestions' | 'targetWords' | 'requiredSourcesMin'
  >
>;

export type PlanNodeInput = {
  parentId: string | null;
  /** Position parmi les frères (0 = en premier) ; absent = à la fin. */
  index?: number;
  title: string;
  level?: OutlineLevel;
};

export type PlanMetaPatch = {
  problematiqueChoisie?: string | null;
  instructions?: string | null;
};
