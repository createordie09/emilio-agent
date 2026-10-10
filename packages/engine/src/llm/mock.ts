import { AppError } from '@emilio/shared';
import type { LlmClient, LlmRequest, LlmResponse } from './types';

export type MockOptions = {
  /** Latence simulée par appel (ms). */
  delayMs?: number;
  /** Coût simulé par appel (USD). */
  costPerCallUsd?: number;
  /** Fabrique de contenu ; par défaut : un JSON `{ resume, manques }` déterministe. */
  respond?: (req: LlmRequest, callIndex: number) => string;
  now?: () => number;
};

/**
 * Faux client LLM déterministe (CdC §21.2) : aucune requête réseau, aucun coût.
 * Permet aussi de simuler crédit épuisé / réseau coupé / limite de débit (mode développeur et tests).
 */
export class MockLlmClient implements LlmClient {
  calls: LlmRequest[] = [];
  creditExhausted = false;
  /** Concurrence maximale observée (vérification du parallélisme). */
  maxConcurrent = 0;
  private active = 0;
  offline = false;
  /** Échecs ponctuels à injecter dans l'ordre des appels (consommés un par un). */
  private scripted: (AppError | Error | null)[] = [];

  constructor(private readonly opts: MockOptions = {}) {}

  failNext(...errors: (AppError | Error | null)[]): void {
    this.scripted.push(...errors);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.active++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    try {
      return await this.run(req);
    } finally {
      this.active--;
    }
  }

  private async run(req: LlmRequest): Promise<LlmResponse> {
    const t0 = (this.opts.now ?? Date.now)();
    if (this.opts.delayMs) await sleep(this.opts.delayMs, req.signal);
    if (req.signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
    if (this.offline) throw new AppError('E_NETWORK', 'simulé');
    if (this.creditExhausted) throw new AppError('E_NO_CREDIT', 'simulé');
    const scripted = this.scripted.shift();
    if (scripted) throw scripted;
    this.calls.push(req);
    const content =
      this.opts.respond?.(req, this.calls.length) ??
      JSON.stringify({
        resume: `[simulé] ${req.meta?.label ?? req.meta?.role ?? 'tâche'} terminée.`,
        manques: [],
      });
    return {
      content,
      model: req.model,
      promptTokens: 400,
      completionTokens: 200,
      costUsd: this.opts.costPerCallUsd ?? 0.001,
      generationId: `mock-${this.calls.length}`,
      latencyMs: (this.opts.now ?? Date.now)() - t0,
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}
