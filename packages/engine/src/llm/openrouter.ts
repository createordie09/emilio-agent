import { AppError, APP_NAME, type KeyInfo, type ModelInfo, type ModelList } from '@emilio/shared';
import type { SettingsRepo } from '../storage/settings';
import type { LlmClient, LlmRequest, LlmResponse } from './types';

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
  /** Délai max d'un appel de génération (CdC §14.1 : 180 s). */
  chatTimeoutMs: number;
  /** Réessais pour les appels de génération (CdC §14.1 : 5). */
  chatMaxRetries: number;
  /** Plafond du backoff exponentiel en ms. */
  retryMaxMs: number;
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
  chatTimeoutMs: 180_000,
  chatMaxRetries: 5,
  retryMaxMs: 60_000,
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

export class OpenRouterClient implements LlmClient {
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

  /**
   * Requête JSON avec délai max, réessais (429 / 5xx / réseau, backoff exponentiel + aléa) et mapping d'erreurs §20.
   * Aucun réessai sur 400 / 401 / 402 / 403 / 404.
   */
  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: {
      withAuth: boolean;
      body?: unknown;
      timeoutMs?: number;
      maxRetries?: number;
      signal?: AbortSignal;
    },
  ): Promise<T> {
    const maxRetries = opts.maxRetries ?? this.cfg.maxRetries;
    let lastErr: AppError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
      if (attempt > 0) {
        const backoff = Math.min(this.cfg.retryBaseMs * 2 ** (attempt - 1), this.cfg.retryMaxMs);
        await this.wait(backoff + Math.random() * backoff * 0.25);
      }
      let res: Response;
      try {
        const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.cfg.timeoutMs);
        res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
          method,
          headers: {
            ...this.headers(opts.withAuth),
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
        });
      } catch (e) {
        if (opts.signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
        lastErr = new AppError('E_NETWORK', e instanceof Error ? e.message : String(e));
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      let err = mapHttpError(res.status);
      if (res.status === 400) {
        // Prompt trop long pour la fenêtre du modèle : erreur dédiée (réduction automatique des extraits par l'appelant).
        const text = await res.text().catch(() => '');
        if (CONTEXT_OVERFLOW.test(text)) err = new AppError('E_CONTEXT_OVERFLOW', 'HTTP 400');
      }
      if (res.status === 429 || res.status === 408 || res.status >= 500) {
        lastErr = err;
        continue;
      }
      throw err;
    }
    throw lastErr ?? new AppError('E_INTERNAL');
  }

  private getJson<T>(path: string, withAuth: boolean): Promise<T> {
    return this.requestJson<T>('GET', path, { withAuth });
  }

  /** Appel de génération (POST /chat/completions) — CdC §14.1. Le coût vient de `usage.cost` (renvoyé par défaut). */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.apiKey) throw new AppError('E_KEY_MISSING');
    const t0 = this.now();
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    };
    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
      };
      // Ne router que vers des fournisseurs qui gèrent réellement response_format.
      body.provider = { require_parameters: true };
    }
    // Confidentialité (CdC §19) : n'utiliser que des fournisseurs qui ne conservent pas les données (`provider.data_collection`).
    if (this.settings.get<boolean>(PRIVACY_DENY_KEY))
      body.provider = { ...(body.provider as object | undefined), data_collection: 'deny' };
    const json = await this.requestJson<{
      id?: string;
      model?: string;
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { code?: number | string; message?: string };
    }>('POST', '/chat/completions', {
      withAuth: true,
      body,
      timeoutMs: req.timeoutMs ?? this.cfg.chatTimeoutMs,
      maxRetries: this.cfg.chatMaxRetries,
      signal: req.signal,
    });
    if (json.error) {
      const code = Number(json.error.code);
      if (CONTEXT_OVERFLOW.test(json.error.message ?? '')) throw new AppError('E_CONTEXT_OVERFLOW');
      throw Number.isFinite(code)
        ? mapHttpError(code)
        : new AppError('E_REMOTE', json.error.message);
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new AppError('E_REMOTE', 'Réponse vide du modèle');
    }
    return {
      content,
      model: json.model ?? req.model,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : null,
      generationId: json.id ?? null,
      latencyMs: this.now() - t0,
    };
  }

  /** Sonde légère de connectivité / de validité de la clé (reprise automatique, §8.6). */
  async ping(): Promise<void> {
    await this.getJson('/key', true);
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

/** Réglage « fournisseurs qui ne conservent pas mes données » (CdC §19, `provider.data_collection: "deny"`). */
export const PRIVACY_DENY_KEY = 'privacy_deny_data_collection';
const CONTEXT_OVERFLOW =
  /context[ _-]?(length|window)|maximum context|too many tokens|prompt is too long|input is too long/i;

export function mapHttpError(status: number): AppError {
  if (status === 400) return new AppError('E_BAD_REQUEST', `HTTP ${status}`);
  if (status === 401 || status === 403) return new AppError('E_KEY_INVALID', `HTTP ${status}`);
  if (status === 402) return new AppError('E_NO_CREDIT', `HTTP ${status}`);
  if (status === 429) return new AppError('E_RATE_LIMIT', `HTTP ${status}`);
  if (status === 404 || status === 503)
    return new AppError('E_MODEL_UNAVAILABLE', `HTTP ${status}`);
  if (status === 408) return new AppError('E_NETWORK', `HTTP ${status}`);
  return new AppError('E_REMOTE', `HTTP ${status}`);
}
