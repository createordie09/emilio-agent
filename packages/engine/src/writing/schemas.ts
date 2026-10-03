import { z } from 'zod';

/** Sortie du Rédacteur de section (CdC §10.3.7). Les identifiants `A…` (sources) et `E…` (extraits) sont des alias attribués par le code. */
export const WriterOutputSchema = z.object({
  markdown: z.string().min(1),
  claims: z
    .array(
      z.object({
        phrase: z.string(),
        source_id: z.string(),
        chunk_id: z.string().optional(),
        page: z.string().optional(),
      }),
    )
    .default([]),
  mots: z.number().default(0),
  manques: z.array(z.string()).default([]),
  notes_pour_jury: z.string().optional(),
});
export type WriterOutput = z.infer<typeof WriterOutputSchema>;

/** Sortie du Vérificateur d'ancrage (CdC §10.3.8) : un verdict par affirmation, par lots. */
export const GroundingSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      niveau: z.enum(['supported', 'partially', 'unsupported']),
      justification: z.string().default(''),
    }),
  ),
});
export type GroundingOutput = z.infer<typeof GroundingSchema>;

/** Sortie du Résumeur : résumé de section (150 à 250 mots, §8.4) ou page liminaire. */
export const SummarySchema = z.object({
  resume: z.string().min(1),
  mots_cles: z.array(z.string()).default([]),
  manques: z.array(z.string()).default([]),
});
export type SummaryOutput = z.infer<typeof SummarySchema>;
