import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRole } from '@emilio/shared';

export type JuryCriterion = { id: string; label: string; points: number; jurors: AgentRole[] };
export type JuryConfig = {
  criteria: JuryCriterion[];
  jurors: Record<string, { label: string; focus: string }>;
  thresholds: {
    section: number;
    chapter: number;
    global: Record<'standard' | 'eleve' | 'tres_eleve', number>;
  };
  verdictMargin: number;
  gainMinimal: number;
  spreadMax: number;
  maxResearchPerRound: number;
  revisionSeverities: string[];
  globalSample: { lowest: number; random: number };
  textCharsMax: number;
  harmonizerWordsMax: number;
};

/** Valeurs de repli si `resources/jury-config.json` est absent (le moteur doit démarrer) ; le fichier fait foi. */
export const DEFAULT_JURY_CONFIG: JuryConfig = {
  criteria: [
    {
      id: 'C1',
      label: 'Problématique, objectifs et hypothèses',
      points: 3,
      jurors: ['juror_methodologist'],
    },
    { id: 'C2', label: 'Revue de littérature', points: 3, jurors: ['juror_specialist'] },
    { id: 'C3', label: 'Concepts et cadre théorique', points: 2, jurors: ['juror_specialist'] },
    { id: 'C4', label: 'Rigueur méthodologique', points: 3, jurors: ['juror_methodologist'] },
    {
      id: 'C5',
      label: 'Analyse et interprétation des résultats',
      points: 3,
      jurors: ['juror_methodologist', 'juror_specialist'],
    },
    {
      id: 'C6',
      label: 'Discussion, apport, contextualisation',
      points: 2,
      jurors: ['juror_specialist'],
    },
    { id: 'C7', label: 'Structure, logique, enchaînements', points: 2, jurors: ['juror_form'] },
    { id: 'C8', label: 'Langue, style, typographie', points: 1, jurors: ['juror_form'] },
    { id: 'C9', label: 'Respect des normes', points: 1, jurors: ['juror_form'] },
  ],
  jurors: {
    juror_methodologist: { label: 'Méthodologiste', focus: 'cohérence et rigueur de la démarche.' },
    juror_specialist: { label: 'Spécialiste', focus: 'maîtrise du domaine et de la littérature.' },
    juror_form: { label: 'Forme', focus: 'structure, langue, normes.' },
  },
  thresholds: { section: 14, chapter: 14, global: { standard: 14, eleve: 15, tres_eleve: 16 } },
  verdictMargin: 3,
  gainMinimal: 0.5,
  spreadMax: 4,
  maxResearchPerRound: 2,
  revisionSeverities: ['majeure', 'mineure'],
  globalSample: { lowest: 3, random: 2 },
  textCharsMax: 60000,
  harmonizerWordsMax: 60,
};

export function loadJuryConfig(resourcesDir: string | undefined): JuryConfig {
  const path = resourcesDir ? join(resourcesDir, 'jury-config.json') : '';
  const f =
    path && existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Partial<JuryConfig>) : {};
  return { ...DEFAULT_JURY_CONFIG, ...f };
}
