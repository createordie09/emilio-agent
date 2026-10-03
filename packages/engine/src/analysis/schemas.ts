import { z } from 'zod';

export const ANALYSIS_TYPES = [
  'frequencies',
  'describe',
  'crosstab',
  'correlation',
  'group_means',
] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

/** Sortie de l'Analyste de données, sous-tâche `plan_analyses` (CdC §10.3.6) : liste d'analyses exécutables par le module statistique. */
export const AnalysisPlanSchema = z.object({
  analyses: z
    .array(
      z.object({
        type: z.enum(ANALYSIS_TYPES),
        variables: z.array(z.string()).min(1).max(2),
        hypothese: z.string().optional(),
        justification: z.string().default(''),
      }),
    )
    .default([]),
  manques: z.array(z.string()).default([]),
});
export type AnalysisPlan = z.infer<typeof AnalysisPlanSchema>;

/** Sortie de l'Analyste de données, sous-tâche `interpret_results`. */
export const InterpretationSchema = z.object({
  interpretation: z.string().min(1),
  hypotheses: z
    .array(
      z.object({
        hypothese: z.string(),
        statut: z.enum(['confirmee', 'infirmee', 'nuancee']),
        analyses: z.array(z.string()).default([]),
        justification: z.string().default(''),
      }),
    )
    .default([]),
  limites: z.array(z.string()).default([]),
  manques: z.array(z.string()).default([]),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;
