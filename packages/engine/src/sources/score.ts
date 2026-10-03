import { readFileSync, existsSync } from 'node:fs';
import type { CandidateSource, SourceType } from './types';

export type QualityWeights = {
  weights: {
    type: number;
    identifiant: number;
    recence: number;
    citations: number;
    texteIntegral: number;
    revue: number;
  };
  bonus: { afrique: number; importUtilisateur: number };
  typeScores: Record<SourceType, number>;
  recence: { pleineValeurAns: number; valeurNulleAns: number };
  relevanceVsQuality: { relevance: number; quality: number };
};

/** Valeurs de repli si le fichier de configuration est absent ; le fichier `resources/quality-weights.json` fait foi. */
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  weights: {
    type: 0.3,
    identifiant: 0.15,
    recence: 0.15,
    citations: 0.15,
    texteIntegral: 0.1,
    revue: 0.15,
  },
  bonus: { afrique: 0.1, importUtilisateur: 0.3 },
  typeScores: {
    article: 0.85,
    ouvrage: 0.9,
    chapitre: 0.8,
    these: 0.9,
    memoire: 0.55,
    rapport: 0.6,
    texte_officiel: 0.65,
    site_web: 0.3,
    donnees: 0.4,
  },
  recence: { pleineValeurAns: 5, valeurNulleAns: 40 },
  relevanceVsQuality: { relevance: 0.6, quality: 0.4 },
};

export function loadQualityWeights(path?: string): QualityWeights {
  if (!path || !existsSync(path)) return DEFAULT_QUALITY_WEIGHTS;
  const f = JSON.parse(readFileSync(path, 'utf8')) as Partial<QualityWeights>;
  return {
    ...DEFAULT_QUALITY_WEIGHTS,
    ...f,
    weights: { ...DEFAULT_QUALITY_WEIGHTS.weights, ...f.weights },
    bonus: { ...DEFAULT_QUALITY_WEIGHTS.bonus, ...f.bonus },
    typeScores: { ...DEFAULT_QUALITY_WEIGHTS.typeScores, ...f.typeScores },
  };
}

export type ScoreContext = {
  now?: Date;
  /** `prioriteAfrique` (§7.6) : active le bonus pour les sources d'ancrage africain. */
  prioriteAfrique?: boolean;
  /** Source importée par l'utilisateur : bonus fort (§11.4). */
  userUpload?: boolean;
  /** Part de sources récentes visée (§7.6 `partMinSourcesRecentes`) : la récence compte alors davantage. */
  weightRecent?: boolean;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Score de qualité 0–1 (CdC §11.4) : type, identifiant, récence, citations (normalisées par l'âge), texte intégral, revue, bonus. */
export function qualityScore(
  c: CandidateSource,
  w: QualityWeights = DEFAULT_QUALITY_WEIGHTS,
  ctx: ScoreContext = {},
): number {
  const now = (ctx.now ?? new Date()).getFullYear();
  const age = c.year ? Math.max(0, now - c.year) : undefined;
  const rec =
    age === undefined
      ? 0.3
      : age <= w.recence.pleineValeurAns
        ? 1
        : clamp01(
            1 -
              (age - w.recence.pleineValeurAns) /
                (w.recence.valeurNulleAns - w.recence.pleineValeurAns),
          );
  const cites =
    c.citationCount === undefined
      ? 0
      : clamp01(Math.log10(1 + c.citationCount / ((age ?? 10) + 1)) / 1.5);
  const f = {
    type: w.typeScores[c.type] ?? 0.5,
    identifiant: c.doi || c.isbn ? 1 : c.url ? 0.3 : 0,
    recence: rec,
    citations: cites,
    texteIntegral: c.oaPdfUrl ? 1 : c.abstract ? 0.4 : 0,
    revue: c.peerReviewed ? 1 : 0,
  };
  const wRec = ctx.weightRecent ? 1.5 : 1;
  const sum =
    w.weights.type +
    w.weights.identifiant +
    w.weights.recence * wRec +
    w.weights.citations +
    w.weights.texteIntegral +
    w.weights.revue;
  let q =
    (w.weights.type * f.type +
      w.weights.identifiant * f.identifiant +
      w.weights.recence * wRec * f.recence +
      w.weights.citations * f.citations +
      w.weights.texteIntegral * f.texteIntegral +
      w.weights.revue * f.revue) /
    sum;
  if (ctx.prioriteAfrique && c.africa) q += w.bonus.afrique;
  if (ctx.userUpload) q += w.bonus.importUtilisateur;
  return clamp01(q);
}

/** Score final d'ordonnancement : relevance (0–1) et qualité (0–1) pondérées (§9 P3.3). */
export const combinedScore = (
  relevance: number,
  quality: number,
  w: QualityWeights = DEFAULT_QUALITY_WEIGHTS,
): number =>
  clamp01(w.relevanceVsQuality.relevance * relevance + w.relevanceVsQuality.quality * quality);

/** Lecture du fichier de pondérations — export pour les tests. */
export const _readWeightsFile = (p: string): string => readFileSync(p, 'utf8');
