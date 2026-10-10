import { describe, it, expect } from 'vitest';
import {
  BriefSchema,
  defaultBrief,
  validateStep,
  needsFieldDataWarning,
  WORK_TYPES,
} from '@emilio/shared';

describe('brief (§7.1) et validation par étape (§6.4)', () => {
  it('chaque type de travail a un brief par défaut cohérent', () => {
    for (const t of WORK_TYPES) {
      const b = defaultBrief(t);
      expect(b.longueur!.max).toBeGreaterThanOrEqual(b.longueur!.min);
      expect(b.livrables!.docx).toBe(true);
    }
  });

  it('étape 2 : titre et problématique (ou aide de l’agent) obligatoires', () => {
    expect(validateStep(1, {})).toHaveLength(2);
    expect(validateStep(1, { titre: 'Microfinance', problematique: 'Quelle ?' })).toEqual([]);
    expect(validateStep(1, { titre: 'Microfinance', problematiqueAProposer: true })).toEqual([]);
    expect(validateStep(1, { titre: 'ab', problematiqueAProposer: true })).toHaveLength(1);
  });

  it('autres étapes : discipline, longueur, livrables, budget', () => {
    expect(validateStep(0, { workType: 'memoire_master' })).toEqual(['Indiquez la discipline.']);
    expect(validateStep(2, { longueur: { unite: 'pages', min: 50, max: 20 } })[0]).toMatch(
      /longueur valide/,
    );
    expect(
      validateStep(3, {
        livrables: {
          docx: false,
          pdf: false,
          pptx: false,
          fichePreparation: true,
          rapportMission: true,
        },
      })[0],
    ).toMatch(/au moins un livrable/);
    expect(validateStep(5, {})[0]).toMatch(/budget/i);
    expect(
      validateStep(5, {
        execution: {
          parallelism: 3,
          rondesMaxParChapitre: 3,
          rondesMaxGlobales: 2,
          profondeurRecherche: 'normale',
          preferenceSources: 'toutes',
          budgetMaxUsd: 10,
        },
      }),
    ).toEqual([]);
  });

  it('BriefSchema refuse 11 mots-clés et accepte un brief complet', () => {
    const ok = { ...defaultBrief(), discipline: 'Droit', titre: 'Titre valide' };
    expect(BriefSchema.safeParse(ok).success).toBe(true);
    expect(
      BriefSchema.safeParse({ ...ok, motsCles: Array.from({ length: 11 }, (_, i) => `m${i}`) })
        .success,
    ).toBe(false);
  });

  it('avertissement §7.3 : approche empirique sans données de terrain', () => {
    expect(needsFieldDataWarning({ approche: 'quantitative' }, 0)).toBe(true);
    expect(needsFieldDataWarning({ approche: 'qualitative' }, 0)).toBe(true);
    expect(needsFieldDataWarning({ approche: 'mixte' }, 1)).toBe(false);
    expect(needsFieldDataWarning({ approche: 'documentaire' }, 0)).toBe(false);
    expect(needsFieldDataWarning({ approche: 'a_proposer' }, 0)).toBe(false);
  });
});
