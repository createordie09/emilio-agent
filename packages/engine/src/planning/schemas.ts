import { z } from 'zod';
import { OUTLINE_LEVELS } from '@emilio/shared';

/** Sortie de l'Orchestrateur en mode cadrage (CdC §10.3.1, P1). */
export const CadrageSchema = z.object({
  incoherences: z
    .array(z.object({ element: z.string(), probleme: z.string(), proposition: z.string() }))
    .default([]),
  problematiques: z
    .array(z.object({ formulation: z.string().min(5), justification: z.string() }))
    .default([]),
  concepts: z
    .array(z.object({ nom: z.string().min(2), a_definir: z.boolean().default(true) }))
    .default([]),
  cadres_theoriques_pistes: z.array(z.string()).default([]),
  requetes: z
    .array(
      z.object({
        concept: z.string(),
        fr: z.array(z.string()).default([]),
        en: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  manques: z.array(z.string()).default([]),
});
export type Cadrage = z.infer<typeof CadrageSchema>;

/**
 * Sortie de l'Architecte du plan (CdC §10.3.2, P2). Liste PLATE (ordre de lecture) avec renvoi au parent :
 * les schémas récursifs sont mal acceptés par les sorties structurées de plusieurs modèles.
 */
export const PlanNodeSchema = z.object({
  ref: z.string().min(1),
  parent: z.string().nullable().default(null),
  cle: z.string().optional(),
  niveau: z.enum(OUTLINE_LEVELS).optional(),
  titre: z.string().min(2),
  objectif: z.string().default(''),
  questions_cles: z.array(z.string()).default([]),
  mots_cibles: z.number().min(0).default(0),
  sources: z.array(z.string()).default([]),
  remarques: z.string().optional(),
});

export const PlanSchema = z.object({
  noeuds: z.array(PlanNodeSchema).min(1),
  justification_globale: z.string().default(''),
  methodologie: z.string().default(''),
  hypotheses: z.array(z.string()).default([]),
  risques: z.array(z.string()).default([]),
  manques: z.array(z.string()).default([]),
});
export type PlanOutput = z.infer<typeof PlanSchema>;
