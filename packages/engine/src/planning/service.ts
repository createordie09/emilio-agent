import {
  AppError,
  LIMINAIRE_LABEL_FR,
  WORK_TYPE_LABEL_FR,
  BriefSchema,
  type AgentRole,
  type Brief,
  type CadrageView,
  type CostEstimate,
  type ExploratorySource,
  type MissionSummary,
  type OutlineNodeView,
  type PlanMetaPatch,
  type PlanNodeInput,
  type PlanNodePatch,
  type PlanOverview,
  type WordsSummary,
} from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { MissionRepo } from '../storage/missions';
import type { EventJournal } from '../events/journal';
import type { ModelCaller } from '../llm/call-model';
import type { MissionExecConfig } from '../llm/exec-config';
import type { QueueAdapter, NewTask } from '../queue/queue';
import type { IngestService } from '../kb/ingest';
import type { ResearchService } from '../research/research-service';
import { runStructured } from '../agents/execute';
import { PLAN_PROMPT_VERSION, renderPrompt } from '../agents/prompts';
import { estimateMission, measuredSpeeds, writingUnits } from '../llm/estimate';
import {
  structureFor,
  type EstimationConfig,
  type PlanConfig,
  type StructureNode,
  type StructureTemplate,
} from './config';
import { compactBrief, dataProfileText, outlineText } from './brief-text';
import {
  allocateWords,
  chapterGroups,
  chapterOf,
  leaves,
  mergeProposal,
  OutlineRepo,
} from './outline';
import type { WritingConfig } from '../writing/config';
import { CadrageSchema, PlanSchema, type Cadrage } from './schemas';

/** Méta du plan courant (colonne `missions.plan_meta_json`). */
export type PlanMeta = {
  version: number;
  justification: string;
  methodologie: string;
  hypotheses: string[];
  risques: string[];
  manques: string[];
  notes: string[];
  problematiqueChoisie: string | null;
  instructions: string | null;
  exploratoryIds: string[];
  exploratoryDone: boolean;
  templateId: string | null;
  enforced: boolean;
};

const EMPTY_META: PlanMeta = {
  version: 0,
  justification: '',
  methodologie: '',
  hypotheses: [],
  risques: [],
  manques: [],
  notes: [],
  problematiqueChoisie: null,
  instructions: null,
  exploratoryIds: [],
  exploratoryDone: false,
  templateId: null,
  enforced: false,
};

export type PlanningDeps = {
  db: Db;
  missions: MissionRepo;
  journal: EventJournal;
  caller: ModelCaller;
  queue: QueueAdapter;
  ingest: IngestService;
  research: ResearchService;
  outline: OutlineRepo;
  config: PlanConfig;
  estimation: EstimationConfig;
  structures: StructureTemplate[];
  writing: WritingConfig;
  price: (model: string) => { prompt: number; completion: number } | null;
  onUpdated: (missionId: string) => void;
};

/**
 * Cadrage (P1) et plan (P2) — CdC §9. Le plan, une fois proposé, vit dans `outline_nodes` ;
 * l'utilisateur l'édite à l'écran de validation, puis le valide : il est figé dans `plan_json`
 * et la recherche approfondie (P3) est mise en file.
 */
export class PlanningService {
  private jobs = new Map<string, { abort: AbortController; promise: Promise<void> }>();

  constructor(private readonly d: PlanningDeps) {}

  // ---------------------------------------------------------------- lecture / état

  private row(id: string) {
    const r = this.d.db
      .prepare(
        'SELECT title, brief_json, cadrage_json, plan_meta_json, cost_estimate_json FROM missions WHERE id=?',
      )
      .get(id) as
      | {
          title: string;
          brief_json: string | null;
          cadrage_json: string | null;
          plan_meta_json: string | null;
          cost_estimate_json: string | null;
        }
      | undefined;
    if (!r) throw new AppError('E_BAD_REQUEST', 'Mission introuvable.');
    return r;
  }

  private brief(id: string): Brief {
    const r = this.row(id);
    const parsed = BriefSchema.safeParse(JSON.parse(r.brief_json ?? '{}'));
    if (!parsed.success)
      throw new AppError('E_BAD_REQUEST', 'Le brief de la mission est incomplet.');
    return parsed.data;
  }

  private meta(id: string): PlanMeta {
    const r = this.row(id);
    return {
      ...EMPTY_META,
      ...(r.plan_meta_json ? (JSON.parse(r.plan_meta_json) as PlanMeta) : {}),
    };
  }

  private writeMeta(id: string, m: PlanMeta): void {
    this.d.db
      .prepare('UPDATE missions SET plan_meta_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(m), nowIso(), id);
  }

  private cadrage(id: string): Cadrage | null {
    const r = this.row(id);
    return r.cadrage_json ? (JSON.parse(r.cadrage_json) as Cadrage) : null;
  }

  private cfg(id: string): MissionExecConfig {
    return this.d.missions.config<MissionExecConfig>(id);
  }

  private say(
    id: string,
    level: 'info' | 'success' | 'warning' | 'error',
    role: AgentRole | null,
    msg: string,
  ) {
    this.d.journal.record({ missionId: id, level, agentRole: role ?? undefined, messageFr: msg });
  }

  private template(brief: Brief): { tpl: StructureTemplate | undefined; enforce: boolean } {
    const tpl = structureFor(this.d.structures, brief.workType);
    return { tpl, enforce: Boolean(tpl) && brief.structure.mode === 'standard' };
  }

  private bodyWords(brief: Brief): { total: number; min: number; max: number } {
    const k = brief.longueur.unite === 'pages' ? this.d.config.wordsPerPage : 1;
    const share =
      brief.longueur.unite === 'pages' ? this.d.config.bodyShare : this.d.config.bodyShare;
    const min = Math.round(brief.longueur.min * k * share);
    const max = Math.round(brief.longueur.max * k * share);
    return { min, max, total: Math.round((min + max) / 2 / 10) * 10 };
  }

  // ---------------------------------------------------------------- génération

  /** Lance P1 + P2 en arrière-plan. `comment` : nouvelle version demandée par l'utilisateur (§9 P2, boucle). */
  start(id: string, opts: { comment?: string } = {}): MissionSummary {
    const status = this.d.missions.status(id);
    const regenerate = status === 'awaiting_plan_validation';
    if (!['briefing', 'failed', 'awaiting_plan_validation'].includes(status))
      throw new AppError(
        'E_BAD_REQUEST',
        'Le plan ne peut pas être généré à ce stade de la mission.',
      );
    if (this.jobs.has(id))
      throw new AppError('E_BAD_REQUEST', 'La génération du plan est déjà en cours.');
    if (regenerate && opts.comment !== undefined) {
      const m = this.meta(id);
      this.writeMeta(id, { ...m, instructions: opts.comment.trim() || null });
    }
    this.brief(id); // refuse un brief invalide avant toute dépense
    this.d.missions.transition(id, 'planning', {
      reason: regenerate
        ? 'Nouvelle version du plan demandée.'
        : 'Cadrage et plan en cours de préparation.',
    });
    this.d.onUpdated(id);
    this.launch(id, regenerate ? (opts.comment ?? '') : undefined);
    return this.d.missions.summary(id);
  }

  /** Reprise au démarrage : une planification interrompue est relancée (les étapes déjà faites sont réutilisées). */
  recover(): string[] {
    const ids = this.d.missions.idsByStatus('planning');
    for (const id of ids) {
      this.say(id, 'info', null, 'Planification reprise après redémarrage.');
      this.launch(id, undefined);
    }
    return ids;
  }

  private launch(id: string, comment: string | undefined): void {
    const abort = new AbortController();
    const promise = this.run(id, abort.signal, comment)
      .catch((e) => this.fail(id, e))
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id, { abort, promise });
  }

  cancel(id: string): void {
    this.jobs.get(id)?.abort.abort();
  }

  async idle(): Promise<void> {
    await Promise.allSettled([...this.jobs.values()].map((j) => j.promise));
  }

  async stop(): Promise<void> {
    for (const j of this.jobs.values()) j.abort.abort();
    await this.idle();
  }

  private fail(id: string, e: unknown): void {
    const aborted =
      (e as Error)?.name === 'AbortError' || this.d.missions.status(id) !== 'planning';
    if (aborted) return;
    const err = e instanceof AppError ? e : new AppError('E_PLAN', (e as Error)?.message);
    const reason =
      err.code === 'E_SCHEMA'
        ? "Le plan n'a pas pu être généré : la réponse du modèle d'IA n'est pas exploitable. Réessayez ou choisissez un autre modèle."
        : `Le plan n'a pas pu être généré. ${err.messageFr}`;
    this.say(id, 'error', null, reason);
    this.d.missions.transition(id, 'failed', {
      reason,
      error: { code: err.code, messageFr: err.messageFr },
    });
    this.d.onUpdated(id);
  }

  private async run(id: string, signal: AbortSignal, comment: string | undefined): Promise<void> {
    const brief = this.brief(id);
    const { tpl, enforce } = this.template(brief);
    const check = () => {
      if (signal.aborted || this.d.missions.status(id) !== 'planning')
        throw new DOMException('Interrompu', 'AbortError');
    };
    const files = this.d.ingest.list(id);
    let meta = this.meta(id);

    // ---- P1 : cadrage
    let cadrage = this.cadrage(id);
    if (!cadrage) {
      const proposer = brief.problematiqueAProposer || !brief.problematique;
      const system = renderPrompt('orchestrator/cadrage', {
        type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
        discipline: brief.discipline,
        brief_compact: compactBrief(brief),
        profil_donnees: dataProfileText(files),
        consigne_problematique: proposer
          ? 'La problématique est à proposer : donne 3 formulations (question centrale claire, délimitée dans l\'espace et le temps), chacune avec une justification de 2 phrases ("problematiques").'
          : 'Une problématique est fournie : laisse "problematiques" vide, sauf si elle te paraît faible — propose alors 3 formulations plus solides.',
        contexte_geographique: brief.terrain?.pays
          ? `de ${brief.terrain.pays} et de l'Afrique francophone`
          : "de l'Afrique francophone",
      });
      const r = await runStructured(this.d.caller, {
        missionId: id,
        taskId: null,
        role: 'orchestrator',
        label: 'plan:cadrage',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Réalise le cadrage.' },
        ],
        schema: CadrageSchema,
        schemaName: 'cadrage',
        temperature: 0.3,
        promptVersion: PLAN_PROMPT_VERSION,
        signal,
      });
      cadrage = r.output;
      this.d.db
        .prepare('UPDATE missions SET cadrage_json=?, updated_at=? WHERE id=?')
        .run(JSON.stringify(cadrage), nowIso(), id);
      this.d.missions.setPhase(id, 'P1');
      this.say(
        id,
        'success',
        'orchestrator',
        `Directeur de recherche : cadrage terminé — ${cadrage.incoherences.length} incohérence(s) signalée(s), ${cadrage.concepts.length} concept(s) clé(s), ${cadrage.requetes.reduce((s, q) => s + q.fr.length + q.en.length, 0)} requête(s) prévue(s).`,
      );
      this.d.onUpdated(id);
    }
    check();

    // ---- P2.1–2.2 : recherche exploratoire et vérification rapide
    if (!meta.exploratoryDone) {
      this.d.missions.setPhase(id, 'P2');
      const queries = this.explorationQueries(brief, cadrage);
      const depth = brief.execution?.profondeurRecherche ?? 'normale';
      const ex = await this.d.research.explore({
        missionId: id,
        topic: [brief.titre, ...brief.motsCles].join(' '),
        queries,
        perQuery: this.d.config.explorationPerQuery,
        maxCandidates: this.d.config.exploration[depth],
        discipline: brief.discipline,
        prioriteAfrique: brief.execution?.preferenceSources === 'afrique',
        signal,
      });
      const kept = ex.sources.filter((s) => s.status !== 'rejected');
      meta = {
        ...this.meta(id),
        exploratoryIds: kept.map((s) => s.id),
        exploratoryDone: true,
      };
      this.writeMeta(id, meta);
      for (const w of ex.warnings) this.say(id, 'warning', 'researcher', w);
      const rej = ex.sources.length - kept.length;
      this.say(
        id,
        kept.length ? 'success' : 'warning',
        'researcher',
        kept.length
          ? `Chercheur : ${kept.length} source(s) candidate(s) pour le plan (${Object.entries(
              ex.byConnector,
            )
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')})${rej ? `, ${rej} écartée(s) à la vérification rapide` : ''}.`
          : 'Chercheur : aucune source candidate trouvée pour le plan (réseau ou sujet très spécifique).',
      );
    }
    check();

    // ---- P2.3 : plan par l'Architecte
    const exploratory = this.exploratorySources(id, meta.exploratoryIds);
    const alias = new Map(
      exploratory.slice(0, this.d.config.architectSources).map((s, i) => [`S${i + 1}`, s]),
    );
    const current = this.d.outline.list(id);
    const words = this.bodyWords(brief);
    const instructions = comment !== undefined ? comment : meta.instructions;
    const instructionsText = [
      instructions
        ? `Instructions supplémentaires de l'utilisateur (à respecter) :\n${instructions}`
        : '',
      current.length
        ? `Plan actuel (avec les modifications de l'utilisateur, à conserver sauf demande contraire) :\n${outlineText(current)}`
        : '',
      meta.problematiqueChoisie
        ? `Problématique retenue par l'utilisateur : ${meta.problematiqueChoisie}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const system = renderPrompt('outline_architect/plan', {
      type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
      discipline: brief.discipline,
      brief_compact: compactBrief(brief),
      cadrage_compact: this.cadrageText(cadrage),
      mots_total: words.total,
      titre_squelette: tpl
        ? enforce
          ? 'Squelette imposé (conserve tous ces nœuds avec leur "cle" ; tu peux affiner les titres sans en changer le sens et ajouter des sections ou sous-sections, mais pas de partie ni de chapitre) :'
          : 'Squelette indicatif (structure personnalisée demandée : adapte-le librement) :'
        : 'Aucun squelette : propose une structure académique standard.',
      squelette: tpl ? JSON.stringify(this.skeleton(tpl.nodes), null, 1) : '',
      sources_exploratoires: alias.size
        ? [...alias]
            .map(
              ([a, s]) =>
                `${a} | ${s.title} | ${s.year ?? 's.d.'} | ${(s.abstract ?? '').replace(/\s+/g, ' ').slice(0, this.d.config.abstractChars)}`,
            )
            .join('\n')
        : '(aucune source candidate trouvée)',
      instructions: instructionsText,
      consigne_structure: enforce
        ? 'Respecte le squelette imposé : mêmes parties, mêmes chapitres, mêmes clés.'
        : 'Construis une structure adaptée au brief.',
      mots_min_section: this.d.config.minSectionWords,
    });
    const r = await runStructured(this.d.caller, {
      missionId: id,
      taskId: null,
      role: 'outline_architect',
      label: 'plan:architecte',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Propose le plan détaillé.' },
      ],
      schema: PlanSchema,
      schemaName: 'plan',
      temperature: 0.4,
      promptVersion: PLAN_PROMPT_VERSION,
      signal,
    });
    check();

    const { roots, notes } = mergeProposal(r.output, tpl, enforce);
    if (!roots.length) throw new AppError('E_SCHEMA');
    // Sources pressenties : seuls les identifiants fournis sont acceptés (jamais d'invention).
    let unknownRefs = 0;
    const mapSources = (list: typeof roots) => {
      for (const n of list) {
        n.sourceIds = [...new Set(n.sourceIds)].flatMap((a) => {
          const s = alias.get(a.trim().toUpperCase());
          if (!s) {
            unknownRefs++;
            return [];
          }
          return [s.id];
        });
        mapSources(n.children);
      }
    };
    mapSources(roots);
    if (unknownRefs) notes.push(`${unknownRefs} source(s) pressentie(s) inconnue(s) ignorée(s).`);

    const alloc = allocateWords(roots, words.total);
    const leafCount = roots.reduce(function count(s: number, n): number {
      return n.children.length ? n.children.reduce(count, s) : s + (n.kind === 'corps' ? 1 : 0);
    }, 0);
    const perSection = Math.max(
      this.d.config.defaultMinSourcesPerSection,
      brief.execution?.minSourcesTotal
        ? Math.ceil(brief.execution.minSourcesTotal / Math.max(1, leafCount))
        : 0,
    );

    const version = meta.version + 1;
    this.d.db.transaction(() => {
      this.d.outline.replace(id, roots, alloc, perSection);
      this.d.db
        .prepare(
          'INSERT INTO plan_versions(id,mission_id,version,comment,proposal_json,created_at) VALUES (?,?,?,?,?,?)',
        )
        .run(newId(), id, version, instructions ?? null, JSON.stringify(r.output), nowIso());
      this.writeMeta(id, {
        ...this.meta(id),
        version,
        justification: r.output.justification_globale,
        methodologie: r.output.methodologie,
        hypotheses: r.output.hypotheses.length ? r.output.hypotheses : brief.hypotheses,
        risques: r.output.risques,
        manques: r.output.manques,
        notes,
        templateId: tpl?.id ?? null,
        enforced: enforce,
        instructions: instructions ?? null,
      });
      const est = this.estimate(id);
      this.d.db
        .prepare('UPDATE missions SET cost_estimate_json=?, updated_at=? WHERE id=?')
        .run(JSON.stringify(est), nowIso(), id);
      this.d.missions.transition(id, 'awaiting_plan_validation', {
        reason: `Plan prêt (version ${version}) : en attente de votre validation.`,
      });
    })();
    this.say(
      id,
      'success',
      'outline_architect',
      `Architecte du plan : plan proposé (version ${version}), ${this.d.outline.list(id).length} nœud(s), ${words.total.toLocaleString('fr-FR')} mots visés.`,
    );
    for (const n of notes) this.say(id, 'warning', 'outline_architect', n);
    this.d.onUpdated(id);
  }

  private explorationQueries(
    brief: Brief,
    cadrage: Cadrage,
  ): { texte: string; langue: 'fr' | 'en' }[] {
    const out: { texte: string; langue: 'fr' | 'en' }[] = [];
    const seen = new Set<string>();
    const push = (t: string, l: 'fr' | 'en') => {
      const k = t.trim().toLowerCase();
      if (k.length > 2 && !seen.has(k)) {
        seen.add(k);
        out.push({ texte: t.trim(), langue: l });
      }
    };
    // Une requête par concept à tour de rôle (FR puis EN) pour couvrir tous les concepts avant d'approfondir l'un d'eux.
    for (let i = 0; i < 4; i++)
      for (const q of cadrage.requetes) {
        if (q.fr[i]) push(q.fr[i]!, 'fr');
        if (q.en[i]) push(q.en[i]!, 'en');
      }
    if (!out.length) {
      push(brief.titre, 'fr');
      if (brief.motsCles.length) push(brief.motsCles.join(' '), 'fr');
    }
    return out.slice(0, this.d.config.explorationQueriesMax);
  }

  private cadrageText(c: Cadrage): string {
    return [
      c.problematiques.length
        ? `Formulations de problématique proposées : ${c.problematiques.map((p) => p.formulation).join(' | ')}`
        : '',
      c.concepts.length ? `Concepts clés : ${c.concepts.map((x) => x.nom).join(', ')}` : '',
      c.cadres_theoriques_pistes.length
        ? `Pistes théoriques : ${c.cadres_theoriques_pistes.join(', ')}`
        : '',
      c.incoherences.length
        ? `Incohérences : ${c.incoherences.map((x) => `${x.element} : ${x.probleme}`).join(' ; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private skeleton(nodes: StructureNode[]): unknown[] {
    return nodes.map((n) => ({
      cle: n.key,
      niveau: n.level,
      titre: n.title,
      ...(n.children?.length ? { enfants: this.skeleton(n.children) } : {}),
    }));
  }

  private exploratorySources(
    id: string,
    ids: string[],
  ): (ExploratorySource & { abstract: string | null })[] {
    if (!ids.length) return [];
    const rows = this.d.db
      .prepare(
        `SELECT id,title,authors_json,year,abstract,verification_status FROM sources WHERE mission_id=? AND id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(id, ...ids) as {
      id: string;
      title: string;
      authors_json: string | null;
      year: number | null;
      abstract: string | null;
      verification_status: ExploratorySource['verificationStatus'];
    }[];
    const order = new Map(ids.map((x, i) => [x, i]));
    return rows
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((r) => ({
        id: r.id,
        title: r.title,
        authors: JSON.parse(r.authors_json ?? '[]') as string[],
        year: r.year,
        abstract: r.abstract,
        verificationStatus: r.verification_status,
      }));
  }

  // ---------------------------------------------------------------- vue pour l'écran de validation

  private hasFieldData(id: string): boolean {
    return this.d.ingest.list(id).some((f) => f.kind === 'field_data' && f.status !== 'error');
  }

  estimate(id: string): CostEstimate {
    const brief = this.brief(id);
    const cfg = this.cfg(id);
    const speeds = measuredSpeeds(this.d.db, this.d.estimation.measuredSpeedMinCalls);
    return estimateMission({
      nodes: this.d.outline.list(id),
      brief,
      models: cfg.models,
      price: this.d.price,
      speed: (m) => speeds.get(m) ?? null,
      cfg: this.d.estimation,
      simulated: cfg.llmMode === 'mock',
      hasFieldData: this.hasFieldData(id),
      spentUsd: this.d.missions.costSpent(id),
      budgetMaxUsd: cfg.budgetMaxUsd ?? null,
    });
  }

  overview(id: string): PlanOverview {
    const r = this.row(id);
    const brief = this.brief(id);
    const meta = this.meta(id);
    const cad = this.cadrage(id);
    const nodes = this.d.outline.list(id);
    const status = this.d.missions.status(id);
    const exploratory = this.exploratorySources(id, meta.exploratoryIds).map(
      ({ abstract: _a, ...s }) => s,
    );
    const words = this.wordsSummary(brief, nodes);
    const est = nodes.length ? this.estimate(id) : null;
    const cadrageView: CadrageView | null = cad
      ? {
          incoherences: cad.incoherences,
          problematiques: cad.problematiques,
          concepts: cad.concepts,
          cadres_theoriques_pistes: cad.cadres_theoriques_pistes,
          manques: cad.manques,
          nbRequetes: cad.requetes.reduce((s, q) => s + q.fr.length + q.en.length, 0),
        }
      : null;
    return {
      missionId: id,
      title: r.title,
      status,
      version: meta.version,
      versionsAdvisedMax: this.d.config.versionsAdvisedMax,
      problematique: meta.problematiqueChoisie ?? brief.problematique ?? null,
      problematiqueChoisie: meta.problematiqueChoisie,
      problematiqueAProposer: brief.problematiqueAProposer || !brief.problematique,
      hypotheses: meta.hypotheses.length ? meta.hypotheses : brief.hypotheses,
      methodologie: meta.methodologie,
      justification: meta.justification,
      risques: meta.risques,
      cadrage: cadrageView,
      nodes,
      exploratory,
      words,
      instructions: meta.instructions,
      estimate: est,
      warnings: this.warnings(brief, meta, nodes, words, est, cadrageView),
      liminaires: (Object.entries(brief.liminaires) as [keyof typeof LIMINAIRE_LABEL_FR, boolean][])
        .filter(([, on]) => on)
        .map(([k]) => LIMINAIRE_LABEL_FR[k]),
      simulated: this.cfg(id).llmMode === 'mock',
    };
  }

  private wordsSummary(brief: Brief, nodes: OutlineNodeView[]): WordsSummary {
    const { min, max } = this.bodyWords(brief);
    const planned = leaves(nodes).reduce((s, n) => s + n.targetWords, 0);
    const tol = this.d.config.wordTolerance;
    const kids = new Map<string | null, OutlineNodeView[]>();
    for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    const sum = (n: OutlineNodeView): number => {
      const c = kids.get(n.id) ?? [];
      return c.length ? c.reduce((s, x) => s + sum(x), 0) : n.targetWords;
    };
    const top = (kids.get(null) ?? []).flatMap((n) =>
      n.level === 'partie' ? (kids.get(n.id) ?? []).map((c) => c) : [n],
    );
    return {
      unit: brief.longueur.unite,
      targetMin: brief.longueur.min,
      targetMax: brief.longueur.max,
      planned,
      plannedPages: Math.round(planned / this.d.config.wordsPerPage / this.d.config.bodyShare),
      status:
        planned < min * (1 - tol) ? 'trop_court' : planned > max * (1 + tol) ? 'trop_long' : 'ok',
      chapters: top.map((n) => ({
        nodeId: n.id,
        label: `${n.numbering ? n.numbering + ' — ' : ''}${n.title}`,
        words: sum(n),
      })),
    };
  }

  private warnings(
    brief: Brief,
    meta: PlanMeta,
    nodes: OutlineNodeView[],
    words: WordsSummary,
    est: CostEstimate | null,
    cad: CadrageView | null,
  ): string[] {
    const w: string[] = [...meta.notes];
    const tpl = this.d.structures.find((t) => t.id === meta.templateId);
    if (meta.enforced && tpl) {
      const have = new Set(nodes.map((n) => n.templateKey).filter(Boolean));
      const walk = (list: StructureNode[]) =>
        list.forEach((t) => {
          if (!have.has(t.key))
            w.push(`La structure standard prévoit « ${t.title} » : cette section a été supprimée.`);
          walk(t.children ?? []);
        });
      walk(tpl.nodes);
    }
    const short = leaves(nodes).filter(
      (n) =>
        n.kind === 'corps' &&
        n.targetWords < this.d.config.minSectionWords &&
        !this.insideIntroOrConclusion(n, nodes),
    );
    if (short.length)
      w.push(
        `${short.length} section(s) sous ${this.d.config.minSectionWords} mots : ${short
          .slice(0, 3)
          .map((n) => `« ${n.title} »`)
          .join(', ')}${short.length > 3 ? '…' : ''}.`,
      );
    if (words.status !== 'ok')
      w.push(
        words.status === 'trop_court'
          ? `Le plan prévoit ${words.planned.toLocaleString('fr-FR')} mots (≈ ${words.plannedPages} pages) : en dessous de la longueur demandée.`
          : `Le plan prévoit ${words.planned.toLocaleString('fr-FR')} mots (≈ ${words.plannedPages} pages) : au-dessus de la longueur demandée.`,
      );
    const noObjective = leaves(nodes).filter((n) => n.kind === 'corps' && !n.objective.trim());
    if (noObjective.length)
      w.push(
        `${noObjective.length} section(s) sans objectif : précisez-les pour guider la recherche.`,
      );
    if (meta.exploratoryIds.length === 0 && meta.exploratoryDone)
      w.push(
        'Aucune source candidate n’a été trouvée pour le plan : la recherche approfondie reposera sur vos documents.',
      );
    if (est?.exceedsBudget.moyen)
      w.push(
        'Le coût moyen estimé dépasse le budget maximal : relevez le budget ou réduisez la longueur.',
      );
    else if (est?.exceedsBudget.haut)
      w.push(
        'Le scénario haut dépasse le budget maximal : la mission pourrait s’arrêter avant la fin.',
      );
    if (est?.partial)
      w.push(`Prix inconnu pour ${est.missingPrice.join(', ')} : l'estimation est un minimum.`);
    if (cad?.incoherences.length)
      w.push(
        `${cad.incoherences.length} incohérence(s) relevée(s) dans votre brief (voir le cadrage).`,
      );
    if (meta.version > this.d.config.versionsAdvisedMax)
      w.push(
        `Version ${meta.version} du plan : au-delà de ${this.d.config.versionsAdvisedMax} versions, modifier directement le plan est souvent plus rapide.`,
      );
    return w;
  }

  private insideIntroOrConclusion(n: OutlineNodeView, nodes: OutlineNodeView[]): boolean {
    let cur: OutlineNodeView | undefined = nodes.find((x) => x.id === n.parentId);
    while (cur) {
      if (cur.kind !== 'corps') return true;
      cur = nodes.find((x) => x.id === cur!.parentId);
    }
    return false;
  }

  // ---------------------------------------------------------------- édition

  private assertEditable(id: string): void {
    if (this.d.missions.status(id) !== 'awaiting_plan_validation')
      throw new AppError('E_BAD_REQUEST', "Le plan n'est modifiable qu'en attente de validation.");
  }

  private defaultMinSources(id: string): number {
    const brief = this.brief(id);
    return Math.max(
      this.d.config.defaultMinSourcesPerSection,
      brief.execution?.minSourcesTotal
        ? Math.ceil(
            brief.execution.minSourcesTotal / Math.max(1, leaves(this.d.outline.list(id)).length),
          )
        : 0,
    );
  }

  updateNode(id: string, nodeId: string, patch: PlanNodePatch): PlanOverview {
    this.assertEditable(id);
    this.d.outline.update(id, nodeId, patch);
    return this.overview(id);
  }
  addNode(id: string, input: PlanNodeInput): PlanOverview {
    this.assertEditable(id);
    this.d.outline.add(id, input, this.defaultMinSources(id));
    return this.overview(id);
  }
  deleteNode(id: string, nodeId: string): PlanOverview {
    this.assertEditable(id);
    this.d.outline.remove(id, nodeId);
    if (!this.d.outline.list(id).length)
      throw new AppError('E_BAD_REQUEST', 'Le plan ne peut pas être vide.');
    return this.overview(id);
  }
  moveNode(id: string, nodeId: string, parentId: string | null, index: number): PlanOverview {
    this.assertEditable(id);
    this.d.outline.move(id, nodeId, parentId, index);
    return this.overview(id);
  }
  saveMeta(id: string, patch: PlanMetaPatch): PlanOverview {
    this.assertEditable(id);
    const m = this.meta(id);
    this.writeMeta(id, {
      ...m,
      ...(patch.problematiqueChoisie !== undefined
        ? { problematiqueChoisie: patch.problematiqueChoisie?.trim() || null }
        : {}),
      ...(patch.instructions !== undefined
        ? { instructions: patch.instructions?.trim() || null }
        : {}),
    });
    return this.overview(id);
  }

  // ---------------------------------------------------------------- validation

  /**
   * Fige le plan (`plan_json`), met la problématique retenue dans le brief, met en file la recherche approfondie (P3)
   * puis appelle `start` (transition vers `running`) dans la même transaction.
   */
  validate(id: string, start: () => void): MissionSummary {
    this.assertEditable(id);
    const ov = this.overview(id);
    if (!ov.nodes.length) throw new AppError('E_BAD_REQUEST', 'Le plan est vide.');
    if (ov.nodes.some((n) => n.title.trim().length < 2))
      throw new AppError('E_BAD_REQUEST', 'Certaines sections n’ont pas de titre.');
    if (ov.problematiqueAProposer && !ov.problematiqueChoisie)
      throw new AppError(
        'E_BAD_REQUEST',
        'Choisissez la problématique (ou saisissez la vôtre) avant de valider le plan.',
      );
    const brief = this.brief(id);
    const units = writingUnits(ov.nodes);
    const researchNodes = leaves(ov.nodes).filter((n) => n.kind === 'corps');
    const targets = researchNodes.length ? researchNodes : leaves(ov.nodes);
    const tasks: NewTask[] = targets.map((n) => ({
      key: `p3.recherche.${n.id}`,
      phase: 'P3',
      agentRole: 'local',
      label: `Recherche — ${n.numbering ? n.numbering + ' ' : ''}${n.title}`,
      input: { handler: 'p3.research', nodeId: n.id },
    }));
    const hasData = this.hasFieldData(id);
    const wantsResults = new RegExp(this.d.writing.resultsPattern, 'i');
    if (hasData)
      tasks.push({
        key: 'p4.analyse',
        phase: 'P4',
        agentRole: 'local',
        label: 'Analyse des données de terrain',
        input: { handler: 'p4.analysis' },
      });
    // P5 : rédaction du corps (une tâche par unité), puis introduction et conclusion, puis pages liminaires (§9 P5, §8.5).
    // Une section dépend de sa recherche, de l'analyse si elle présente des résultats, et de la section précédente du même chapitre
    // (pour en recevoir le résumé) : les chapitres, eux, avancent en parallèle.
    const byId = new Map(ov.nodes.map((n) => [n.id, n]));
    const lastInChapter = new Map<string, string>();
    const bodyKeys: string[] = [];
    const bodyUnits = units.filter((u) => u.node.kind === 'corps');
    for (const u of bodyUnits) {
      const n = u.node;
      const key = `p5.redaction.${n.id}`;
      const deps = [
        ...(targets.some((t) => t.id === n.id) ? [`p3.recherche.${n.id}`] : []),
        ...(hasData && wantsResults.test(`${n.title} ${n.objective}`) ? ['p4.analyse'] : []),
      ];
      const ch = chapterOf(n, byId);
      if (lastInChapter.has(ch)) deps.push(lastInChapter.get(ch)!);
      lastInChapter.set(ch, key);
      bodyKeys.push(key);
      tasks.push({
        key,
        phase: 'P5',
        agentRole: 'local',
        label: `Rédaction — ${n.numbering ? n.numbering + ' ' : ''}${n.title}`,
        input: { handler: 'p5.write', nodeId: n.id },
        dependsOnKeys: deps,
      });
    }
    const generalKeys: string[] = [];
    for (const u of units.filter((x) => x.node.kind !== 'corps')) {
      const key = `p5.general.${u.node.id}`;
      generalKeys.push(key);
      tasks.push({
        key,
        phase: 'P5',
        agentRole: 'local',
        label: `Rédaction — ${u.node.title}`,
        input: { handler: 'p5.general', nodeId: u.node.id },
        dependsOnKeys: bodyKeys,
      });
    }
    tasks.push({
      key: 'p5.liminaires',
      phase: 'P5',
      agentRole: 'local',
      label: 'Résumé et pages liminaires',
      input: { handler: 'p5.front' },
      dependsOnKeys: generalKeys.length ? generalKeys : bodyKeys,
    });
    // P6 : un jury par chapitre, dès que toutes ses sections sont rédigées (chapitres en parallèle, §9 P6).
    const reviewKeys: string[] = [];
    for (const g of chapterGroups(
      ov.nodes,
      bodyUnits.map((u) => u.node),
    )) {
      const key = `p6.chapitre.${g.id}`;
      reviewKeys.push(key);
      tasks.push({
        key,
        phase: 'P6',
        agentRole: 'local',
        label: `Jury — ${g.node.numbering ? g.node.numbering + ' ' : ''}${g.node.title}`,
        input: { handler: 'p6.review', chapterId: g.id },
        dependsOnKeys: g.units.map((u) => `p5.redaction.${u.id}`),
      });
    }
    // P7 : harmonisation et évaluation globale (après les chapitres, l'introduction, la conclusion et les liminaires), puis mise à jour finale.
    tasks.push({
      key: 'p7.global',
      phase: 'P7',
      agentRole: 'local',
      label: 'Harmonisation et évaluation globale',
      input: { handler: 'p7.global' },
      dependsOnKeys: [...reviewKeys, ...generalKeys, 'p5.liminaires'],
    });
    tasks.push({
      key: 'p7.finalize',
      phase: 'P7',
      agentRole: 'local',
      label: 'Mise à jour finale (introduction, conclusion, résumé)',
      input: { handler: 'p7.finalize' },
      dependsOnKeys: ['p7.global'],
    });
    // P8 : mise en forme (citations, bibliographie, listes) ; P9 : livrables demandés, contrôle final, rapport de mission.
    tasks.push({
      key: 'p8.format',
      phase: 'P8',
      agentRole: 'local',
      label: 'Mise en forme et bibliographie',
      input: { handler: 'p8.format' },
      dependsOnKeys: ['p7.finalize'],
    });
    const lv = brief.livrables;
    const genKeys: string[] = [];
    const gen = (key: string, label: string, handler: string) => {
      genKeys.push(key);
      tasks.push({
        key,
        phase: 'P9',
        agentRole: 'local',
        label,
        input: { handler },
        dependsOnKeys: ['p8.format'],
      });
    };
    if (lv.docx) gen('p9.docx', 'Document Word', 'p9.docx');
    if (lv.pdf) gen('p9.pdf', 'Document PDF', 'p9.pdf');
    if (lv.pptx) gen('p9.slides', 'Diaporama de soutenance', 'p9.slides');
    if (lv.fichePreparation) gen('p9.fiche', 'Fiche de préparation à la soutenance', 'p9.fiche');
    tasks.push({
      key: 'p9.final',
      phase: 'P9',
      agentRole: 'local',
      label: 'Contrôle final',
      input: { handler: 'p9.final' },
      dependsOnKeys: genKeys.length ? genKeys : ['p8.format'],
    });
    if (lv.rapportMission)
      tasks.push({
        key: 'p9.report',
        phase: 'P9',
        agentRole: 'local',
        label: 'Rapport de mission',
        input: { handler: 'p9.report' },
        dependsOnKeys: ['p9.final'],
      });
    this.d.db.transaction(() => {
      const t = nowIso();
      const nextBrief = {
        ...brief,
        ...(ov.problematiqueChoisie
          ? { problematique: ov.problematiqueChoisie, problematiqueAProposer: false }
          : {}),
      };
      this.d.db
        .prepare(
          'UPDATE missions SET plan_json=?, brief_json=?, cost_estimate_json=?, updated_at=? WHERE id=?',
        )
        .run(
          JSON.stringify({
            version: ov.version,
            validatedAt: t,
            nodes: ov.nodes,
            writingUnits: units.length,
            methodologie: ov.methodologie,
            hypotheses: ov.hypotheses,
          }),
          JSON.stringify(nextBrief),
          JSON.stringify(ov.estimate),
          t,
          id,
        );
      const cfg = this.cfg(id);
      this.d.missions.setConfig(id, { ...cfg, stopAfterPhase: undefined });
      this.d.queue.enqueue(id, tasks);
      start();
    })();
    this.d.onUpdated(id);
    return this.d.missions.summary(id);
  }
}
