import { AppError, APP_NAME, type KeyInfo, type ModelInfo, type ModelList } from '@emilio/shared';
import type { SettingsRepo } from '../storage/settings';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OpenRouterConfig = {
  /** Base de l'API compatible OpenAI (https://openrouter.ai/api/v1 par défaut). */
  baseUrl: string;
  /** Délai max par appel en ms. */
  timeoutMs: number;
  /** Nombre max de réessais (429, 5xx, réseau). */
  maxRetries: number;
  /** Délai de base du backoff exponentiel en ms. */
  retryBaseMs: number;
  /** Durée de validité du cache des modèles (CdC §14.2 : 24 h). */
  modelsCacheTtlMs: number;
  /** URL d'identification de l'app (en-tête HTTP-Referer, optionnel). */
  appReferer?: string;
  appTitle: string;
};

export const DEFAULT_OPENROUTER_CONFIG: OpenRouterConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseMs: 1_000,
  modelsCacheTtlMs: 24 * 3600 * 1000,
  appTitle: APP_NAME,
};

const MODELS_CACHE_KEY = 'openrouter_models_cache';

type RawModel = {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

/** Prix OpenRouter : chaîne en USD par jeton ; valeurs négatives (-1) = tarification variable. */
export function parsePrice(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function normalizeModel(r: RawModel): ModelInfo {
  const params = r.supported_parameters ?? [];
  return {
    id: r.id,
    name: r.name ?? r.id,
    contextLength: r.context_length ?? null,
    promptPrice: parsePrice(r.pricing?.prompt),
    completionPrice: parsePrice(r.pricing?.completion),
    supportsStructuredOutputs: params.includes('structured_outputs'),
    supportsJsonMode: params.includes('response_format'),
    inputModalities: r.architecture?.input_modalities ?? [],
    outputModalities: r.architecture?.output_modalities ?? [],
  };
}

export { maskKey } from '@emilio/shared';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class OpenRouterClient {
  private apiKey: string | null = null;

  constructor(
    private readonly settings: SettingsRepo,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly cfg: OpenRouterConfig = DEFAULT_OPENROUTER_CONFIG,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  setApiKey(key: string | null): void {
    this.apiKey = key && key.trim() ? key.trim() : null;
  }

  hasKey(): boolean {
    return this.apiKey !== null;
  }

  private headers(withAuth: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'X-OpenRouter-Title': this.cfg.appTitle,
      'X-Title': this.cfg.appTitle,
    };
    if (this.cfg.appReferer) h['HTTP-Referer'] = this.cfg.appReferer;
    if (withAuth && this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  /** GET JSON avec délai max, réessais (429 / 5xx / réseau) et mapping d'erreurs §20. Aucun réessai sur 4xx. */
  private async getJson<T>(path: string, withAuth: boolean): Promise<T> {
    let lastErr: AppError | null = null;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = this.cfg.retryBaseMs * 2 ** (attempt - 1);
        await this.wait(backoff + Math.random() * backoff * 0.25);
      }
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
          headers: this.headers(withAuth),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
      } catch (e) {
        lastErr = new AppError('E_NETWORK', e instanceof Error ? e.message : String(e));
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      const err = mapHttpError(res.status);
      if (res.status === 429 || res.status >= 500) {
        lastErr = err;
        continue;
      }
      throw err;
    }
    throw lastErr ?? new AppError('E_INTERNAL');
  }

  /** Teste la clé (GET /key) et, si possible, lit le crédit de compte (GET /credits). */
  async testKey(): Promise<KeyInfo> {
    if (!this.apiKey) throw new AppError('E_KEY_MISSING');
    const key = await this.getJson<{
      data: {
        label?: string | null;
        limit?: number | null;
        limit_remaining?: number | null;
        usage?: number;
        is_free_tier?: boolean;
      };
    }>('/key', true);
    let accountCreditRemaining: number | null = null;
    try {
      const c = await this.getJson<{ data: { total_credits: number; total_usage: number } }>(
        '/credits',
        true,
      );
      // Le solde ne peut pas être négatif à l'affichage (dépassement ponctuel toléré par OpenRouter).
      accountCreditRemaining = Math.max(0, c.data.total_credits - c.data.total_usage);
    } catch {
      // /credits peut être refusé selon le type de clé : le crédit de compte reste inconnu.
    }
    const d = key.data;
    return {
      label: d.label ?? null,
      limit: d.limit ?? null,
      limitRemaining: d.limit_remaining ?? null,
      usage: d.usage ?? 0,
      isFreeTier: d.is_free_tier ?? false,
      accountCreditRemaining,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  /** Liste des modèles (GET /models, public), mise en cache 24 h. */
  async listModels(opts: { refresh?: boolean } = {}): Promise<ModelList> {
    const cached = this.settings.get<{ fetchedAt: string; models: ModelInfo[] }>(MODELS_CACHE_KEY);
    if (cached && !opts.refresh) {
      const age = this.now() - Date.parse(cached.fetchedAt);
      if (age >= 0 && age < this.cfg.modelsCacheTtlMs) {
        return { models: cached.models, fetchedAt: cached.fetchedAt, fromCache: true };
      }
    }
    try {
      const raw = await this.getJson<{ data: RawModel[] }>('/models', false);
      const models = raw.data.map(normalizeModel);
      const fetchedAt = new Date(this.now()).toISOString();
      this.settings.set(MODELS_CACHE_KEY, { fetchedAt, models });
      return { models, fetchedAt, fromCache: false };
    } catch (e) {
      // Hors ligne : on sert le cache même périmé plutôt que rien (ENF-07).
      if (cached) return { models: cached.models, fetchedAt: cached.fetchedAt, fromCache: true };
      throw e;
    }
  }
}

export function mapHttpError(status: number): AppError {
  if (status === 401 || status === 403) return new AppError('E_KEY_INVALID', `HTTP ${status}`);
  if (status === 402) return new AppError('E_NO_CREDIT', `HTTP ${status}`);
  if (status === 429) return new AppError('E_RATE_LIMIT', `HTTP ${status}`);
  if (status === 404) return new AppError('E_MODEL_UNAVAILABLE', `HTTP ${status}`);
  return new AppError('E_REMOTE', `HTTP ${status}`);
}
