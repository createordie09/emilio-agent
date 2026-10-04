import { z } from 'zod';

const str = z.string().trim();

export const SlideSchema = z.object({
  type: str.min(1),
  titre: str.min(1),
  puces: z.array(str.min(1)).default([]),
  notes: str.default(''),
});
export const DeckSchema = z.object({
  diapositives: z.array(SlideSchema).min(3),
  manques: z.array(str).default([]),
});
export type Deck = z.infer<typeof DeckSchema>;

export const QuestionSchema = z.object({
  question: str.min(5),
  reponse: str.min(5),
  renvoi: str.default(''),
  origine: z
    .enum(['remarque_jury', 'faiblesse', 'methode', 'resultats', 'theorie', 'general'])
    .catch('general'),
});
export const QuestionsSchema = z.object({
  questions: z.array(QuestionSchema).min(3),
  manques: z.array(str).default([]),
});
export type Questions = z.infer<typeof QuestionsSchema>;
