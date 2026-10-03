import { z } from 'zod';

/** Sortie d'un juré (CdC §10.3.9). `total_sur_20` est lu mais jamais utilisé : le code recalcule le total sur les critères notés. */
export const JurorSchema = z.object({
  scores: z
    .array(
      z.object({
        critere_id: z.string(),
        note: z.number().nullable(),
        justification: z.string().default(''),
      }),
    )
    .default([]),
  total_sur_20: z.number().optional(),
  points_forts: z.array(z.string()).default([]),
  remarques: z
    .array(
      z.object({
        id: z.string().default(''),
        section_id: z.string().default(''),
        localisation: z.string().default(''),
        probleme: z.string().min(3),
        correction_attendue: z.string().default(''),
        gravite: z.enum(['majeure', 'mineure', 'suggestion']).default('mineure'),
        besoin_recherche: z.boolean().default(false),
        requete_suggeree: z.string().optional(),
      }),
    )
    .default([]),
});
export type JurorOutput = z.infer<typeof JurorSchema>;

/** Sortie du Président du jury (CdC §10.3.10) : synthèse et plan de révision priorisé, remarques fusionnées. */
export const PresidentSchema = z.object({
  synthese: z.string().default(''),
  plan: z
    .array(
      z.object({
        section_id: z.string(),
        actions: z.array(z.string()).min(1),
        priorite: z.enum(['majeure', 'mineure', 'suggestion']).default('mineure'),
        besoin_recherche: z.boolean().default(false),
        requete_suggeree: z.string().optional(),
      }),
    )
    .default([]),
});
export type PresidentOutput = z.infer<typeof PresidentSchema>;

/** Justification croisée demandée par le président quand les jurés divergent de plus de 4 points (§13.3). */
export const CrossSchema = z.object({ justification: z.string().min(1) });

/** Sortie de l'Harmonisateur (CdC §10.3.11) : modifications ciblées. */
export const HarmonizerSchema = z.object({
  modifications: z
    .array(
      z.object({
        section_id: z.string(),
        type: z.enum(['transition', 'repetition', 'terminologie', 'renvoi', 'fil_conducteur']),
        avant: z.string().optional(),
        apres: z.string().min(3),
        justification: z.string().default(''),
      }),
    )
    .default([]),
  manques: z.array(z.string()).default([]),
});
export type HarmonizerOutput = z.infer<typeof HarmonizerSchema>;
