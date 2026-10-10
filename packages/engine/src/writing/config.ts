import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Réglages de la rédaction (resources/writing-config.json), CdC §8.4, §9 P5, §12. */
export type WritingConfig = {
  /** Taux d'ancrage minimal avant correction ciblée (`tauxAncrageMin`, §12.2). */
  groundingMin: number;
  correctionRounds: number;
  lengthTolerance: number;
  maxQuoteWords: number;
  ngram: number;
  smallIntMax: number;
  extractsMaxTokens: number;
  extractsPerSource: number;
  maxSourcesPerSection: number;
  extractChars: number;
  claimExtractChars: number;
  groundingBatch: number;
  missionContextMaxChars: number;
  summariesMaxChars: number;
  summaryWords: { min: number; max: number };
  register: string;
  person: string;
  resultsPattern: string;
  charsPerToken: number;
  contextShare: number;
  fixedPromptTokens: number;
};

export const DEFAULT_WRITING_CONFIG: WritingConfig = {
  groundingMin: 0.95,
  correctionRounds: 2,
  lengthTolerance: 0.1,
  maxQuoteWords: 40,
  ngram: 8,
  smallIntMax: 10,
  extractsMaxTokens: 12000,
  extractsPerSource: 3,
  maxSourcesPerSection: 8,
  extractChars: 1800,
  claimExtractChars: 1200,
  groundingBatch: 15,
  missionContextMaxChars: 5200,
  summariesMaxChars: 4000,
  summaryWords: { min: 150, max: 250 },
  register: 'académique, impersonnel',
  person: 'troisième personne ou « nous » de modestie',
  resultsPattern: 'résultat|analyse|discussion|hypoth|terrain|enquête|données|vérification',
  charsPerToken: 3.5,
  contextShare: 0.7,
  fixedPromptTokens: 6000,
};

export function loadWritingConfig(resourcesDir: string | undefined): WritingConfig {
  const path = resourcesDir ? join(resourcesDir, 'writing-config.json') : '';
  const f =
    path && existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as Partial<WritingConfig>)
      : {};
  return { ...DEFAULT_WRITING_CONFIG, ...f };
}
