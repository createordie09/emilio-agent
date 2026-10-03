import { createHash } from 'node:crypto';
import { AppError, APP_NAME } from '@emilio/shared';
import type { Db } from '../storage/db';
import { TokenBucket } from './rate-limit';

import type { FetchLike } from '../llm/openrouter';

export type HttpConfig = {
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  /** Durée de vie du cache des réponses (CdC §11.1). */
  cacheTtlMs: number;
  appVersion: string;
};

export const DEFAULT_HTTP_CONFIG: HttpConfig = {
  timeoutMs: 20_000,
  maxRetries: 3,
  retryBaseMs: 1_000,
  retryMaxMs: 20_000,
  cacheTtlMs: 7 * 24 * 3600_000,
  appVersion: '0.4.0',
};

/** Paramètres retirés de la clé de cache (identité de l'utilisateur, jamais mise en cache ni journalisée). */
const VOLATILE_PARAMS = ['mailto', 'email', 'api_key', 'apikey'];

export function cacheKey(connector: string, url: string): string {
  const u = new URL(url);
  for (const p of VOLATILE_PARAMS) u.searchParams.delete(p);
  u.searchParams.sort();
  return createHash('sha256').update(`${connector}\n${u.toString()}`).digest('hex');
}

export type RequestOptions = {
  headers?: Record<string, string>;
  /** Durée de cache propre à la requête ; 0 = pas de cache. */
  ttlMs?: number;
  signal?: AbortSignal;
  /** Autorise un 404 comme réponse « inexistant » (renvoie `null`). */
  notFoundIsNull?: boolean;
};

/**
 * Client HTTP des connecteurs : limitation de débit, cache SQLite, réessais (429, 5xx, réseau) avec respect de
 * `Retry-After`, en-tête `User-Agent` poli avec adresse de contact (CdC §11.1, §11.2).
 */
export class SourceHttp {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly cfg: HttpConfig = DEFAULT_HTTP_CONFIG,
    private readonly contactEmail: () => string | undefined = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Copie du client avec d'autres réglages (ex. test de connexion rapide : pas de réessai, délai court). */
  withConfig(patch: Partial<HttpConfig>): SourceHttp {
    return new SourceHttp(
      this.db,
      this.fetchImpl,
      { ...this.cfg, ...patch },
      this.contactEmail,
      this.now,
      this.sleep,
    );
  }

  email(): string | undefined {
    return this.contactEmail()?.trim() || undefined;
  }

  userAgent(): string {
    const e = this.email();
    return `${APP_NAME.replace(/\s+/g, '-')}/${this.cfg.appVersion}` + (e ? ` (mailto:${e})` : '');
  }

  private bucket(id: string, rps: number): TokenBucket {
    let b = this.buckets.get(id);
    if (!b) {
      b = new TokenBucket(rps, Math.max(1, Math.min(rps, 5)), this.now, this.sleep);
      this.buckets.set(id, b);
    }
    return b;
  }

  private cached(key: string): { body: string; status: number } | null {
    const r = this.db
      .prepare('SELECT body, status, expires_at FROM source_cache WHERE key=?')
      .get(key) as { body: string; status: number; expires_at: string } | undefined;
    return r && Date.parse(r.expires_at) > this.now() ? { body: r.body, status: r.status } : null;
  }

  private store(key: string, connector: string, body: string, status: number, ttl: number): void {
    const t = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `INSERT INTO source_cache(key,connector,body,status,fetched_at,expires_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET body=excluded.body,status=excluded.status,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`,
      )
      .run(key, connector, body, status, t, new Date(this.now() + ttl).toISOString());
  }

  /** Efface les entrées périmées du cache. */
  purgeExpired(): number {
    return this.db
      .prepare('DELETE FROM source_cache WHERE expires_at <= ?')
      .run(new Date(this.now()).toISOString()).changes;
  }

  async getText(
    connector: string,
    rps: number,
    url: string,
    opts: RequestOptions = {},
  ): Promise<string | null> {
    const ttl = opts.ttlMs ?? this.cfg.cacheTtlMs;
    const key = cacheKey(connector, url);
    if (ttl > 0) {
      const hit = this.cached(key);
      if (hit) return hit.status === 404 ? null : hit.body;
    }
    let lastErr: AppError | null = null;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (opts.signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
      if (attempt > 0) {
        const backoff = Math.min(this.cfg.retryBaseMs * 2 ** (attempt - 1), this.cfg.retryMaxMs);
        await this.sleep(backoff + Math.random() * backoff * 0.25);
      }
      await this.bucket(connector, rps).acquire();
      let res: Response;
      try {
        const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
        res = await this.fetchImpl(url, {
          headers: {
            'User-Agent': this.userAgent(),
            Accept: 'application/json, application/atom+xml, text/xml;q=0.9, */*;q=0.5',
            ...opts.headers,
          },
          signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
        });
      } catch (e) {
        if (opts.signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
        lastErr = new AppError('E_NETWORK', `${connector} : ${(e as Error).message}`);
        continue;
      }
      if (res.ok) {
        const body = await res.text();
        if (ttl > 0) this.store(key, connector, body, res.status, ttl);
        return body;
      }
      if (res.status === 404 && opts.notFoundIsNull) {
        if (ttl > 0) this.store(key, connector, '', 404, Math.min(ttl, 24 * 3600_000));
        return null;
      }
      if (res.status === 429 || res.status === 408 || res.status >= 500) {
        lastErr = new AppError(
          res.status === 429 ? 'E_RATE_LIMIT' : 'E_SOURCE_REMOTE',
          `${connector} : HTTP ${res.status}`,
        );
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0 && attempt < this.cfg.maxRetries)
          await this.sleep(Math.min(ra * 1000, this.cfg.retryMaxMs));
        continue;
      }
      throw new AppError(
        res.status === 401 || res.status === 403 ? 'E_SOURCE_AUTH' : 'E_SOURCE_REMOTE',
        `${connector} : HTTP ${res.status}`,
      );
    }
    throw lastErr ?? new AppError('E_SOURCE_REMOTE', connector);
  }

  async getJson<T>(
    connector: string,
    rps: number,
    url: string,
    opts: RequestOptions = {},
  ): Promise<T | null> {
    const text = await this.getText(connector, rps, url, opts);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AppError('E_SOURCE_REMOTE', `${connector} : réponse non JSON`);
    }
  }

  /** Téléchargement binaire (PDF en accès ouvert) : pas de cache, plafond de taille, pas de limitation de débit propre. */
  async download(url: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.fetchImpl(url, {
      headers: { 'User-Agent': this.userAgent(), Accept: 'application/pdf,*/*;q=0.5' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.cfg.timeoutMs * 3)])
        : AbortSignal.timeout(this.cfg.timeoutMs * 3),
      redirect: 'follow',
    });
    if (!res.ok) throw new AppError('E_SOURCE_REMOTE', `téléchargement : HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > maxBytes)
      throw new AppError(
        'E_PARSE_FILE',
        `fichier trop volumineux (${Math.round(len / 1048576)} Mo)`,
      );
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes)
      throw new AppError(
        'E_PARSE_FILE',
        `fichier trop volumineux (${Math.round(buf.length / 1048576)} Mo)`,
      );
    return buf;
  }
}
