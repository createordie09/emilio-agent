/** Codes d'erreur internes et messages utilisateur en français (CdC §20). */
export const ERROR_MESSAGES_FR = {
  E_KEY_INVALID: 'Votre clé OpenRouter est invalide ou a été révoquée.',
  E_KEY_MISSING: "Aucune clé OpenRouter n'est enregistrée.",
  E_KEY_STORAGE:
    "Le chiffrement sécurisé n'est pas disponible sur cet ordinateur : la clé ne peut pas être enregistrée.",
  E_NO_CREDIT: 'Crédit OpenRouter épuisé. Rechargez votre compte puis réessayez.',
  E_RATE_LIMIT: 'OpenRouter limite temporairement les requêtes. Réessayez dans un instant.',
  E_NETWORK: 'Connexion Internet indisponible. Vérifiez votre réseau puis réessayez.',
  E_BUDGET: 'Le budget maximal de la mission est atteint.',
  E_BAD_REQUEST: "La requête envoyée au modèle d'IA est invalide.",
  E_SCHEMA: "La réponse du modèle d'IA n'est pas exploitable.",
  E_PARSE_FILE: 'Impossible de lire ce fichier.',
  E_MODEL_UNAVAILABLE: 'Le modèle demandé est indisponible.',
  E_REMOTE: 'Le service OpenRouter a renvoyé une erreur inattendue.',
  E_SOURCE_AUTH:
    "Un service de recherche documentaire a refusé l'accès (clé absente ou invalide, ou domaine bloqué par le réseau).",
  E_SOURCE_REMOTE: 'Un service de recherche documentaire a renvoyé une erreur.',
  E_PLAN: "Le plan n'a pas pu être généré. Vous pouvez réessayer.",
  E_ENGINE: "Le moteur de l'application ne répond pas.",
  E_INTERNAL: "Une erreur interne s'est produite.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES_FR;

/** Erreur typée transportable par IPC (sérialisable). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;
  constructor(code: ErrorCode, detail?: string) {
    super(ERROR_MESSAGES_FR[code]);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
  get messageFr(): string {
    return ERROR_MESSAGES_FR[this.code];
  }
}

export type SerializedError = { code: ErrorCode; messageFr: string; detail?: string };

export function serializeError(e: unknown): SerializedError {
  if (e instanceof AppError) return { code: e.code, messageFr: e.messageFr, detail: e.detail };
  return {
    code: 'E_INTERNAL',
    messageFr: ERROR_MESSAGES_FR.E_INTERNAL,
    detail: e instanceof Error ? e.message : String(e),
  };
}
