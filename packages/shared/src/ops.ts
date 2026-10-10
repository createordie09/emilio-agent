/** Exploitation (CdC J9) : préférences, coûts, journal technique, archives de mission. */
export type AppPrefs = {
  /** Reprise automatique des missions (au démarrage, crédit rechargé, réseau revenu) — §8.6. */
  autoResumeMissions: boolean;
  /** Notifications système (plan prêt, mission terminée, pause, erreur) — §6.9. */
  notifications: boolean;
  /** Empêche la mise en veille de l'ordinateur pendant qu'une mission s'exécute. */
  preventSleep: boolean;
  /** N'utiliser que des fournisseurs qui ne conservent pas les données (OpenRouter `data_collection: "deny"`) — §19. */
  denyDataCollection: boolean;
  /** Vérifier les mises à jour au démarrage (version installée uniquement) — §19. */
  checkUpdates: boolean;
  /** Onboarding terminé (charte acceptée). */
  onboardingDone: boolean;
};

export const DEFAULT_PREFS: AppPrefs = {
  autoResumeMissions: true,
  notifications: true,
  preventSleep: true,
  denyDataCollection: false,
  checkUpdates: true,
  onboardingDone: false,
};

export type CostLine = {
  key: string;
  label: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
};

export type CostsView = {
  totalUsd: number;
  budgetMaxUsd: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
  byPhase: CostLine[];
  byRole: CostLine[];
  byModel: CostLine[];
  /** Coût restant estimé (estimation moyenne moins dépensé) tant que la mission n'est pas terminée. */
  projectedRemainingUsd: number | null;
};

export type TechCallView = {
  id: string;
  at: string;
  role: string | null;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
};

export type MissionArchiveInfo = {
  missionId: string;
  title: string;
  files: number;
  sizeBytes: number;
};
