import type { AgentRole } from './constants';

/** Jury simulé (CdC §13) : évaluations, remarques, révisions et versions de sections. */
export type RemarkSeverity = 'majeure' | 'mineure' | 'suggestion';
export const SEVERITY_LABEL_FR: Record<RemarkSeverity, string> = {
  majeure: 'Majeure',
  mineure: 'Mineure',
  suggestion: 'Suggestion',
};

export type JuryVerdict = 'valide' | 'a_reviser' | 'a_reecrire';
export const VERDICT_LABEL_FR: Record<JuryVerdict, string> = {
  valide: 'Validé',
  a_reviser: 'À réviser',
  a_reecrire: 'À réécrire',
};

export type JuryRemarkView = {
  id: string;
  nodeId: string | null;
  location: string;
  problem: string;
  expected: string;
  severity: RemarkSeverity;
  needsResearch: boolean;
  query: string | null;
};

export type JurorEvaluationView = {
  role: AgentRole;
  roleLabel: string;
  scores: { id: string; label: string; note: number | null; max: number; justification: string }[];
  /** Total ramené sur 20 (calculé par le code sur les critères notés). */
  total: number;
  strengths: string[];
  remarks: JuryRemarkView[];
};

export type RevisionView = {
  nodeId: string;
  label: string;
  kind: 'revision' | 'harmonisation';
  fromVersion: number | null;
  toVersion: number | null;
  outcome: 'kept' | 'reverted';
  remarks: string[];
};

export type JuryRoundView = {
  round: number;
  total: number;
  verdict: JuryVerdict;
  criteria: { id: string; label: string; avg: number | null; max: number }[];
  jurors: JurorEvaluationView[];
  synthesis: string;
  crossJustification: string | null;
  /** Plan de révision priorisé du président. */
  plan: {
    nodeId: string;
    label: string;
    actions: string[];
    severity: RemarkSeverity;
    needsResearch: boolean;
  }[];
  /** Révisions menées APRÈS cette évaluation (réponse apportée aux remarques). */
  revisions: RevisionView[];
};

export type JuryScopeView = {
  scope: 'chapter' | 'global';
  targetId: string;
  title: string;
  threshold: number;
  maxRounds: number;
  rounds: JuryRoundView[];
  status: 'en_cours' | 'valide' | 'accepte_avec_reserves';
  finalScore: number | null;
  reasons: string[];
  /** Harmonisation (P7) : modifications ciblées appliquées avant l'évaluation globale. */
  harmonisation: RevisionView[];
};

export type SectionVersionSummary = {
  id: string;
  version: number;
  round: number;
  author: string | null;
  changeSummary: string | null;
  words: number;
  groundingRate: number | null;
  current: boolean;
  createdAt: string;
};
