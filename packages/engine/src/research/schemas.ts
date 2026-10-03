import { z } from 'zod';

/** Schémas de sortie des agents de recherche (CdC §10.3.3, §10.3.4, §10.3.5). */
export const QueriesSchema = z.object({
  requetes: z.array(z.object({ texte: z.string().min(2), langue: z.enum(['fr', 'en']) })).min(1),
  manques: z.array(z.string()).default([]),
});

export const RankSchema = z.object({
  evaluations: z.array(
    z.object({
      id: z.string(),
      score: z.number().min(0).max(10),
      garder: z.boolean(),
      justification: z.string(),
    }),
  ),
  manques: z.array(z.string()).default([]),
});

export const ReadingNoteSchema = z.object({
  these_principale: z.string(),
  methode: z.string(),
  resultats_cles: z.array(z.string()).default([]),
  citations: z.array(z.object({ extrait: z.string(), texte: z.string() })).default([]),
  limites: z.array(z.string()).default([]),
  pertinence: z.string(),
  manques: z.array(z.string()).default([]),
});
export type ReadingNoteRaw = z.infer<typeof ReadingNoteSchema>;

export const ArbitrationSchema = z.object({
  meme_document: z.boolean(),
  justification: z.string(),
});
