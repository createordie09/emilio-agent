import type { AgentRole } from '@emilio/shared';

/**
 * Configuration d'exécution d'une mission (extrait de CdC §7.6 utile au moteur en J2).
 * Aucun identifiant de modèle ni budget n'est codé en dur : tout vient de la configuration de la mission.
 */
export type MissionExecConfig = {
  /** `mock` : client simulé (aucun appel payant) ; `real` : OpenRouter. */
  llmMode: 'mock' | 'real';
  models: Partial<Record<AgentRole, string>>;
  fallbackModels?: Partial<Record<AgentRole, string[]>>;
  budgetMaxUsd: number;
  /** Nombre d'agents simultanés (défaut 3, min 1, max 8 — §7.6). */
  parallelism: number;
  /** Coût estimé d'un appel pour le contrôle de budget avant appel (§14.4). */
  estimateCallUsd?: number;
  /** Seuils d'alerte budget déjà notifiés (50, 80, 95 %). */
  budgetAlertsSent?: number[];
};

export const clampParallelism = (n: number): number => Math.max(1, Math.min(8, Math.floor(n || 3)));
