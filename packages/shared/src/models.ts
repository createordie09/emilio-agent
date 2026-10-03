import { z } from 'zod';

/** Modèle OpenRouter normalisé (source : GET /api/v1/models, CdC §14.2). Prix en USD par jeton. */
export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number().nullable(),
  /** USD par jeton d'entrée ; null si inconnu (ex. tarification variable). */
  promptPrice: z.number().nullable(),
  completionPrice: z.number().nullable(),
  supportsStructuredOutputs: z.boolean(),
  supportsJsonMode: z.boolean(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export type ModelList = { models: ModelInfo[]; fetchedAt: string; fromCache: boolean };

/** Informations de clé (GET /api/v1/key). */
export type KeyInfo = {
  label: string | null;
  /** Plafond de la clé en USD ; null = illimité. */
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
  isFreeTier: boolean;
  /** Crédit de compte restant (total_credits − total_usage) si disponible. */
  accountCreditRemaining: number | null;
  checkedAt: string;
};

export type KeyStatus = { configured: boolean; masked: string | null };
