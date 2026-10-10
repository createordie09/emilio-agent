import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError, type AgentRole } from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { EventJournal } from '../events/journal';
import type { MissionRepo } from '../storage/missions';
import { clampParallelism, type MissionExecConfig } from './exec-config';
import type { ChatMessage, LlmClient, LlmResponse } from './types';

export type PriceGrid = (model: string) => { prompt: number; completion: number } | null;

/** Tâche en cours d'exécution : les appels des tâches locales y sont rattachés (coût par phase du rapport de mission). */
export const taskContext = new AsyncLocalStorage<string>();

export type CallParams = {
  missionId: string;
  taskId: string | null;
  role: AgentRole | 'local';
  messages: ChatMessage[];
  temperature?: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> } | null;
  promptVersion?: string;
  label?: string;
  signal?: AbortSignal;
};

export type CallResult = {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const BUDGET_ALERTS = [50, 80, 95] as const;

/**
 * Point d'appel unique des modèles (CdC §14.1 `callModel`) : choix du modèle et du secours,
 * contrôle de budget avant appel, journal `llm_calls`, coût réel, alertes 50 / 80 / 95 %.
 */
export class ModelCaller {
  constructor(
    private readonly db: Db,
    private readonly missions: MissionRepo,
    private readonly journal: EventJournal,
    /** Fournit le client selon le mode de la mission (simulé ou réel). */
    private readonly clientFor: (mode: MissionExecConfig['llmMode']) => LlmClient,
    private readonly prices: PriceGrid = () => null,
  ) {}

  /** Appels simultanés par mission : jamais plus que le parallélisme configuré (§7.6), même quand une tâche lance plusieurs agents (jurés). */
  private slots = new Map<string, { active: number; waiting: (() => void)[] }>();

  private async acquire(missionId: string): Promise<() => void> {
    const limit = clampParallelism(this.missions.config<MissionExecConfig>(missionId).parallelism);
    const s = this.slots.get(missionId) ?? { active: 0, waiting: [] };
    this.slots.set(missionId, s);
    if (s.active >= limit) await new Promise<void>((resolve) => s.waiting.push(resolve));
    else s.active++;
    return () => {
      const next = s.waiting.shift();
      if (next)
        next(); // le créneau passe directement à l'appel suivant
      else s.active--;
    };
  }

  async call(p: CallParams): Promise<CallResult> {
    const release = await this.acquire(p.missionId);
    try {
      return await this.callInner(p);
    } finally {
      release();
    }
  }

  private async callInner(p: CallParams): Promise<CallResult> {
    const cfg = this.missions.config<MissionExecConfig>(p.missionId);
    const primary = cfg.models[p.role as AgentRole];
    if (!primary) {
      throw new AppError('E_BAD_REQUEST', `Aucun modèle configuré pour le rôle ${p.role}`);
    }
    const chain = [primary, ...(cfg.fallbackModels?.[p.role as AgentRole] ?? [])];

    // Budget : on refuse l'appel s'il dépasserait le plafond (§14.4).
    const spent = this.missions.costSpent(p.missionId);
    const estimate = cfg.estimateCallUsd ?? 0;
    if (cfg.budgetMaxUsd > 0 && spent + estimate > cfg.budgetMaxUsd) throw new AppError('E_BUDGET');

    const client = this.clientFor(cfg.llmMode);
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i]!;
      const t0 = Date.now();
      try {
        const res = await client.complete({
          model,
          messages: p.messages,
          temperature: p.temperature,
          jsonSchema: p.jsonSchema,
          signal: p.signal,
          meta: { role: p.role, label: p.label },
        });
        const cost = res.costUsd ?? this.gridCost(res);
        this.log(p, model, res, cost, 200, null, Date.now() - t0);
        this.afterSpend(p.missionId, cfg, cost);
        return {
          content: res.content,
          model: res.model,
          tokensIn: res.promptTokens,
          tokensOut: res.completionTokens,
          costUsd: cost,
        };
      } catch (e) {
        lastErr = e;
        if (e instanceof AppError) this.logError(p, model, e, Date.now() - t0);
        if (e instanceof AppError && e.code === 'E_MODEL_UNAVAILABLE' && i < chain.length - 1) {
          this.journal.record({
            missionId: p.missionId,
            level: 'warning',
            messageFr: `Le modèle ${model} est indisponible, bascule sur ${chain[i + 1]}.`,
            agentRole: p.role,
          });
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  /** Repli : coût calculé via la grille de prix du modèle quand `usage.cost` est absent. */
  private gridCost(res: LlmResponse): number {
    const price = this.prices(res.model);
    return price ? res.promptTokens * price.prompt + res.completionTokens * price.completion : 0;
  }

  private log(
    p: CallParams,
    model: string,
    res: LlmResponse,
    cost: number,
    status: number,
    error: string | null,
    ms: number,
  ): void {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO llm_calls(id,task_id,model,prompt_version,prompt_tokens,completion_tokens,cost_usd,latency_ms,status_code,error,openrouter_generation_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId(),
        p.taskId ?? taskContext.getStore() ?? null,
        model,
        p.promptVersion ?? null,
        res.promptTokens,
        res.completionTokens,
        cost,
        res.latencyMs || ms,
        status,
        error,
        res.generationId,
        t,
        t,
      );
  }

  private logError(p: CallParams, model: string, e: AppError, ms: number): void {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO llm_calls(id,task_id,model,prompt_version,latency_ms,status_code,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId(),
        p.taskId ?? taskContext.getStore() ?? null,
        model,
        p.promptVersion ?? null,
        ms,
        Number(/\d+/.exec(e.detail ?? '')?.[0]) || null,
        e.code,
        t,
        t,
      );
  }

  /** Cumule le coût sur la mission et notifie les seuils de budget franchis (une seule fois chacun). */
  private afterSpend(missionId: string, cfg: MissionExecConfig, cost: number): void {
    const total = this.missions.addCost(missionId, cost);
    if (!(cfg.budgetMaxUsd > 0)) return;
    // Relecture : des appels parallèles ont pu notifier d'autres seuils depuis le début de cet appel.
    const cur = this.missions.config<MissionExecConfig>(missionId);
    const pct = (total / cfg.budgetMaxUsd) * 100;
    const sent = new Set(cur.budgetAlertsSent ?? []);
    for (const th of BUDGET_ALERTS) {
      if (pct >= th && !sent.has(th)) {
        sent.add(th);
        this.journal.record({
          missionId,
          level: th >= 80 ? 'warning' : 'info',
          messageFr: `Budget utilisé à ${th} % (${total.toFixed(2)} $ sur ${cfg.budgetMaxUsd.toFixed(2)} $).`,
        });
      }
    }
    this.missions.setConfig(missionId, { ...cur, budgetAlertsSent: [...sent] });
  }
}
