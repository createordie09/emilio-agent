import type { AgentRole, JuryVerdict } from '@emilio/shared';
import type { JuryConfig, JuryCriterion } from './config';
import type { JurorOutput } from './schemas';

export type ScoreRow = { id: string; note: number | null; max: number; justification: string };
export type JurorResult = {
  role: AgentRole;
  scores: ScoreRow[];
  total: number;
  warnings: string[];
};

/**
 * Valide la grille remplie par un juré : seuls les critères qui lui sont attribués comptent ; une note hors [0, max] est ramenée dans
 * l'intervalle ; un critère non noté (null) ou absent est « non applicable ». Le total sur 20 est recalculé par le code (§13.2).
 */
export function scoreJuror(
  role: AgentRole,
  out: JurorOutput,
  criteria: JuryCriterion[],
): JurorResult {
  const mine = criteria.filter((c) => c.jurors.includes(role));
  const warnings: string[] = [];
  const scores: ScoreRow[] = mine.map((c) => {
    const s = out.scores.find((x) => x.critere_id.trim().toUpperCase() === c.id);
    if (!s || s.note === null || !Number.isFinite(s.note))
      return { id: c.id, note: null, max: c.points, justification: s?.justification ?? '' };
    const note = Math.min(c.points, Math.max(0, s.note));
    if (note !== s.note) warnings.push(`Note du critère ${c.id} ramenée dans [0, ${c.points}].`);
    return { id: c.id, note, max: c.points, justification: s.justification };
  });
  const noted = scores.filter((s) => s.note !== null);
  const max = noted.reduce((a, s) => a + s.max, 0);
  const total = max ? (noted.reduce((a, s) => a + s.note!, 0) / max) * 20 : 0;
  return { role, scores, total, warnings };
}

export type Consolidated = {
  /** Moyenne par critère des jurés qui l'évaluent (§13.3). */
  criteria: { id: string; avg: number | null; max: number }[];
  /** Note consolidée sur 20, ramenée aux critères effectivement notés. */
  total: number;
  /** Écart entre le juré le plus sévère et le plus clément. */
  spread: number;
};

export function consolidate(results: JurorResult[], criteria: JuryCriterion[]): Consolidated {
  const rows = criteria.map((c) => {
    const notes = results.flatMap((r) =>
      r.scores.filter((s) => s.id === c.id && s.note !== null).map((s) => s.note!),
    );
    return {
      id: c.id,
      avg: notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null,
      max: c.points,
    };
  });
  const noted = rows.filter((r) => r.avg !== null);
  const max = noted.reduce((a, r) => a + r.max, 0);
  const total = max ? (noted.reduce((a, r) => a + r.avg!, 0) / max) * 20 : 0;
  const totals = results.map((r) => r.total);
  return {
    criteria: rows,
    total,
    spread: totals.length ? Math.max(...totals) - Math.min(...totals) : 0,
  };
}

/** Verdicts (§13.3) : ≥ seuil valide ; ≥ seuil − 3 à réviser ; en dessous à réécrire. */
export function verdictOf(
  total: number,
  threshold: number,
  cfg: Pick<JuryConfig, 'verdictMargin'>,
): JuryVerdict {
  const t = Math.round(total * 100) / 100;
  return t >= threshold
    ? 'valide'
    : t >= threshold - cfg.verdictMargin
      ? 'a_reviser'
      : 'a_reecrire';
}
