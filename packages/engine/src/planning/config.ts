import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutlineKind, OutlineLevel, WorkType } from '@emilio/shared';

/** Réglages de planification (resources/plan-config.json). Valeurs par défaut prudentes si le fichier est absent. */
export type PlanConfig = {
  wordsPerPage: number;
  /** Part du document consacrée au corps du texte (le reste : liminaires, bibliographie, annexes). */
  bodyShare: number;
  minSectionWords: number;
  wordTolerance: number;
  defaultMinSourcesPerSection: number;
  versionsAdvisedMax: number;
  exploration: Record<'rapide' | 'normale' | 'approfondie', number>;
  explorationQueriesMax: number;
  explorationPerQuery: number;
  architectSources: number;
  abstractChars: number;
};

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  wordsPerPage: 350,
  bodyShare: 0.85,
  minSectionWords: 400,
  wordTolerance: 0.1,
  defaultMinSourcesPerSection: 3,
  versionsAdvisedMax: 5,
  exploration: { rapide: 30, normale: 45, approfondie: 60 },
  explorationQueriesMax: 8,
  explorationPerQuery: 15,
  architectSources: 40,
  abstractChars: 300,
};

export type StructureNode = {
  key: string;
  level: OutlineLevel;
  kind: OutlineKind;
  title: string;
  /** Poids relatif de mots (normalisé par le code). */
  share?: number;
  children?: StructureNode[];
};

/** Gabarit de structure (CdC §15.3) : `resources/norms/structures/*.json`. */
export type StructureTemplate = {
  id: string;
  label: string;
  workTypes: WorkType[];
  allowExtraChapters: boolean;
  nodes: StructureNode[];
};

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadPlanConfig(resourcesDir: string | undefined): PlanConfig {
  const f = resourcesDir
    ? readJson<Partial<PlanConfig>>(join(resourcesDir, 'plan-config.json'))
    : null;
  return { ...DEFAULT_PLAN_CONFIG, ...f };
}

/** Fichier absent : aucun gabarit (le moteur démarre, le plan est alors libre) ; corrompu : erreur explicite. */
export function loadStructures(resourcesDir: string | undefined): StructureTemplate[] {
  if (!resourcesDir) return [];
  const dir = join(resourcesDir, 'norms', 'structures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as StructureTemplate);
}

export const structureFor = (
  all: StructureTemplate[],
  workType: WorkType,
): StructureTemplate | undefined => all.find((t) => t.workTypes.includes(workType));

/** Coefficients d'estimation (resources/estimation.json), CdC §14.5. */
export type EstimationConfig = {
  simulatedPrice: { promptPerMTokUsd: number; completionPerMTokUsd: number };
  tokensPerWord: number;
  defaultTokensPerSecond: number;
  callOverheadSec: number;
  measuredSpeedMinCalls: number;
  research: {
    depthCalls: Record<'rapide' | 'normale' | 'approfondie', number>;
    tokensIn: number;
    tokensOut: number;
    verifierShare: number;
  };
  reading: {
    notesPerSection: Record<'rapide' | 'normale' | 'approfondie', number>;
    tokensIn: number;
    tokensOut: number;
  };
  dataAnalysis: {
    callsBase: number;
    callsPerHypothesis: number;
    tokensIn: number;
    tokensOut: number;
  };
  writing: { inputPerOutputToken: number; minInputTokens: number };
  grounding: { wordsPerClaim: number; claimsPerCall: number; tokensIn: number; tokensOut: number };
  summaries: { tokensInPerSection: number; tokensOut: number };
  jury: {
    jurors: number;
    chapterInputRatio: number;
    tokensOut: number;
    presidentTokensOut: number;
  };
  revision: {
    shareOfSections: Record<'bas' | 'moyen' | 'haut', number>;
    inputPerOutputToken: number;
  };
  global: {
    summaryTokensPerSection: number;
    tokensOut: number;
    roundsExpected: Record<'bas' | 'moyen', number>;
  };
  finishing: {
    biblioTokensIn: number;
    biblioTokensOut: number;
    defenseTokensIn: number;
    defenseTokensOutPerSlide: number;
  };
  parallelPhases: string[];
};

export const DEFAULT_ESTIMATION: EstimationConfig = {
  simulatedPrice: { promptPerMTokUsd: 3, completionPerMTokUsd: 15 },
  tokensPerWord: 1.3,
  defaultTokensPerSecond: 45,
  callOverheadSec: 4,
  measuredSpeedMinCalls: 5,
  research: {
    depthCalls: { rapide: 3, normale: 5, approfondie: 8 },
    tokensIn: 2200,
    tokensOut: 600,
    verifierShare: 0.25,
  },
  reading: {
    notesPerSection: { rapide: 3, normale: 6, approfondie: 12 },
    tokensIn: 3800,
    tokensOut: 800,
  },
  dataAnalysis: { callsBase: 2, callsPerHypothesis: 1, tokensIn: 5000, tokensOut: 1800 },
  writing: { inputPerOutputToken: 3.5, minInputTokens: 6000 },
  grounding: { wordsPerClaim: 30, claimsPerCall: 10, tokensIn: 2600, tokensOut: 500 },
  summaries: { tokensInPerSection: 1800, tokensOut: 400 },
  jury: { jurors: 3, chapterInputRatio: 1.15, tokensOut: 1400, presidentTokensOut: 1800 },
  revision: { shareOfSections: { bas: 0.2, moyen: 0.45, haut: 0.8 }, inputPerOutputToken: 4 },
  global: { summaryTokensPerSection: 500, tokensOut: 1600, roundsExpected: { bas: 0, moyen: 1 } },
  finishing: {
    biblioTokensIn: 6000,
    biblioTokensOut: 1500,
    defenseTokensIn: 9000,
    defenseTokensOutPerSlide: 350,
  },
  parallelPhases: ['P3', 'P5', 'P6'],
};

export function loadEstimation(resourcesDir: string | undefined): EstimationConfig {
  const f = resourcesDir
    ? readJson<Partial<EstimationConfig>>(join(resourcesDir, 'estimation.json'))
    : null;
  return { ...DEFAULT_ESTIMATION, ...f };
}
