import type { AgentRole } from '@emilio/shared';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Schéma JSON attendu (sorties structurées). Absent = JSON libre validé côté code. */
  jsonSchema?: { name: string; schema: Record<string, unknown> } | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Métadonnées pour le client simulé et la journalisation ; ignorées par OpenRouter. */
  meta?: { role: AgentRole | 'local'; label?: string };
};

export type LlmResponse = {
  content: string;
  /** Modèle réellement servi (peut différer du modèle demandé). */
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Coût réel facturé (usage.cost) ; null si non fourni → calcul via la grille de prix. */
  costUsd: number | null;
  generationId: string | null;
  latencyMs: number;
};

/** Abstraction du fournisseur de modèles : OpenRouter réel ou client simulé (CdC §21.2). */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
