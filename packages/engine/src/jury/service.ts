import {
  AppError,
  BriefSchema,
  WORK_TYPE_LABEL_FR,
  type AgentRole,
  type Brief,
  type JuryRemarkView,
  type JuryRoundView,
  type JuryScopeView,
  type JuryVerdict,
  type OutlineNodeView,
  type RemarkSeverity,
  type RevisionView,
  type SectionChecks,
} from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { MissionRepo } from '../storage/missions';
import type { EventJournal } from '../events/journal';
import type { ModelCaller } from '../llm/call-model';
import type { MissionExecConfig } from '../llm/exec-config';
import { writingUnits } from '../llm/estimate';
import { chapterGroups, type OutlineRepo } from '../planning/outline';
import type { ResearchService } from '../research/research-service';
import type { DataAnalysisService } from '../analysis/service';
import { runStructured } from '../agents/execute';
import { renderPrompt } from '../agents/prompts';
import type { SectionWriter } from '../writing/writer';
import { missionContext } from '../writing/context';
import { numbersToJustify } from '../writing/checks';
import type { WritingConfig } from '../writing/config';
import { markersOf, sentencesOf, stripMarkers, wordCount } from '../writing/text';
import { numberTokens } from '../util/numbers';
import type { JuryConfig } from './config';
import { consolidate, scoreJuror, verdictOf, type JurorResult } from './consolidate';
import { CrossSchema, HarmonizerSchema, JurorSchema, PresidentSchema } from './schemas';

export const JURY_PROMPT_VERSION = 'jury-1';
const FATAL = ['E_NO_CREDIT', 'E_BUDGET', 'E_NETWORK', 'E_KEY_INVALID', 'E_KEY_MISSING'];
const JURORS: AgentRole[] = ['juror_methodologist', 'juror_specialist', 'juror_form'];

type Scope = 'chapter' | 'global';
type PlanItem = {
  nodeId: string;
  actions: string[];
  severity: RemarkSeverity;
  needsResearch: boolean;
  query: string | null;
};
type Material = {
  portee: string;
  texte: string;
  index: { alias: string; nodeId: string; label: string }[];
  stats: string;
  contexte: string;
  /** Sections que le jury peut faire réviser. */
  revisable: string[];
};
type Round = {
  round: number;
  total: number;
  verdict: JuryVerdict;
  plan: PlanItem[];
  majeures: string[];
};

export type ScopeResult = {
  scope: Scope;
  targetId: string;
  status: 'valide' | 'accepte_avec_reserves';
  finalScore: number;
  rounds: number;
  reasons: string[];
};

const fmt = (n: number) => n.toFixed(1).replace('.', ',');

/**
 * Jury simulé et révisions (CdC §13) : jurés (grille §13.2, total recalculé par le code) → président (note, verdict, plan de révision)
 * → révisions ciblées avec recherche complémentaire → nouvelle évaluation, jusqu'au seuil, au plateau ou au maximum de rondes.
 * Chaque étape est enregistrée : une boucle interrompue reprend là où elle s'est arrêtée.
 */
export class JuryService {
  constructor(
    private readonly d: {
      db: Db;
      missions: MissionRepo;
      journal: EventJournal;
      caller: ModelCaller;
      outline: OutlineRepo;
      writer: SectionWriter;
      research: ResearchService;
      analysis: DataAnalysisService;
      cfg: JuryConfig;
      writing: WritingConfig;
    },
  ) {}

  private say(id: string, level: 'info' | 'success' | 'warning', role: AgentRole, msg: string) {
    this.d.journal.record({ missionId: id, level, agentRole: role, messageFr: msg });
  }

  private brief(id: string): Brief {
    const r = this.d.db.prepare('SELECT brief_json FROM missions WHERE id=?').get(id) as {
      brief_json: string | null;
    };
    return BriefSchema.parse(JSON.parse(r.brief_json ?? '{}'));
  }

  private threshold(brief: Brief, scope: Scope): number {
    if (brief.execution?.seuilJury) return brief.execution.seuilJury;
    return scope === 'chapter'
      ? this.d.cfg.thresholds.chapter
      : this.d.cfg.thresholds.global[brief.exigence];
  }

  private label(n: OutlineNodeView): string {
    return `${n.numbering ?? ''} ${n.title}`.trim();
  }

  // ------------------------------------------------------------------ matériau soumis au jury

  private sectionStats(nodeId: string): {
    line: string;
    groundingRate: number | null;
    removed: number;
  } {
    const r = this.d.db
      .prepare(
        `SELECT d.checks_json FROM drafts d WHERE d.id = COALESCE((SELECT current_version_id FROM outline_nodes WHERE id=?), (SELECT id FROM drafts WHERE outline_node_id=? ORDER BY version DESC LIMIT 1))`,
      )
      .get(nodeId, nodeId) as { checks_json: string | null } | undefined;
    const c = r?.checks_json ? (JSON.parse(r.checks_json) as SectionChecks) : null;
    if (!c) return { line: 'non rédigée', groundingRate: null, removed: 0 };
    return {
      line: `${c.wordsActual} mots (cible ${c.wordsTarget}), ancrage ${c.groundingRate === null ? 'sans objet' : `${Math.round(c.groundingRate * 100)} %`}, ${c.removed.length} phrase(s) supprimée(s) par le contrôle`,
      groundingRate: c.groundingRate,
      removed: c.removed.length,
    };
  }

  private context(missionId: string, nodes: OutlineNodeView[], brief: Brief): string {
    const a = this.d.analysis.get(missionId);
    return [
      missionContext(brief, nodes, this.d.writing.missionContextMaxChars),
      a
        ? `Résultats de terrain (${a.respondents} répondants) — statut des hypothèses : ${a.interpretation.hypotheses.map((h) => `${h.hypothese} → ${h.statut}`).join(' ; ') || 'aucune hypothèse'}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private chapterMaterial(missionId: string, chapterId: string): Material {
    const nodes = this.d.outline.list(missionId);
    const brief = this.brief(missionId);
    const g = chapterGroups(
      nodes,
      writingUnits(nodes).map((u) => u.node),
    ).find((x) => x.id === chapterId);
    if (!g) throw new AppError('E_INTERNAL', 'Chapitre introuvable.');
    const per = Math.floor(this.d.cfg.textCharsMax / Math.max(1, g.units.length));
    const index = g.units.map((u, i) => ({
      alias: `S${i + 1}`,
      nodeId: u.id,
      label: this.label(u),
    }));
    const parts = g.units.map((u, i) => {
      const t = this.d.writer.readableText(u.id);
      const md = t
        ? t.markdown.length > per
          ? `${t.markdown.slice(0, per)}\n[… texte tronqué pour tenir dans la fenêtre du modèle]`
          : t.markdown
        : '(non rédigée)';
      return `### S${i + 1} — ${this.label(u)}\n${md}`;
    });
    return {
      portee: `le chapitre « ${this.label(g.node)} »`,
      texte: parts.join('\n\n'),
      index,
      stats: index.map((x) => `${x.alias} : ${this.sectionStats(x.nodeId).line}`).join('\n'),
      contexte: this.context(missionId, nodes, brief),
      revisable: g.units.map((u) => u.id),
    };
  }

  private globalMaterial(missionId: string): Material {
    const nodes = this.d.outline.list(missionId);
    const brief = this.brief(missionId);
    const units = writingUnits(nodes).map((u) => u.node);
    const body = units.filter((u) => u.kind === 'corps');
    const general = units.filter((u) => u.kind !== 'corps');
    const index = units.map((u, i) => ({ alias: `S${i + 1}`, nodeId: u.id, label: this.label(u) }));
    const alias = new Map(index.map((x) => [x.nodeId, x.alias]));
    const summaries = body
      .map((u) => {
        const s = this.d.db
          .prepare(
            `SELECT d.summary FROM drafts d WHERE d.id = COALESCE((SELECT current_version_id FROM outline_nodes WHERE id=?), (SELECT id FROM drafts WHERE outline_node_id=? ORDER BY version DESC LIMIT 1))`,
          )
          .get(u.id, u.id) as { summary: string | null } | undefined;
        return `${alias.get(u.id)} — ${this.label(u)} : ${s?.summary ?? '(pas de résumé)'}`;
      })
      .join('\n');
    // Échantillon (§13.5) : les moins bien notées (note de leur chapitre, puis taux d'ancrage) + quelques-unes tirées de façon reproductible.
    const chapterScore = new Map<string, number>();
    for (const g of chapterGroups(nodes, units)) {
      const o = this.d.db
        .prepare(
          "SELECT final_score FROM review_outcomes WHERE mission_id=? AND scope='chapter' AND target_id=?",
        )
        .get(missionId, g.id) as { final_score: number } | undefined;
      for (const u of g.units) chapterScore.set(u.id, o?.final_score ?? 20);
    }
    const ranked = [...body].sort(
      (a, b) =>
        (chapterScore.get(a.id) ?? 20) - (chapterScore.get(b.id) ?? 20) ||
        (this.sectionStats(a.id).groundingRate ?? 1) - (this.sectionStats(b.id).groundingRate ?? 1),
    );
    const lowest = ranked.slice(0, this.d.cfg.globalSample.lowest);
    const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const random = ranked
      .slice(this.d.cfg.globalSample.lowest)
      .sort((a, b) => hash(a.id) - hash(b.id))
      .slice(0, this.d.cfg.globalSample.random);
    const per = Math.floor(
      this.d.cfg.textCharsMax / Math.max(1, general.length + lowest.length + random.length),
    );
    const full = (u: OutlineNodeView) => {
      const t = this.d.writer.readableText(u.id);
      return `### ${alias.get(u.id)} — ${this.label(u)}\n${t ? t.markdown.slice(0, per) : '(non rédigée)'}`;
    };
    const srcStats = this.d.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN verification_status IN ('verified','partially_verified') THEN 1 ELSE 0 END) AS verified, SUM(CASE WHEN used_in_text>0 THEN 1 ELSE 0 END) AS used FROM sources WHERE mission_id=?`,
      )
      .get(missionId) as { total: number; verified: number | null; used: number | null };
    const rates = body
      .map((u) => this.sectionStats(u.id).groundingRate)
      .filter((x): x is number => x !== null);
    const words = (u: OutlineNodeView) =>
      this.d.writer.readableText(u.id) ? wordCount(this.d.writer.readableText(u.id)!.markdown) : 0;
    return {
      portee: 'l’ensemble du travail',
      texte: [
        `## Résumés de toutes les sections\n${summaries}`,
        `## Introduction et conclusion générales\n${general.map(full).join('\n\n')}`,
        `## Échantillon de sections (les moins bien notées, puis quelques autres)\n${[...lowest, ...random].map(full).join('\n\n')}`,
      ].join('\n\n'),
      index,
      stats: [
        `Sources : ${srcStats.total} trouvées, ${srcStats.verified ?? 0} vérifiées, ${srcStats.used ?? 0} citées dans le texte.`,
        `Ancrage moyen des sections : ${rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : '—'} %.`,
        `Équilibre des parties (mots) : ${chapterGroups(nodes, units)
          .map((g) => `${this.label(g.node)} ${g.units.reduce((s, u) => s + words(u), 0)}`)
          .join(' ; ')}.`,
      ].join('\n'),
      contexte: this.context(missionId, nodes, brief),
      revisable: body.map((u) => u.id),
    };
  }

  // ------------------------------------------------------------------ une évaluation

  private storedRounds(missionId: string, scope: Scope, targetId: string): Round[] {
    const rows = this.d.db
      .prepare(
        `SELECT round, total_score, verdict, comments_json FROM jury_reviews WHERE mission_id=? AND scope=? AND COALESCE(target_id,'')=? AND juror_role='jury_president' ORDER BY round`,
      )
      .all(missionId, scope, targetId) as {
      round: number;
      total_score: number;
      verdict: JuryVerdict;
      comments_json: string;
    }[];
    return rows.map((r) => {
      const c = JSON.parse(r.comments_json) as { plan: PlanItem[]; majeures: string[] };
      return {
        round: r.round,
        total: r.total_score,
        verdict: r.verdict,
        plan: c.plan,
        majeures: c.majeures,
      };
    });
  }

  private async evaluate(
    missionId: string,
    scope: Scope,
    targetId: string,
    round: number,
    mat: Material,
    threshold: number,
    title: string,
    signal?: AbortSignal,
  ): Promise<Round> {
    const brief = this.brief(missionId);
    const base = {
      portee: mat.portee,
      type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
      discipline: brief.discipline,
      titre: brief.titre,
      contexte: mat.contexte,
      index: mat.index.map((x) => `${x.alias} : ${x.label}`).join('\n'),
      stats: mat.stats,
      texte: mat.texte,
    };
    const settled = await Promise.allSettled(
      JURORS.map(async (role) => {
        const mine = this.d.cfg.criteria.filter((c) => c.jurors.includes(role));
        const r = await runStructured(this.d.caller, {
          missionId,
          taskId: null,
          role,
          label: `jury:${role}`,
          messages: [
            {
              role: 'system',
              content: renderPrompt('jury/juror', {
                ...base,
                role_label: this.d.cfg.jurors[role]?.label ?? role,
                focus: this.d.cfg.jurors[role]?.focus ?? '',
                criteres: mine.map((c) => `- ${c.id} : ${c.label} (${c.points} points)`).join('\n'),
              }),
            },
            { role: 'user', content: 'Évalue.' },
          ],
          schema: JurorSchema,
          schemaName: 'evaluation_jure',
          temperature: 0.3,
          promptVersion: JURY_PROMPT_VERSION,
          signal,
        });
        return { role, out: r.output };
      }),
    );
    const done: { role: AgentRole; out: import('./schemas').JurorOutput }[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') done.push(s.value);
      else if (s.reason instanceof AppError && FATAL.includes(s.reason.code)) throw s.reason;
      else
        this.say(
          missionId,
          'warning',
          'jury_president',
          `Un juré n’a pas rendu d’évaluation exploitable pour ${title} : son avis est écarté.`,
        );
    }
    if (!done.length) throw new AppError('E_SCHEMA');
    const results: JurorResult[] = done.map((x) => scoreJuror(x.role, x.out, this.d.cfg.criteria));
    const cons = consolidate(results, this.d.cfg.criteria);
    const verdict = verdictOf(cons.total, threshold, this.d.cfg);

    // Remarques : identifiants uniques, section résolue par le code (alias → nœud) ; remarque sans section valide = rattachée à nulle part.
    const alias = new Map(mat.index.map((x) => [x.alias, x.nodeId]));
    let rid = 0;
    const remarks = done.flatMap((x) =>
      x.out.remarques.map((r) => ({
        role: x.role,
        view: {
          id: `R${++rid}`,
          nodeId: alias.get(r.section_id.trim().toUpperCase()) ?? null,
          location: r.localisation,
          problem: r.probleme,
          expected: r.correction_attendue,
          severity: r.gravite as RemarkSeverity,
          needsResearch: r.besoin_recherche,
          query: r.requete_suggeree ?? null,
        } satisfies JuryRemarkView,
      })),
    );
    const label = new Map(mat.index.map((x) => [x.nodeId, x.label]));
    const remarkText = remarks
      .map(
        (r) =>
          `${r.view.id} [${[...alias].find(([, n]) => n === r.view.nodeId)?.[0] ?? '?'}, ${r.view.severity}] ${r.view.problem} → ${r.view.expected}`,
      )
      .join('\n');

    // Écart de plus de 4 points entre jurés : justification croisée avant de trancher (§13.3).
    let cross: string | null = null;
    if (cons.spread > this.d.cfg.spreadMax) {
      try {
        const c = await runStructured(this.d.caller, {
          missionId,
          taskId: null,
          role: 'jury_president',
          label: 'jury:justification',
          messages: [
            {
              role: 'system',
              content: renderPrompt('jury/cross', {
                ecart: this.d.cfg.spreadMax,
                notes: results
                  .map((r) => `${this.d.cfg.jurors[r.role]?.label ?? r.role} ${fmt(r.total)}`)
                  .join(', '),
                evaluations: results
                  .map(
                    (r) =>
                      `${this.d.cfg.jurors[r.role]?.label ?? r.role} (${fmt(r.total)}/20) : ${r.scores.map((s) => `${s.id} ${s.note ?? 'n.a.'}/${s.max} — ${s.justification}`).join(' ; ')}`,
                  )
                  .join('\n'),
              }),
            },
            { role: 'user', content: 'Justifie.' },
          ],
          schema: CrossSchema,
          schemaName: 'justification_croisee',
          temperature: 0.2,
          promptVersion: JURY_PROMPT_VERSION,
          signal,
        });
        cross = c.output.justification;
      } catch (e) {
        if (e instanceof AppError && FATAL.includes(e.code)) throw e;
      }
    }

    // Président : synthèse et plan de révision ; repli déterministe (regroupement des remarques par section) si la sortie est inexploitable.
    let synthese = '';
    let plan: PlanItem[] = [];
    try {
      const p = await runStructured(this.d.caller, {
        missionId,
        taskId: null,
        role: 'jury_president',
        label: 'jury:president',
        messages: [
          {
            role: 'system',
            content: renderPrompt('jury/president', {
              portee: mat.portee,
              type_travail: base.type_travail,
              titre: brief.titre,
              note: fmt(cons.total),
              seuil: threshold,
              verdict:
                verdict === 'valide'
                  ? 'validé'
                  : verdict === 'a_reviser'
                    ? 'à réviser'
                    : 'à réécrire',
              evaluations: results
                .map(
                  (r) =>
                    `${this.d.cfg.jurors[r.role]?.label ?? r.role} (${fmt(r.total)}/20) : ${r.scores.map((s) => `${s.id} ${s.note ?? 'n.a.'}/${s.max}`).join(', ')}`,
                )
                .join('\n'),
              remarques: remarkText || '(aucune remarque)',
              index: base.index,
            }),
          },
          { role: 'user', content: 'Établis le plan de révision.' },
        ],
        schema: PresidentSchema,
        schemaName: 'plan_revision',
        temperature: 0.2,
        promptVersion: JURY_PROMPT_VERSION,
        signal,
      });
      synthese = p.output.synthese;
      plan = p.output.plan.flatMap((x) => {
        const nodeId = alias.get(x.section_id.trim().toUpperCase());
        return nodeId
          ? [
              {
                nodeId,
                actions: x.actions,
                severity: x.priorite as RemarkSeverity,
                needsResearch: x.besoin_recherche,
                query: x.requete_suggeree ?? null,
              },
            ]
          : [];
      });
    } catch (e) {
      if (e instanceof AppError && FATAL.includes(e.code)) throw e;
    }
    if (!plan.length && remarks.some((r) => r.view.nodeId)) {
      const order: RemarkSeverity[] = ['majeure', 'mineure', 'suggestion'];
      const by = new Map<string, PlanItem>();
      for (const r of remarks) {
        if (!r.view.nodeId) continue;
        const cur = by.get(r.view.nodeId) ?? {
          nodeId: r.view.nodeId,
          actions: [],
          severity: 'suggestion' as RemarkSeverity,
          needsResearch: false,
          query: null,
        };
        cur.actions.push(r.view.expected || r.view.problem);
        if (order.indexOf(r.view.severity) < order.indexOf(cur.severity))
          cur.severity = r.view.severity;
        if (r.view.needsResearch) {
          cur.needsResearch = true;
          cur.query = cur.query ?? r.view.query;
        }
        by.set(r.view.nodeId, cur);
      }
      plan = [...by.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
    }
    plan.sort(
      (a, b) =>
        ['majeure', 'mineure', 'suggestion'].indexOf(a.severity) -
        ['majeure', 'mineure', 'suggestion'].indexOf(b.severity),
    );
    const majeures = plan
      .filter((p) => p.severity === 'majeure')
      .flatMap((p) => p.actions.map((a) => `${label.get(p.nodeId) ?? ''} : ${a}`));

    const t = nowIso();
    this.d.db.transaction(() => {
      const ins = this.d.db.prepare(
        `INSERT INTO jury_reviews(id,mission_id,scope,target_id,round,juror_role,scores_json,total_score,verdict,comments_json,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const model = this.d.missions.config<MissionExecConfig>(missionId).models;
      for (const x of done) {
        const res = results.find((r) => r.role === x.role)!;
        ins.run(
          newId(),
          missionId,
          scope,
          targetId,
          round,
          x.role,
          JSON.stringify(res.scores),
          res.total,
          verdictOf(res.total, threshold, this.d.cfg),
          JSON.stringify({
            strengths: x.out.points_forts,
            remarks: remarks.filter((r) => r.role === x.role).map((r) => r.view),
            warnings: res.warnings,
          }),
          model[x.role] ?? null,
          t,
          t,
        );
      }
      ins.run(
        newId(),
        missionId,
        scope,
        targetId,
        round,
        'jury_president',
        JSON.stringify(cons.criteria),
        cons.total,
        verdict,
        JSON.stringify({ synthese, plan, majeures, cross, threshold }),
        model.jury_president ?? null,
        t,
        t,
      );
    })();
    this.say(
      missionId,
      verdict === 'valide' ? 'success' : 'warning',
      'jury_president',
      `Jury : ${title} noté ${fmt(cons.total)}/20 — ${verdict === 'valide' ? 'validé' : verdict === 'a_reviser' ? 'à réviser' : 'à réécrire'}${majeures.length ? ` (${majeures.length} remarque(s) majeure(s))` : ''}.`,
    );
    return { round, total: cons.total, verdict, plan, majeures };
  }

  // ------------------------------------------------------------------ recherche complémentaire ciblée (P3 réduit)

  private async supplement(
    missionId: string,
    nodeId: string,
    query: string,
    round: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const node = this.d.outline.list(missionId).find((n) => n.id === nodeId)!;
    const brief = this.brief(missionId);
    const key = `${nodeId}:suppl:${round}`;
    const r = await this.d.research.researchSection({
      missionId,
      sectionKey: key,
      title: node.title,
      objective: query,
      keyQuestions: [query],
      workType: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
      discipline: brief.discipline,
      depth: 'rapide',
      minSources: 1,
      prioriteAfrique: brief.execution?.preferenceSources === 'afrique',
      signal,
    });
    // Les nouvelles sources s'ajoutent à celles de la section ; rien n'est retiré.
    this.d.db.transaction(() => {
      this.d.db
        .prepare(
          `INSERT OR IGNORE INTO section_sources(mission_id,section_key,source_id,relevance,rank,created_at)
           SELECT mission_id, ?, source_id, relevance, COALESCE(rank,0)+100, created_at FROM section_sources WHERE mission_id=? AND section_key=?`,
        )
        .run(nodeId, missionId, key);
      this.d.db
        .prepare('DELETE FROM section_sources WHERE mission_id=? AND section_key=?')
        .run(missionId, key);
      this.d.db
        .prepare('UPDATE OR IGNORE reading_notes SET section_key=? WHERE section_key=?')
        .run(nodeId, key);
      this.d.db.prepare('DELETE FROM reading_notes WHERE section_key=?').run(key);
    })();
    this.say(
      missionId,
      'info',
      'researcher',
      `Chercheur : recherche complémentaire pour ${this.label(node)} (${r.retained.length} source(s) retenue(s)).`,
    );
  }

  // ------------------------------------------------------------------ révisions d'une ronde

  private revisionRows(missionId: string, scope: Scope, targetId: string, round: number) {
    return this.d.db
      .prepare(
        `SELECT id, node_id, from_draft_id, to_draft_id FROM revision_log WHERE mission_id=? AND scope=? AND target_id=? AND round=? AND kind='revision'`,
      )
      .all(missionId, scope, targetId, round) as {
      id: string;
      node_id: string;
      from_draft_id: string | null;
      to_draft_id: string | null;
    }[];
  }

  private async reviseRound(
    missionId: string,
    scope: Scope,
    targetId: string,
    round: number,
    prev: Round,
    revisable: Set<string>,
    signal?: AbortSignal,
  ): Promise<number> {
    const severities = new Set(this.d.cfg.revisionSeverities);
    const items = prev.plan.filter((p) => revisable.has(p.nodeId) && severities.has(p.severity));
    if (!items.length) return 0;
    // Recherche complémentaire (remarques majeures qui l'exigent), plafonnée par ronde.
    let researched = 0;
    for (const it of items.filter((x) => x.needsResearch && x.severity === 'majeure')) {
      if (researched >= this.d.cfg.maxResearchPerRound) break;
      researched++;
      try {
        await this.supplement(missionId, it.nodeId, it.query ?? it.actions[0]!, round, signal);
      } catch (e) {
        if (e instanceof AppError && FATAL.includes(e.code)) throw e;
        this.say(
          missionId,
          'warning',
          'researcher',
          'Une recherche complémentaire a échoué : la révision se poursuit avec les sources déjà retenues.',
        );
      }
    }
    const cfg = this.d.missions.config<MissionExecConfig>(missionId);
    const limit = Math.max(1, Math.min(cfg.parallelism || 3, 4));
    let revised = 0;
    const queue = [...items];
    const nodes = this.d.outline.list(missionId);
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        const node = nodes.find((n) => n.id === it.nodeId)!;
        const from = this.d.db
          .prepare('SELECT current_version_id AS c FROM outline_nodes WHERE id=?')
          .get(it.nodeId) as { c: string | null };
        try {
          const res = await this.d.writer.reviseSection(
            missionId,
            it.nodeId,
            it.actions.map((a) => ({ severity: it.severity, problem: a, expected: a })),
            round,
            signal,
            prev.verdict === 'a_reecrire',
          );
          this.d.db
            .prepare(
              `INSERT INTO revision_log(id,mission_id,scope,target_id,round,kind,node_id,from_draft_id,to_draft_id,remarks_json,outcome,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              newId(),
              missionId,
              scope,
              targetId,
              round,
              'revision',
              it.nodeId,
              from.c,
              res.draftId,
              JSON.stringify(it.actions),
              'kept',
              nowIso(),
            );
          revised++;
        } catch (e) {
          if (e instanceof AppError && FATAL.includes(e.code)) throw e;
          this.say(
            missionId,
            'warning',
            'section_writer',
            `Rédacteur : la révision de ${this.label(node)} n’a pas abouti (${e instanceof AppError ? e.messageFr : 'erreur'}) ; la version actuelle est conservée.`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
    return revised;
  }

  // ------------------------------------------------------------------ boucle de révision (§13.4, §13.5)

  private finalize(
    missionId: string,
    scope: Scope,
    targetId: string,
    title: string,
    threshold: number,
    final: Round,
    rounds: number,
    cause: string,
    nodeIds: string[],
  ): ScopeResult {
    const ok = final.total >= threshold;
    const reasons = ok
      ? []
      : [
          `Note finale ${fmt(final.total)}/20 inférieure au seuil de ${threshold} (${cause}).`,
          ...final.majeures.slice(0, 8),
        ];
    this.d.db
      .prepare(
        `INSERT OR REPLACE INTO review_outcomes(mission_id,scope,target_id,status,final_score,rounds,reasons_json,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        missionId,
        scope,
        targetId,
        ok ? 'valide' : 'accepte_avec_reserves',
        final.total,
        rounds,
        JSON.stringify(reasons),
        nowIso(),
      );
    for (const id of nodeIds)
      this.d.db
        .prepare("UPDATE outline_nodes SET status='validated', updated_at=? WHERE id=?")
        .run(nowIso(), id);
    this.say(
      missionId,
      ok ? 'success' : 'warning',
      'jury_president',
      ok
        ? `Jury : ${title} validé (${fmt(final.total)}/20 après ${rounds} ronde(s) de révision).`
        : `Jury : ${title} accepté avec réserves (${fmt(final.total)}/20, seuil ${threshold}) — ${cause}.`,
    );
    return {
      scope,
      targetId,
      status: ok ? 'valide' : 'accepte_avec_reserves',
      finalScore: final.total,
      rounds,
      reasons,
    };
  }

  private async loop(
    missionId: string,
    scope: Scope,
    targetId: string,
    title: string,
    maxRounds: number,
    material: () => Material,
    signal?: AbortSignal,
  ): Promise<ScopeResult> {
    const brief = this.brief(missionId);
    const threshold = this.threshold(brief, scope);
    const done = this.d.db
      .prepare(
        'SELECT status, final_score, rounds, reasons_json FROM review_outcomes WHERE mission_id=? AND scope=? AND target_id=?',
      )
      .get(missionId, scope, targetId) as
      | { status: ScopeResult['status']; final_score: number; rounds: number; reasons_json: string }
      | undefined;
    if (done)
      return {
        scope,
        targetId,
        status: done.status,
        finalScore: done.final_score,
        rounds: done.rounds,
        reasons: JSON.parse(done.reasons_json) as string[],
      };

    let rounds = this.storedRounds(missionId, scope, targetId);
    let mat = material();
    const evalAt = async (k: number) => {
      mat = material();
      const r = await this.evaluate(missionId, scope, targetId, k, mat, threshold, title, signal);
      rounds = [...rounds, r];
      return r;
    };
    if (!rounds.length) await evalAt(0);
    for (;;) {
      const last = rounds.at(-1)!;
      const k = last.round;
      const revisable = new Set(mat.revisable);
      if (last.total >= threshold)
        return this.finalize(
          missionId,
          scope,
          targetId,
          title,
          threshold,
          last,
          k,
          '',
          mat.revisable,
        );
      if (k >= maxRounds)
        return this.finalize(
          missionId,
          scope,
          targetId,
          title,
          threshold,
          last,
          k,
          'nombre maximal de rondes atteint',
          mat.revisable,
        );
      const existing = this.revisionRows(missionId, scope, targetId, k + 1);
      if (!existing.length) {
        const n = await this.reviseRound(
          missionId,
          scope,
          targetId,
          k + 1,
          last,
          revisable,
          signal,
        );
        if (!n)
          return this.finalize(
            missionId,
            scope,
            targetId,
            title,
            threshold,
            last,
            k,
            'aucune révision possible',
            mat.revisable,
          );
      }
      const next = await evalAt(k + 1);
      // Une révision ne doit pas dégrader (§13.4) : on rétablit les versions précédentes et on garde l'ancienne note.
      if (next.total < last.total) {
        for (const r of this.revisionRows(missionId, scope, targetId, k + 1)) {
          if (r.from_draft_id) this.d.writer.setCurrent(r.node_id, r.from_draft_id);
          this.d.db.prepare("UPDATE revision_log SET outcome='reverted' WHERE id=?").run(r.id);
        }
        this.say(
          missionId,
          'warning',
          'jury_president',
          `Jury : la révision de ${title} a fait baisser la note (${fmt(last.total)} → ${fmt(next.total)}) : versions précédentes conservées.`,
        );
        return this.finalize(
          missionId,
          scope,
          targetId,
          title,
          threshold,
          last,
          k,
          'la révision dégradait le texte, versions précédentes conservées',
          mat.revisable,
        );
      }
      if (next.total - last.total < this.d.cfg.gainMinimal && next.total < threshold) {
        this.say(
          missionId,
          'info',
          'jury_president',
          `Jury : plateau atteint pour ${title} (gain de ${fmt(next.total - last.total)} point).`,
        );
        return this.finalize(
          missionId,
          scope,
          targetId,
          title,
          threshold,
          next,
          k + 1,
          'plateau atteint (gain inférieur au minimum)',
          mat.revisable,
        );
      }
    }
  }

  /** P6 : évaluation et révision d'un chapitre. */
  async reviewChapter(
    missionId: string,
    chapterId: string,
    signal?: AbortSignal,
  ): Promise<ScopeResult> {
    const nodes = this.d.outline.list(missionId);
    const node = nodes.find((n) => n.id === chapterId);
    if (!node) throw new AppError('E_INTERNAL', 'Chapitre introuvable.');
    const brief = this.brief(missionId);
    return this.loop(
      missionId,
      'chapter',
      chapterId,
      `le chapitre « ${this.label(node)} »`,
      brief.execution?.rondesMaxParChapitre ?? 3,
      () => this.chapterMaterial(missionId, chapterId),
      signal,
    );
  }

  // ------------------------------------------------------------------ harmonisation et évaluation globale (P7)

  async harmonize(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<{ applied: number; rejected: number }> {
    const had = this.d.db
      .prepare("SELECT COUNT(*) AS n FROM revision_log WHERE mission_id=? AND kind='harmonisation'")
      .get(missionId) as { n: number };
    const flag = this.d.db
      .prepare(
        "SELECT 1 FROM review_outcomes WHERE mission_id=? AND scope='global' AND target_id=''",
      )
      .get(missionId);
    if (had.n || flag) return { applied: 0, rejected: 0 };
    const nodes = this.d.outline.list(missionId);
    const brief = this.brief(missionId);
    const units = writingUnits(nodes).map((u) => u.node);
    const alias = new Map(units.map((u, i) => [`S${i + 1}`, u]));
    const aliasOf = new Map(units.map((u, i) => [u.id, `S${i + 1}`]));
    const lines = units
      .filter((u) => u.kind === 'corps')
      .map((u) => {
        const t = this.d.writer.readableText(u.id);
        const ss = t ? sentencesOf(t.markdown) : [];
        const sum = this.d.db
          .prepare(
            `SELECT d.summary FROM drafts d WHERE d.id = (SELECT current_version_id FROM outline_nodes WHERE id=?)`,
          )
          .get(u.id) as { summary: string | null } | undefined;
        return `${aliasOf.get(u.id)} | ${u.numbering ?? ''} | ${u.title} | ${(sum?.summary ?? '').slice(0, 300)} | première : ${ss[0] ? stripMarkers(ss[0].text) : ''} | dernière : ${ss.at(-1) ? stripMarkers(ss.at(-1)!.text) : ''}`;
      });
    const generales = units
      .filter((u) => u.kind !== 'corps')
      .map(
        (u) =>
          `### ${aliasOf.get(u.id)} — ${this.label(u)}\n${this.d.writer.readableText(u.id)?.markdown ?? ''}`,
      )
      .join('\n\n');
    let mods: import('./schemas').HarmonizerOutput['modifications'] = [];
    try {
      const r = await runStructured(this.d.caller, {
        missionId,
        taskId: null,
        role: 'harmonizer',
        label: 'jury:harmonisation',
        messages: [
          {
            role: 'system',
            content: renderPrompt('harmonizer/harmonize', {
              type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
              titre: brief.titre,
              problematique: brief.problematique ?? '(à définir)',
              sections: lines.join('\n'),
              generales: generales.slice(0, this.d.cfg.textCharsMax / 2),
              max_modifications: 12,
              mots_max: this.d.cfg.harmonizerWordsMax,
            }),
          },
          { role: 'user', content: 'Harmonise.' },
        ],
        schema: HarmonizerSchema,
        schemaName: 'harmonisation',
        temperature: 0.3,
        promptVersion: JURY_PROMPT_VERSION,
        signal,
      });
      mods = r.output.modifications;
    } catch (e) {
      if (e instanceof AppError && FATAL.includes(e.code)) throw e;
    }

    // Chaque modification est contrôlée par le code avant d'être appliquée : phrase existante recopiée à l'identique et sans citation,
    // texte de remplacement sans marqueur, sans guillemets, sans nombre nouveau et court (le texte sourcé ne bouge jamais ici).
    const edits = new Map<string, string>();
    const applied = new Map<string, string[]>();
    let rejected = 0;
    for (const m of mods) {
      const node = alias.get(m.section_id.trim().toUpperCase());
      if (!node || node.kind !== 'corps') {
        rejected++;
        continue;
      }
      const original = this.d.db
        .prepare(
          'SELECT markdown FROM drafts WHERE id=(SELECT current_version_id FROM outline_nodes WHERE id=?)',
        )
        .get(node.id) as { markdown: string } | undefined;
      let md = edits.get(node.id) ?? original?.markdown ?? '';
      const apres = m.apres.trim();
      const tooLong = apres.split(/\s+/).length > this.d.cfg.harmonizerWordsMax;
      const avantNums = new Set(numberTokens(m.avant ?? '').map((x) => x.canon));
      const newNums = numbersToJustify(apres).filter(
        (n) =>
          !avantNums.has(n.canon) &&
          !(Number.isInteger(Number(n.canon)) && Number(n.canon) <= this.d.writing.smallIntMax),
      );
      if (tooLong || /\[@|«|»|\{\{/.test(apres) || newNums.length) {
        rejected++;
        continue;
      }
      const ss = sentencesOf(md);
      if (m.avant) {
        const target = ss.find(
          (s) => stripMarkers(s.text).replace(/\s+/g, ' ') === m.avant!.replace(/\s+/g, ' ').trim(),
        );
        if (!target || markersOf(target.text).valid.length) {
          rejected++;
          continue;
        }
        md = md.slice(0, target.start) + apres + md.slice(target.end);
      } else if (m.type === 'transition' || m.type === 'fil_conducteur') {
        const lastS = ss.at(-1);
        if (!lastS) {
          rejected++;
          continue;
        }
        md = `${md.slice(0, lastS.end)} ${apres}${md.slice(lastS.end)}`;
      } else {
        rejected++;
        continue;
      }
      edits.set(node.id, md);
      applied.set(node.id, [
        ...(applied.get(node.id) ?? []),
        `${m.type} : ${m.justification || apres}`,
      ]);
    }
    for (const [nodeId, md] of edits) {
      const from = this.d.db
        .prepare('SELECT current_version_id AS c FROM outline_nodes WHERE id=?')
        .get(nodeId) as { c: string | null };
      const saved = this.d.writer.saveEditedVersion(
        nodeId,
        md,
        `Harmonisation : ${applied.get(nodeId)!.length} modification(s) ciblée(s).`,
        'harmonizer',
      );
      if (saved)
        this.d.db
          .prepare(
            `INSERT INTO revision_log(id,mission_id,scope,target_id,round,kind,node_id,from_draft_id,to_draft_id,remarks_json,outcome,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            newId(),
            missionId,
            'global',
            '',
            0,
            'harmonisation',
            nodeId,
            from.c,
            saved.draftId,
            JSON.stringify(applied.get(nodeId)),
            'kept',
            nowIso(),
          );
    }
    const n = [...applied.values()].reduce((s, a) => s + a.length, 0);
    this.say(
      missionId,
      n ? 'success' : 'info',
      'harmonizer',
      `Harmonisateur : ${n} modification(s) ciblée(s) appliquée(s)${rejected ? `, ${rejected} écartée(s) par les contrôles` : ''}.`,
    );
    return { applied: n, rejected };
  }

  /** P7 : évaluation globale (rondes permises par `rondesMaxGlobales`) après harmonisation. */
  async reviewGlobal(missionId: string, signal?: AbortSignal): Promise<ScopeResult | null> {
    const brief = this.brief(missionId);
    const max = brief.execution?.rondesMaxGlobales ?? 2;
    if (max <= 0) return null;
    return this.loop(
      missionId,
      'global',
      '',
      'l’ensemble du travail',
      max,
      () => this.globalMaterial(missionId),
      signal,
    );
  }

  /** P7.4 : introduction, conclusion, résumé et abstract mis à jour à partir de la version finale (seulement si le texte a changé). */
  async refreshFinal(missionId: string, signal?: AbortSignal): Promise<boolean> {
    const changed = this.d.db
      .prepare(
        `SELECT COUNT(*) AS n FROM drafts d JOIN outline_nodes n ON n.id=d.outline_node_id WHERE n.mission_id=? AND d.id=n.current_version_id AND d.version>1 AND n.kind='corps'`,
      )
      .get(missionId) as { n: number };
    if (!changed.n) return false;
    const gen = this.d.outline
      .list(missionId)
      .filter(
        (n) =>
          n.kind !== 'corps' &&
          !this.d.outline.list(missionId).some((c) => c.parentId === n.id && false),
      );
    for (const g of gen) await this.d.writer.writeGeneral(missionId, g.id, signal, true);
    await this.d.writer.writeFrontMatter(missionId, signal, true);
    this.say(
      missionId,
      'success',
      'section_writer',
      'Rédacteur : introduction, conclusion et résumé mis à jour d’après la version finale.',
    );
    return true;
  }

  // ------------------------------------------------------------------ lecture pour l'interface

  view(missionId: string): JuryScopeView[] {
    const nodes = this.d.outline.list(missionId);
    const brief = this.brief(missionId);
    const units = writingUnits(nodes).map((u) => u.node);
    const label = (id: string) => {
      const n = nodes.find((x) => x.id === id);
      return n ? this.label(n) : '';
    };
    const versionOf = (draftId: string | null) =>
      draftId
        ? ((
            this.d.db.prepare('SELECT version FROM drafts WHERE id=?').get(draftId) as
              { version: number } | undefined
          )?.version ?? null)
        : null;
    const scopes: { scope: Scope; id: string; title: string; maxRounds: number }[] = [
      ...chapterGroups(nodes, units).map((g) => ({
        scope: 'chapter' as const,
        id: g.id,
        title: this.label(g.node),
        maxRounds: brief.execution?.rondesMaxParChapitre ?? 3,
      })),
      {
        scope: 'global',
        id: '',
        title: 'Ensemble du travail',
        maxRounds: brief.execution?.rondesMaxGlobales ?? 2,
      },
    ];
    const out: JuryScopeView[] = [];
    for (const s of scopes) {
      const rows = this.d.db
        .prepare(
          `SELECT round, juror_role, scores_json, total_score, verdict, comments_json FROM jury_reviews WHERE mission_id=? AND scope=? AND COALESCE(target_id,'')=? ORDER BY round, juror_role`,
        )
        .all(missionId, s.scope, s.id) as {
        round: number;
        juror_role: AgentRole;
        scores_json: string;
        total_score: number;
        verdict: JuryVerdict;
        comments_json: string;
      }[];
      const revs = this.d.db
        .prepare(
          `SELECT round, kind, node_id, from_draft_id, to_draft_id, remarks_json, outcome FROM revision_log WHERE mission_id=? AND ((scope=? AND target_id=?) OR (?='global' AND kind='harmonisation' AND scope='global')) ORDER BY round`,
        )
        .all(missionId, s.scope, s.id, s.scope) as {
        round: number;
        kind: 'revision' | 'harmonisation';
        node_id: string;
        from_draft_id: string | null;
        to_draft_id: string | null;
        remarks_json: string;
        outcome: 'kept' | 'reverted';
      }[];
      const toRev = (r: (typeof revs)[number]): RevisionView => ({
        nodeId: r.node_id,
        label: label(r.node_id),
        kind: r.kind,
        fromVersion: versionOf(r.from_draft_id),
        toVersion: versionOf(r.to_draft_id),
        outcome: r.outcome,
        remarks: JSON.parse(r.remarks_json) as string[],
      });
      const threshold = this.threshold(brief, s.scope);
      const roundNums = [...new Set(rows.map((r) => r.round))];
      const rounds: JuryRoundView[] = roundNums.map((k) => {
        const pres = rows.find((r) => r.round === k && r.juror_role === 'jury_president')!;
        const c = JSON.parse(pres.comments_json) as {
          synthese: string;
          plan: PlanItem[];
          cross: string | null;
        };
        const crit = JSON.parse(pres.scores_json) as {
          id: string;
          avg: number | null;
          max: number;
        }[];
        return {
          round: k,
          total: pres.total_score,
          verdict: pres.verdict,
          criteria: crit.map((x) => ({
            ...x,
            label: this.d.cfg.criteria.find((cc) => cc.id === x.id)?.label ?? x.id,
          })),
          jurors: rows
            .filter((r) => r.round === k && r.juror_role !== 'jury_president')
            .map((r) => {
              const cm = JSON.parse(r.comments_json) as {
                strengths: string[];
                remarks: JuryRemarkView[];
              };
              return {
                role: r.juror_role,
                roleLabel: this.d.cfg.jurors[r.juror_role]?.label ?? r.juror_role,
                scores: (
                  JSON.parse(r.scores_json) as {
                    id: string;
                    note: number | null;
                    max: number;
                    justification: string;
                  }[]
                ).map((x) => ({
                  ...x,
                  label: this.d.cfg.criteria.find((cc) => cc.id === x.id)?.label ?? x.id,
                })),
                total: r.total_score,
                strengths: cm.strengths,
                remarks: cm.remarks,
              };
            }),
          synthesis: c.synthese,
          crossJustification: c.cross,
          plan: c.plan.map((p) => ({
            nodeId: p.nodeId,
            label: label(p.nodeId),
            actions: p.actions,
            severity: p.severity,
            needsResearch: p.needsResearch,
          })),
          revisions: revs.filter((r) => r.kind === 'revision' && r.round === k + 1).map(toRev),
        };
      });
      const outcome = this.d.db
        .prepare(
          'SELECT status, final_score, reasons_json FROM review_outcomes WHERE mission_id=? AND scope=? AND target_id=?',
        )
        .get(missionId, s.scope, s.id) as
        | { status: 'valide' | 'accepte_avec_reserves'; final_score: number; reasons_json: string }
        | undefined;
      if (!rounds.length && !outcome && s.scope === 'global' && !revs.length) continue;
      out.push({
        scope: s.scope,
        targetId: s.id,
        title: s.title,
        threshold,
        maxRounds: s.maxRounds,
        rounds,
        status: outcome?.status ?? 'en_cours',
        finalScore: outcome?.final_score ?? null,
        reasons: outcome ? (JSON.parse(outcome.reasons_json) as string[]) : [],
        harmonisation:
          s.scope === 'global' ? revs.filter((r) => r.kind === 'harmonisation').map(toRev) : [],
      });
    }
    return out;
  }
}
