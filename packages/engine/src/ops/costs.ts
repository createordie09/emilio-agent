import type { CostLine, CostsView, TechCallView } from '@emilio/shared';
import type { Db } from '../storage/db';

const PHASE_LABEL: Record<string, string> = {
  P0: 'Préparation',
  P1: 'Cadrage',
  P2: 'Plan',
  P3: 'Recherche documentaire',
  P4: 'Analyse des données',
  P5: 'Rédaction',
  P6: 'Jury et révisions',
  P7: 'Évaluation globale',
  P8: 'Mise en forme',
  P9: 'Livrables',
};

type Agg = { k: string | null; c: number | null; i: number | null; o: number | null; n: number };
const lines = (rows: Agg[], label: (k: string) => string): CostLine[] =>
  rows
    .map((r) => ({
      key: r.k ?? 'autre',
      label: r.k ? label(r.k) : 'Cadrage, plan et divers',
      costUsd: r.c ?? 0,
      tokensIn: r.i ?? 0,
      tokensOut: r.o ?? 0,
      calls: r.n,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));

const BASE = `FROM llm_calls l LEFT JOIN tasks t ON t.id = l.task_id
  WHERE (l.mission_id = @id OR t.mission_id = @id) AND l.status_code = 200`;

/** Onglet « Coûts » (CdC §6.7) : par phase, par agent, par modèle, projection du coût restant. Tout vient de `llm_calls`. */
export function costsOf(db: Db, missionId: string, roleLabel: (r: string) => string): CostsView {
  const q = (group: string) =>
    db
      .prepare(
        `SELECT ${group} AS k, SUM(l.cost_usd) AS c, SUM(l.prompt_tokens) AS i, SUM(l.completion_tokens) AS o, COUNT(*) AS n ${BASE} GROUP BY ${group}`,
      )
      .all({ id: missionId }) as Agg[];
  const m = db
    .prepare(
      'SELECT cost_spent_usd, config_json, cost_estimate_json, status FROM missions WHERE id=?',
    )
    .get(missionId) as {
    cost_spent_usd: number;
    config_json: string | null;
    cost_estimate_json: string | null;
    status: string;
  };
  const cfg = JSON.parse(m.config_json ?? '{}') as { budgetMaxUsd?: number };
  const est = m.cost_estimate_json
    ? (JSON.parse(m.cost_estimate_json) as { scenarios?: { moyen?: { costUsd?: number } } })
    : null;
  const total = db
    .prepare(
      `SELECT SUM(l.prompt_tokens) AS i, SUM(l.completion_tokens) AS o, COUNT(*) AS n ${BASE}`,
    )
    .get({ id: missionId }) as { i: number | null; o: number | null; n: number };
  const mid = est?.scenarios?.moyen?.costUsd;
  return {
    totalUsd: m.cost_spent_usd,
    budgetMaxUsd: cfg.budgetMaxUsd ?? 0,
    tokensIn: total.i ?? 0,
    tokensOut: total.o ?? 0,
    calls: total.n,
    byPhase: lines(q('t.phase'), (k) => `${k} — ${PHASE_LABEL[k] ?? k}`),
    byRole: lines(q('l.agent_role'), roleLabel),
    byModel: lines(q('l.model'), (k) => k),
    projectedRemainingUsd:
      typeof mid === 'number' && !['completed', 'cancelled'].includes(m.status)
        ? Math.max(0, Math.round((mid - m.cost_spent_usd) * 10000) / 10000)
        : null,
  };
}

/** Journal technique (CdC §6.6) : derniers appels de modèle, sans contenu. */
export function techLogOf(db: Db, missionId: string, limit = 300): TechCallView[] {
  return (
    db
      .prepare(
        `SELECT l.id, l.created_at AS at, l.agent_role AS role, l.model, l.prompt_tokens AS ti, l.completion_tokens AS tout, l.cost_usd AS cost, l.latency_ms AS ms, l.error
         FROM llm_calls l LEFT JOIN tasks t ON t.id = l.task_id WHERE l.mission_id = @id OR t.mission_id = @id ORDER BY l.created_at DESC LIMIT @limit`,
      )
      .all({ id: missionId, limit }) as {
      id: string;
      at: string;
      role: string | null;
      model: string;
      ti: number | null;
      tout: number | null;
      cost: number | null;
      ms: number | null;
      error: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    at: r.at,
    role: r.role,
    model: r.model,
    tokensIn: r.ti,
    tokensOut: r.tout,
    costUsd: r.cost,
    latencyMs: r.ms,
    error: r.error,
  }));
}
