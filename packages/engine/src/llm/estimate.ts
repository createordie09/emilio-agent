import type {
  AgentRole,
  Brief,
  CostEstimate,
  EstimatePhase,
  EstimateScenario,
  OutlineNodeView,
} from '@emilio/shared';
import type { Db } from '../storage/db';
import type { EstimationConfig } from '../planning/config';

type Price = { prompt: number; completion: number };

export type EstimateInput = {
  nodes: OutlineNodeView[];
  brief: Pick<
    Brief,
    'livrables' | 'liminaires' | 'hypotheses' | 'execution' | 'longueur' | 'approche'
  >;
  models: Partial<Record<AgentRole, string>>;
  /** Prix par jeton (OpenRouter `GET /models`) ; `null` si inconnu. */
  price: (model: string) => Price | null;
  /** Vitesse de sortie mesurée (jetons/s) ; `null` → valeur par défaut de la configuration. */
  speed: (model: string) => number | null;
  cfg: EstimationConfig;
  simulated: boolean;
  hasFieldData: boolean;
  spentUsd: number;
  budgetMaxUsd: number | null;
  now?: () => string;
};

type Line = { phase: string; role: AgentRole; calls: number; tokensIn: number; tokensOut: number };

const PHASE_LABEL: Record<string, string> = {
  P3: 'Recherche approfondie et fiches de lecture',
  P4: 'Analyse des données de terrain',
  P5: 'Rédaction, ancrage et résumés',
  P6: 'Jury par chapitre et révisions',
  P7: 'Évaluation globale et harmonisation',
  P8: 'Bibliographie',
  P9: 'Soutenance',
};

/** Unités de rédaction : feuilles du corps, et introduction / conclusion générales rédigées d'un bloc. */
export function writingUnits(nodes: OutlineNodeView[]): { node: OutlineNodeView; words: number }[] {
  const kids = new Map<string | null, OutlineNodeView[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const sumLeaves = (n: OutlineNodeView): number => {
    const c = kids.get(n.id) ?? [];
    return c.length ? c.reduce((s, x) => s + sumLeaves(x), 0) : n.targetWords;
  };
  const out: { node: OutlineNodeView; words: number }[] = [];
  const walk = (n: OutlineNodeView) => {
    const c = kids.get(n.id) ?? [];
    if (!c.length || n.kind !== 'corps') {
      out.push({ node: n, words: sumLeaves(n) || n.targetWords });
      return;
    }
    c.forEach(walk);
  };
  (kids.get(null) ?? []).forEach(walk);
  return out;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Estimation du coût et de la durée (CdC §14.5) : tokens par phase d'après les coefficients de
 * `resources/estimation.json`, multipliés par les prix des modèles choisis ; trois scénarios (1 ronde, 2 rondes, rondes max).
 */
export function estimateMission(i: EstimateInput): CostEstimate {
  const { cfg } = i;
  const ex = i.brief.execution;
  const depth = ex?.profondeurRecherche ?? 'normale';
  const parallelism = Math.max(1, ex?.parallelism ?? 3);
  const maxRounds = Math.max(1, ex?.rondesMaxParChapitre ?? 3);
  const globalMax = ex?.rondesMaxGlobales ?? 2;
  const units = writingUnits(i.nodes);
  const bodyUnits = units.filter((u) => u.node.kind === 'corps');
  const sections = Math.max(1, bodyUnits.length);
  const totalWords = units.reduce((s, u) => s + u.words, 0);
  const tpw = cfg.tokensPerWord;
  const chapters = Math.max(
    1,
    i.nodes.filter((n) => n.level === 'chapitre' && n.kind === 'corps').length ||
      i.nodes.filter((n) => n.parentId === null && n.kind === 'corps').length,
  );
  const chapterWords = totalWords / chapters;

  const lines = (sc: EstimateScenario): Line[] => {
    const rounds = sc === 'bas' ? 1 : sc === 'moyen' ? Math.min(2, maxRounds) : maxRounds;
    // Une ronde de révision = une révision puis une nouvelle évaluation : le jury évalue donc `rounds + 1` fois (mesuré, J10).
    const evals = rounds + 1;
    const out: Line[] = [];
    const add = (phase: string, role: AgentRole, calls: number, tIn: number, tOut: number) => {
      if (calls > 0)
        out.push({ phase, role, calls, tokensIn: calls * tIn, tokensOut: calls * tOut });
    };
    // P3 : recherche (requêtes, classement), vérification (arbitrage) et fiches de lecture.
    const rc = cfg.research.depthCalls[depth];
    add('P3', 'researcher', sections * rc, cfg.research.tokensIn, cfg.research.tokensOut);
    add(
      'P3',
      'source_verifier',
      Math.ceil(sections * rc * cfg.research.verifierShare),
      cfg.research.tokensIn / 2,
      cfg.research.tokensOut / 3,
    );
    add(
      'P3',
      'document_analyst',
      sections * cfg.reading.notesPerSection[depth],
      cfg.reading.tokensIn,
      cfg.reading.tokensOut,
    );
    // P4 : analyses (seulement si des données de terrain sont fournies).
    if (i.hasFieldData)
      add(
        'P4',
        'data_analyst',
        cfg.dataAnalysis.callsBase +
          cfg.dataAnalysis.callsPerHypothesis * i.brief.hypotheses.length,
        cfg.dataAnalysis.tokensIn,
        cfg.dataAnalysis.tokensOut,
      );
    // P5 : rédaction (M × 1,3 jetons/mot, contexte en plus), ancrage, résumés.
    for (const u of units) {
      const tOut = u.words * tpw;
      add(
        'P5',
        'section_writer',
        1,
        Math.max(cfg.writing.minInputTokens, tOut * cfg.writing.inputPerOutputToken),
        tOut,
      );
    }
    const claims = totalWords / cfg.grounding.wordsPerClaim;
    add(
      'P5',
      'grounding_checker',
      Math.ceil(claims / cfg.grounding.claimsPerCall),
      cfg.grounding.tokensIn,
      cfg.grounding.tokensOut,
    );
    add(
      'P5',
      'summarizer',
      units.length + (i.brief.liminaires.abstract ? 2 : 1),
      cfg.summaries.tokensInPerSection,
      cfg.summaries.tokensOut,
    );
    // P6 : jury par chapitre (rondes) et révisions des sections concernées.
    const jIn = chapterWords * tpw * cfg.jury.chapterInputRatio;
    const jurors: AgentRole[] = ['juror_methodologist', 'juror_specialist', 'juror_form'];
    for (const role of jurors.slice(0, cfg.jury.jurors))
      add('P6', role, chapters * evals, jIn, cfg.jury.tokensOut);
    add(
      'P6',
      'jury_president',
      chapters * evals,
      cfg.jury.jurors * cfg.jury.tokensOut + 1500,
      cfg.jury.presidentTokensOut,
    );
    const revised = Math.ceil(sections * cfg.revision.shareOfSections[sc] * rounds);
    const avgSectionOut = (bodyUnits.reduce((s, u) => s + u.words, 0) / sections) * tpw;
    add(
      'P6',
      'section_writer',
      revised,
      avgSectionOut * cfg.revision.inputPerOutputToken,
      avgSectionOut,
    );
    // P7 : évaluation globale (au moins une passe si des rondes globales sont permises).
    if (globalMax > 0) {
      const g = sc === 'haut' ? globalMax : (cfg.global.roundsExpected[sc] ?? 0);
      const passes = 1 + g;
      const gIn =
        units.length * cfg.global.summaryTokensPerSection +
        units.filter((u) => u.node.kind !== 'corps').reduce((s, u) => s + u.words * tpw, 0);
      for (const role of jurors.slice(0, cfg.jury.jurors))
        add('P7', role, passes, gIn, cfg.jury.tokensOut);
      add(
        'P7',
        'jury_president',
        passes,
        cfg.jury.jurors * cfg.jury.tokensOut + 1500,
        cfg.jury.presidentTokensOut,
      );
      add('P7', 'harmonizer', passes, gIn, cfg.global.tokensOut);
    }
    // P8 / P9.
    add('P8', 'bibliographer', 1, cfg.finishing.biblioTokensIn, cfg.finishing.biblioTokensOut);
    if (i.brief.livrables.pptx)
      add(
        'P9',
        'defense_designer',
        1,
        cfg.finishing.defenseTokensIn,
        (i.brief.livrables.nbDiapos ?? 15) * cfg.finishing.defenseTokensOutPerSlide,
      );
    return out;
  };

  const missing = new Set<string>();
  const priceOf = (model: string): Price | null => {
    if (i.simulated)
      return {
        prompt: cfg.simulatedPrice.promptPerMTokUsd / 1e6,
        completion: cfg.simulatedPrice.completionPerMTokUsd / 1e6,
      };
    return i.price(model);
  };
  const lineCost = (l: Line): number => {
    const model = i.models[l.role];
    if (!model) return 0;
    const p = priceOf(model);
    if (!p) {
      missing.add(model);
      return 0;
    }
    return l.tokensIn * p.prompt + l.tokensOut * p.completion;
  };
  const lineSeconds = (l: Line): number => {
    const model = i.models[l.role];
    const speed = (model && !i.simulated ? i.speed(model) : null) ?? cfg.defaultTokensPerSecond;
    const serial = l.tokensOut / speed + l.calls * cfg.callOverheadSec;
    const par = cfg.parallelPhases.includes(l.phase)
      ? Math.min(parallelism, Math.max(1, l.calls))
      : 1;
    return serial / par;
  };

  const phases = new Map<string, EstimatePhase>();
  const totals = {
    bas: { costUsd: 0, durationSec: 0 },
    moyen: { costUsd: 0, durationSec: 0 },
    haut: { costUsd: 0, durationSec: 0 },
  };
  for (const sc of ['bas', 'moyen', 'haut'] as const) {
    for (const l of lines(sc)) {
      let ph = phases.get(l.phase);
      if (!ph) {
        ph = {
          phase: l.phase,
          labelFr: PHASE_LABEL[l.phase] ?? l.phase,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: { bas: 0, moyen: 0, haut: 0 },
          durationSec: { bas: 0, moyen: 0, haut: 0 },
        };
        phases.set(l.phase, ph);
      }
      const c = lineCost(l);
      const d = lineSeconds(l);
      ph.costUsd[sc] += c;
      ph.durationSec[sc] += d;
      if (sc === 'moyen') {
        ph.tokensIn += l.tokensIn;
        ph.tokensOut += l.tokensOut;
      }
      totals[sc].costUsd += c;
      totals[sc].durationSec += d;
    }
  }
  const phaseList = [...phases.values()]
    .sort((a, b) => a.phase.localeCompare(b.phase))
    .map((p) => ({
      ...p,
      tokensIn: Math.round(p.tokensIn),
      tokensOut: Math.round(p.tokensOut),
      costUsd: {
        bas: round(p.costUsd.bas),
        moyen: round(p.costUsd.moyen),
        haut: round(p.costUsd.haut),
      },
      durationSec: {
        bas: Math.round(p.durationSec.bas),
        moyen: Math.round(p.durationSec.moyen),
        haut: Math.round(p.durationSec.haut),
      },
    }));
  const scenarios = {
    bas: { costUsd: round(totals.bas.costUsd), durationSec: Math.round(totals.bas.durationSec) },
    moyen: {
      costUsd: round(totals.moyen.costUsd),
      durationSec: Math.round(totals.moyen.durationSec),
    },
    haut: { costUsd: round(totals.haut.costUsd), durationSec: Math.round(totals.haut.durationSec) },
  };
  const budget = i.budgetMaxUsd;
  const exceeds = (sc: EstimateScenario) =>
    budget !== null && budget > 0 && i.spentUsd + scenarios[sc].costUsd > budget;
  return {
    scenarios,
    phases: phaseList,
    spentUsd: round(i.spentUsd),
    budgetMaxUsd: budget,
    exceedsBudget: { bas: exceeds('bas'), moyen: exceeds('moyen'), haut: exceeds('haut') },
    partial: missing.size > 0,
    missingPrice: [...missing],
    simulated: i.simulated,
    sectionCount: sections,
    targetWords: Math.round(totalWords),
    assumptions: [
      `${sections} section(s) à rédiger, ${Math.round(totalWords).toLocaleString('fr-FR')} mots visés.`,
      `Scénario bas : 1 ronde de jury par chapitre ; moyen : ${Math.min(2, maxRounds)} ; haut : ${maxRounds} (maximum permis).`,
      `Recherche « ${depth} », ${parallelism} agent(s) en parallèle.`,
      'Coefficients à calibrer après les premières missions réelles ; la durée dépend de la vitesse des modèles.',
    ],
    computedAt: (i.now ?? (() => new Date().toISOString()))(),
  };
}

/** Coût restant projeté (§14.5.6) : phases non terminées du scénario, une fois les coûts réels connus. */
export function projectRemaining(
  est: CostEstimate,
  scenario: EstimateScenario,
  donePhases: readonly string[],
): { remainingUsd: number; remainingSec: number } {
  const left = est.phases.filter((p) => !donePhases.includes(p.phase));
  return {
    remainingUsd: round(left.reduce((s, p) => s + p.costUsd[scenario], 0)),
    remainingSec: Math.round(left.reduce((s, p) => s + p.durationSec[scenario], 0)),
  };
}

/** Vitesses de sortie mesurées (jetons/s) sur les appels réels de l'historique (`llm_calls`). */
export function measuredSpeeds(db: Db, minCalls: number): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT model, SUM(completion_tokens) AS tok, SUM(latency_ms) AS ms, COUNT(*) AS n
       FROM llm_calls WHERE status_code = 200 AND latency_ms > 0 AND completion_tokens > 0 GROUP BY model`,
    )
    .all() as { model: string; tok: number; ms: number; n: number }[];
  return new Map(rows.filter((r) => r.n >= minCalls).map((r) => [r.model, (r.tok * 1000) / r.ms]));
}
