import {
  AppError,
  BriefSchema,
  WORK_TYPE_LABEL_FR,
  type AgentRole,
  type Brief,
  type FrontMatterView,
  type OutlineNodeView,
  type SectionChecks,
  type SectionClaimView,
  type SectionDraftDetail,
  type SectionDraftSummary,
} from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { MissionRepo } from '../storage/missions';
import type { EventJournal } from '../events/journal';
import type { ModelCaller } from '../llm/call-model';
import type { MissionExecConfig } from '../llm/exec-config';
import { writingUnits } from '../llm/estimate';
import type { KbStore } from '../kb/store';
import type { EmbeddingAdapter } from '../kb/embeddings';
import type { OutlineRepo } from '../planning/outline';
import { runStructured } from '../agents/execute';
import { renderPrompt } from '../agents/prompts';
import type { DataAnalysisService, StoredAnalysis } from '../analysis/service';
import { numberTokens } from '../util/numbers';
import {
  checkLength,
  checkSection,
  dropOrphanNumberSentences,
  PRUNABLE,
  REASON_FR,
  supportingExtracts,
  type CheckCtx,
  type Claim,
  type Extract,
  type Issue,
  type SourceInfo,
} from './checks';
import type { WritingConfig } from './config';
import { loadSectionSources, missionContext, sourceLabel } from './context';
import { GroundingSchema, SummarySchema, WriterOutputSchema, type WriterOutput } from './schemas';
import {
  blocksOf,
  removeSentences,
  stripMarkers,
  tableTokenId,
  wordCount,
  type Sentence,
} from './text';

export const WRITING_PROMPT_VERSION = 'redaction-1';
type Verdict = { niveau: 'supported' | 'partially' | 'unsupported'; justification: string };

export type WrittenSection = {
  nodeId: string;
  version: number;
  words: number;
  checks: SectionChecks;
  skipped: boolean;
  placeholder: boolean;
};

export type WriterDeps = {
  db: Db;
  missions: MissionRepo;
  journal: EventJournal;
  caller: ModelCaller;
  store: KbStore;
  embedder: () => EmbeddingAdapter;
  outline: OutlineRepo;
  analysis: DataAnalysisService;
  cfg: WritingConfig;
  /** Longueur de contexte (jetons) d'un modèle, d'après la liste OpenRouter ; `null` si inconnue. */
  contextLength: (model: string) => number | null;
};

const FRONT_LABEL: Record<string, string> = {
  resume: 'Résumé',
  abstract: 'Abstract',
  dedicace: 'Dédicace',
  remerciements: 'Remerciements',
  avertissement: 'Avertissement',
};

const FATAL = ['E_NO_CREDIT', 'E_BUDGET', 'E_NETWORK', 'E_KEY_INVALID', 'E_KEY_MISSING'];

const briefNumbers = (b: Brief, node?: OutlineNodeView): Set<string> => {
  const s = new Set<string>();
  const add = (t: string | undefined) => t && numberTokens(t).forEach((x) => s.add(x.canon));
  [
    b.titre,
    b.problematique,
    b.objectifGeneral,
    b.terrain?.periode,
    b.terrain?.pays,
    b.collecte?.echantillon,
    b.criteresJury,
    b.instructionsLibres,
  ].forEach(add);
  [...b.hypotheses, ...b.questionsRecherche, ...b.objectifsSpecifiques, ...b.motsCles].forEach(add);
  if (node) {
    add(node.title);
    add(node.objective);
    node.keyQuestions.forEach(add);
  }
  return s;
};

/**
 * Rédaction (P5, CdC §9) : contexte (§8.4) → Rédacteur → contrôles par le code (sources §12.1, citations §12.2, chiffres §12.3,
 * similarité §12.4) + Vérificateur d'ancrage → correction ciblée (2 rondes) → suppression des phrases qui restent fautives → résumé.
 * Rien n'est écrit en base avant la fin : une section est soit complète, soit absente (reprise idempotente).
 */
export class SectionWriter {
  constructor(private readonly d: WriterDeps) {}

  private say(id: string, level: 'info' | 'success' | 'warning', role: AgentRole, msg: string) {
    this.d.journal.record({ missionId: id, level, agentRole: role, messageFr: msg });
  }

  private brief(id: string): Brief {
    const r = this.d.db.prepare('SELECT brief_json FROM missions WHERE id=?').get(id) as {
      brief_json: string | null;
    };
    return BriefSchema.parse(JSON.parse(r.brief_json ?? '{}'));
  }

  private latest(nodeId: string) {
    return this.d.db
      .prepare(
        'SELECT id, version, word_count, checks_json, summary FROM drafts WHERE outline_node_id=? ORDER BY version DESC LIMIT 1',
      )
      .get(nodeId) as
      | {
          id: string;
          version: number;
          word_count: number;
          checks_json: string | null;
          summary: string | null;
        }
      | undefined;
  }

  private maxExtractTokens(missionId: string): number {
    const model = this.d.missions.config<MissionExecConfig>(missionId).models.section_writer;
    const len = model ? this.d.contextLength(model) : null;
    if (!len) return this.d.cfg.extractsMaxTokens;
    return Math.max(
      2000,
      Math.min(
        this.d.cfg.extractsMaxTokens,
        Math.floor(len * this.d.cfg.contextShare) - this.d.cfg.fixedPromptTokens,
      ),
    );
  }

  // ------------------------------------------------------------------ résumés des sections déjà rédigées

  private summaries(
    missionId: string,
    node: OutlineNodeView,
    nodes: OutlineNodeView[],
    all = false,
  ): string {
    const rows = this.d.db
      .prepare(
        `SELECT n.id, n.numbering, n.title, n.ordinal, n.parent_id, d.summary FROM outline_nodes n JOIN drafts d ON d.outline_node_id=n.id
         WHERE n.mission_id=? AND d.summary IS NOT NULL AND d.version=(SELECT MAX(version) FROM drafts WHERE outline_node_id=n.id) ORDER BY n.ordinal`,
      )
      .all(missionId) as {
      id: string;
      numbering: string | null;
      title: string;
      ordinal: number;
      parent_id: string | null;
      summary: string;
    }[];
    const chapterOf = (n: OutlineNodeView): string | null => {
      let cur: OutlineNodeView | undefined = n;
      while (cur) {
        if (cur.level === 'chapitre' || !cur.parentId) return cur.id;
        cur = nodes.find((x) => x.id === cur!.parentId);
      }
      return null;
    };
    const mine = chapterOf(node);
    const out: string[] = [];
    let used = 0;
    for (const r of rows) {
      if (!all && r.ordinal >= node.ordinal) continue;
      const rn = nodes.find((x) => x.id === r.id);
      const same = !all && rn && chapterOf(rn) === mine;
      const text =
        same || all ? r.summary : r.summary.slice(0, 300) + (r.summary.length > 300 ? '…' : '');
      const line = `[${r.numbering ?? r.title}] ${r.title} : ${text}`;
      if (used + line.length > this.d.cfg.summariesMaxChars) break;
      used += line.length;
      out.push(line);
    }
    return out.join('\n') || '(aucune section rédigée avant celle-ci)';
  }

  // ------------------------------------------------------------------ appels de modèles

  private async callWriter(
    missionId: string,
    label: string,
    system: string,
    signal?: AbortSignal,
  ): Promise<WriterOutput> {
    const r = await runStructured(this.d.caller, {
      missionId,
      taskId: null,
      role: 'section_writer',
      label,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Rédige.' },
      ],
      schema: WriterOutputSchema,
      schemaName: 'section',
      temperature: 0.6,
      promptVersion: WRITING_PROMPT_VERSION,
      signal,
    });
    return r.output;
  }

  private async ground(
    missionId: string,
    claims: { key: string; claim: Claim; extracts: Extract[] }[],
    cache: Map<string, Verdict>,
    signal?: AbortSignal,
  ): Promise<void> {
    const todo = claims.filter((c) => !cache.has(c.key));
    const withExtracts = todo.filter((c) => c.extracts.length);
    for (const c of todo.filter((x) => !x.extracts.length))
      cache.set(c.key, {
        niveau: 'unsupported',
        justification: 'Aucun extrait disponible pour cette source.',
      });
    for (let i = 0; i < withExtracts.length; i += this.d.cfg.groundingBatch) {
      const batch = withExtracts.slice(i, i + this.d.cfg.groundingBatch);
      const lines = batch
        .map(
          (c, k) =>
            `C${k + 1} : ${c.claim.text}\n` +
            c.extracts
              .map(
                (e) =>
                  `   Extrait [${e.alias}]${e.page ? ` (p. ${e.page})` : ''} : ${e.text.slice(0, this.d.cfg.claimExtractChars)}`,
              )
              .join('\n'),
        )
        .join('\n\n');
      const r = await runStructured(this.d.caller, {
        missionId,
        taskId: null,
        role: 'grounding_checker',
        label: 'redaction:ancrage',
        messages: [
          {
            role: 'system',
            content: renderPrompt('grounding_checker/check', { affirmations: lines }),
          },
          { role: 'user', content: 'Vérifie.' },
        ],
        schema: GroundingSchema,
        schemaName: 'ancrage',
        temperature: 0,
        promptVersion: WRITING_PROMPT_VERSION,
        signal,
      });
      const byId = new Map(r.output.verdicts.map((v) => [v.id.trim().toUpperCase(), v]));
      batch.forEach((c, k) => {
        const v = byId.get(`C${k + 1}`);
        // Pas de verdict = pas d'ancrage démontré : jamais « soutenu » par défaut.
        cache.set(
          c.key,
          v
            ? { niveau: v.niveau, justification: v.justification }
            : { niveau: 'unsupported', justification: 'Aucun verdict du vérificateur.' },
        );
      });
    }
  }

  // ------------------------------------------------------------------ boucle de contrôle et de correction

  private async refine(
    missionId: string,
    first: WriterOutput,
    chk: CheckCtx,
    o: {
      target: number;
      withGrounding: boolean;
      tableIds: Set<string>;
      correct: (md: string, issues: Issue[]) => Promise<WriterOutput>;
      signal?: AbortSignal;
    },
  ): Promise<{
    md: string;
    out: WriterOutput;
    checks: SectionChecks;
    finalClaims: { claim: Claim; extracts: Extract[]; verdict: Verdict }[];
  }> {
    let out = first;
    const cache = new Map<string, Verdict>();
    let rounds = 0;
    let initialRate: number | null = null;
    let issues: Issue[] = [];
    let claimsNow: { key: string; claim: Claim; extracts: Extract[] }[] = [];
    for (;;) {
      const r = checkSection(out.markdown, chk);
      claimsNow = r.claims.map((claim) => {
        const extracts = supportingExtracts(claim, chk, out.claims);
        return { key: `${claim.text}|${extracts.map((e) => e.alias).join(',')}`, claim, extracts };
      });
      issues = [...r.issues];
      if (o.withGrounding) {
        await this.ground(missionId, claimsNow, cache, o.signal);
        for (const c of claimsNow) {
          const v = cache.get(c.key)!;
          if (v.niveau === 'unsupported')
            issues.push({
              kind: 'non_etaye',
              sentence: c.claim.sentence,
              detail: `Affirmation non étayée par l'extrait cité : ${v.justification}`,
            });
          else if (v.niveau === 'partially')
            issues.push({
              kind: 'partiel',
              sentence: c.claim.sentence,
              detail: `Affirmation seulement partiellement étayée : ${v.justification}`,
            });
        }
        const total = claimsNow.length;
        const sup = claimsNow.filter((c) => cache.get(c.key)!.niveau === 'supported').length;
        if (rounds === 0) initialRate = total ? sup / total : null;
      }
      // Blocs de tableau inconnus : retirés sans correction (le code les ignorera à l'affichage).
      const len = checkLength(out.markdown, o.target, this.d.cfg.lengthTolerance);
      if (len) issues.push(len);
      const rate = this.rate(claimsNow, cache);
      const needs = issues.some(
        (i) =>
          PRUNABLE.has(i.kind) ||
          i.kind === 'longueur' ||
          (i.kind === 'partiel' && rate !== null && rate < this.d.cfg.groundingMin),
      );
      if (!needs || rounds >= this.d.cfg.correctionRounds) break;
      out = await o.correct(
        out.markdown,
        issues.filter((i) => i.kind !== 'partiel' || (rate ?? 1) < this.d.cfg.groundingMin),
      );
      rounds++;
    }

    // Suppression, par le code, des phrases qui restent fautives (§12.2 « supprimées ou reformulées prudemment »).
    const removed: { sentence: string; reasonFr: string }[] = [];
    const bySentence = new Map<number, { s: Sentence; reasons: Set<string> }>();
    for (const i of issues)
      if (i.sentence && PRUNABLE.has(i.kind)) {
        const e = bySentence.get(i.sentence.start) ?? { s: i.sentence, reasons: new Set<string>() };
        e.reasons.add(REASON_FR[i.kind]);
        bySentence.set(i.sentence.start, e);
      }
    let md = out.markdown;
    if (bySentence.size) {
      md = removeSentences(
        md,
        [...bySentence.values()].map((v) => v.s),
      );
      for (const v of bySentence.values())
        removed.push({
          sentence: stripMarkers(v.s.text).slice(0, 200),
          reasonFr: [...v.reasons].join(' ; '),
        });
    }
    // Bilan final sur le texte conservé.
    const final = checkSection(md, chk);
    const finalClaims = final.claims.map((claim) => {
      const extracts = supportingExtracts(claim, chk, out.claims);
      const key = `${claim.text}|${extracts.map((e) => e.alias).join(',')}`;
      return {
        claim,
        extracts,
        verdict: cache.get(key) ?? ({ niveau: 'supported', justification: '' } as Verdict),
      };
    });
    const sup = finalClaims.filter((c) => c.verdict.niveau === 'supported').length;
    const par = finalClaims.filter((c) => c.verdict.niveau === 'partially').length;
    const uns = finalClaims.filter((c) => c.verdict.niveau === 'unsupported').length;
    const words = wordCount(md);
    const warnings: string[] = [];
    if (par) warnings.push(`${par} affirmation(s) seulement partiellement étayée(s) : à relire.`);
    const lenLeft = checkLength(md, o.target, this.d.cfg.lengthTolerance);
    if (lenLeft) warnings.push(lenLeft.detail);
    if (removed.length)
      warnings.push(`${removed.length} phrase(s) supprimée(s) par le contrôle d'intégrité.`);
    // jetons de tableau dont l'identifiant est inconnu
    for (const b of blocksOf(md))
      if (b.kind === 'table_token' && !o.tableIds.has(tableTokenId(b.text) ?? ''))
        warnings.push(`Tableau « ${tableTokenId(b.text)} » inconnu : ignoré.`);
    return {
      md,
      out,
      finalClaims,
      checks: {
        wordsTarget: o.target,
        wordsActual: words,
        rounds,
        claims: finalClaims.length,
        supported: sup,
        partially: par,
        unsupported: uns,
        groundingRateInitial: initialRate,
        groundingRate: finalClaims.length ? sup / finalClaims.length : null,
        removed,
        warnings,
        manques: out.manques,
      },
    };
  }

  private rate(claims: { key: string }[], cache: Map<string, Verdict>): number | null {
    if (!claims.length) return null;
    return claims.filter((c) => cache.get(c.key)?.niveau === 'supported').length / claims.length;
  }

  // ------------------------------------------------------------------ résumé

  private async summarize(
    missionId: string,
    node: OutlineNodeView,
    md: string,
    allowed: Set<string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const plain = stripMarkers(md.replace(/\{\{TABLEAU:[^}]*\}\}/g, ''));
    const fallback = plain.split(/\s+/).slice(0, this.d.cfg.summaryWords.max).join(' ');
    try {
      const r = await runStructured(this.d.caller, {
        missionId,
        taskId: null,
        role: 'summarizer',
        label: 'redaction:resume',
        messages: [
          {
            role: 'system',
            content: renderPrompt('summarizer/section', {
              titre_section: node.title,
              mots_min: this.d.cfg.summaryWords.min,
              mots_max: this.d.cfg.summaryWords.max,
              texte: plain.slice(0, 24000),
            }),
          },
          { role: 'user', content: 'Résume.' },
        ],
        schema: SummarySchema,
        schemaName: 'resume_section',
        temperature: 0.2,
        promptVersion: WRITING_PROMPT_VERSION,
        signal,
      });
      const nums = new Set([...allowed, ...numberTokens(plain).map((x) => x.canon)]);
      const cleaned = dropOrphanNumberSentences(r.output.resume, nums, this.d.cfg.smallIntMax).text;
      const words = cleaned.split(/\s+/);
      return (
        (words.length > this.d.cfg.summaryWords.max * 1.3
          ? words.slice(0, this.d.cfg.summaryWords.max).join(' ')
          : cleaned) || fallback
      );
    } catch (e) {
      if (e instanceof AppError && FATAL.includes(e.code)) throw e;
      return fallback;
    }
  }

  // ------------------------------------------------------------------ persistance

  private persist(
    missionId: string,
    node: OutlineNodeView,
    md: string,
    checks: SectionChecks,
    summary: string,
    claims: { claim: Claim; extracts: Extract[]; verdict: Verdict }[],
    chk: CheckCtx,
    author: string,
  ): { version: number; draftId: string } {
    const prev = this.latest(node.id);
    const version = (prev?.version ?? 0) + 1;
    const id = newId();
    const t = nowIso();
    // Les alias de la section deviennent des identifiants réels de sources (conversion P8 en citations, J8).
    const real = md.replace(
      /\[@([A-Za-z]\d+)((?:\s*,\s*[^\]]+)?)\]/g,
      (m, a: string, rest: string) => {
        const s = chk.sources.get(a);
        return s ? `[@${s.id}${rest}]` : m;
      },
    );
    this.d.db.transaction(() => {
      this.d.db
        .prepare(
          `INSERT INTO drafts(id,outline_node_id,version,markdown,word_count,author_agent,round,parent_version_id,change_summary,summary,checks_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          node.id,
          version,
          real,
          checks.wordsActual,
          author,
          0,
          prev?.id ?? null,
          'Version initiale',
          summary,
          JSON.stringify(checks),
          t,
          t,
        );
      const ins = this.d.db.prepare(
        `INSERT INTO claims(id,draft_id,sentence_index,claim_text,chunk_id,source_id,support_level,checked_by,checked_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      claims.forEach((c, i) => {
        const src = chk.sources.get(c.claim.aliases[0]!);
        ins.run(
          newId(),
          id,
          i,
          c.claim.text,
          c.extracts[0]?.chunkId ?? null,
          src?.id ?? null,
          c.verdict.niveau,
          'grounding_checker',
          t,
          t,
          t,
        );
        if (src && c.verdict.niveau === 'supported')
          this.d.db
            .prepare('UPDATE sources SET used_in_text = used_in_text + 1 WHERE id=?')
            .run(src.id);
      });
      this.d.db
        .prepare(
          "UPDATE outline_nodes SET current_version_id=?, status='in_review', updated_at=? WHERE id=?",
        )
        .run(id, t, node.id);
    })();
    return { version, draftId: id };
  }

  // ------------------------------------------------------------------ section du corps

  async writeSection(
    missionId: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<WrittenSection> {
    const nodes = this.d.outline.list(missionId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new AppError('E_INTERNAL', 'Section du plan introuvable.');
    const prior = this.latest(nodeId);
    if (prior)
      return {
        nodeId,
        version: prior.version,
        words: prior.word_count,
        checks: JSON.parse(prior.checks_json ?? '{}') as SectionChecks,
        skipped: true,
        placeholder: false,
      };

    const brief = this.brief(missionId);
    const analysis = this.d.analysis.get(missionId);
    const wantsResults = new RegExp(this.d.cfg.resultsPattern, 'i').test(
      `${node.title} ${node.objective}`,
    );
    const unitWords =
      writingUnits(nodes).find((u) => u.node.id === nodeId)?.words ?? node.targetWords;
    const label = `${node.numbering ?? ''} ${node.title}`.trim();

    // §7.3 : approche empirique sans données de terrain → trame d'analyse et emplacements, jamais de résultats inventés.
    if (wantsResults && !analysis && brief.approche !== 'documentaire') {
      const md = this.placeholder(node);
      const checks: SectionChecks = {
        wordsTarget: unitWords,
        wordsActual: wordCount(md),
        rounds: 0,
        claims: 0,
        supported: 0,
        partially: 0,
        unsupported: 0,
        groundingRateInitial: null,
        groundingRate: null,
        removed: [],
        warnings: [
          'Aucune donnée de terrain : section remplacée par des emplacements « DONNÉES À INSÉRER » et une trame d’analyse.',
        ],
        manques: ['Données de terrain à fournir.'],
      };
      this.d.db.transaction(() => {
        this.persist(
          missionId,
          node,
          md,
          checks,
          '',
          [],
          {
            sources: new Map(),
            extracts: [],
            allowedNumbers: new Set(),
            smallIntMax: 0,
            ngram: 8,
            maxQuoteWords: 40,
          },
          'local',
        );
      })();
      this.say(
        missionId,
        'warning',
        'section_writer',
        `Rédacteur : section ${label} remplacée par une trame à compléter (aucune donnée de terrain).`,
      );
      return {
        nodeId,
        version: 1,
        words: checks.wordsActual,
        checks,
        skipped: false,
        placeholder: true,
      };
    }

    const src = await loadSectionSources(
      { db: this.d.db, store: this.d.store, embedder: this.d.embedder(), cfg: this.d.cfg },
      { missionId, node, maxTokens: this.maxExtractTokens(missionId) },
    );
    const useResults = Boolean(analysis) && wantsResults;
    const tables = new Map((analysis?.results ?? []).map((r) => [r.id, r]));
    const allowed = new Set<string>([
      ...briefNumbers(brief, node),
      ...(analysis ? this.d.analysis.allowedNumbers(analysis) : []),
    ]);
    const chk: CheckCtx = {
      sources: src.sources,
      extracts: src.extracts,
      allowedNumbers: allowed,
      smallIntMax: this.d.cfg.smallIntMax,
      ngram: this.d.cfg.ngram,
      maxQuoteWords: this.d.cfg.maxQuoteWords,
    };
    const next = nodes[nodes.indexOf(node) + 1];
    const vars = {
      discipline: brief.discipline,
      numerotation: node.numbering ?? '',
      titre_section: node.title,
      type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
      titre: brief.titre,
      contexte_mission: missionContext(brief, nodes, this.d.cfg.missionContextMaxChars),
      objectif: node.objective || node.title,
      questions_cles: node.keyQuestions.map((q) => `- ${q}`).join('\n') || '- (non précisées)',
      mots_cibles: unitWords,
      resume_contexte_precedent: this.summaries(missionId, node, nodes),
      titre_section_suivante: next
        ? `${next.numbering ?? ''} ${next.title}`.trim()
        : '(fin du travail)',
      sources_disponibles:
        [...src.sources.values()].map((s) => `${s.alias} : ${s.label}`).join('\n') ||
        '(aucune source disponible : n’affirme rien de factuel ; signale ce qui manque)',
      fiches: src.notes || '(aucune)',
      extraits: this.extractsText(src.extracts) || '(aucun extrait)',
      resultats: useResults && analysis ? this.resultsBlock(analysis) : '',
      registre: this.d.cfg.register,
      personne: this.d.cfg.person,
    };
    const first = await this.callWriter(
      missionId,
      'redaction:section',
      renderPrompt('section_writer/write', vars),
      signal,
    );
    const done = await this.refine(missionId, first, chk, {
      target: unitWords,
      withGrounding: true,
      tableIds: new Set(tables.keys()),
      signal,
      correct: (md, issues) =>
        this.callWriter(
          missionId,
          'redaction:correction',
          renderPrompt('section_writer/correct', {
            discipline: brief.discipline,
            numerotation: node.numbering ?? '',
            titre_section: node.title,
            markdown: md,
            problemes: this.issuesText(issues),
            sources_disponibles: vars.sources_disponibles,
            extraits: vars.extraits,
            resultats: vars.resultats,
            mots_cibles: unitWords,
          }),
          signal,
        ),
    });
    const summary = await this.summarize(missionId, node, done.md, allowed, signal);
    const saved = this.persist(
      missionId,
      node,
      done.md,
      done.checks,
      summary,
      done.finalClaims,
      chk,
      'section_writer',
    );
    this.reportSection(missionId, label, done.checks);
    return {
      nodeId,
      version: saved.version,
      words: done.checks.wordsActual,
      checks: done.checks,
      skipped: false,
      placeholder: false,
    };
  }

  private reportSection(missionId: string, label: string, c: SectionChecks): void {
    const rate = c.groundingRate === null ? '' : `, ancrage ${Math.round(c.groundingRate * 100)} %`;
    this.say(
      missionId,
      c.removed.length || c.warnings.length ? 'warning' : 'success',
      'section_writer',
      `Rédacteur : section ${label} rédigée (${c.wordsActual.toLocaleString('fr-FR')} mots${rate}${c.rounds ? `, ${c.rounds} correction(s)` : ''}${c.removed.length ? `, ${c.removed.length} phrase(s) supprimée(s)` : ''}).`,
    );
  }

  private extractsText(extracts: Extract[]): string {
    return extracts
      .map(
        (e) => `[${e.alias}] (source ${e.sourceAlias}${e.page ? `, p. ${e.page}` : ''}) ${e.text}`,
      )
      .join('\n\n');
  }

  private issuesText(issues: Issue[]): string {
    return issues
      .map((i) =>
        i.sentence
          ? `- Phrase : « ${stripMarkers(i.sentence.text)} »\n  Problème : ${i.detail}`
          : `- Ensemble du texte : ${i.detail}`,
      )
      .join('\n');
  }

  private resultsBlock(a: StoredAnalysis): string {
    return [
      `Résultats de terrain calculés (à utiliser tels quels ; ${a.respondents} répondants) :`,
      ...a.results.map(
        (r) =>
          `${r.id} (${r.caption.split(' : ')[0]}, « ${r.caption.split(' : ').slice(1).join(' : ')} ») : ${r.facts.join(' ')}`,
      ),
      `Interprétation validée : ${a.interpretation.interpretation}`,
      ...a.interpretation.hypotheses.map(
        (h) =>
          `Hypothèse « ${h.hypothese} » : ${h.statut === 'confirmee' ? 'confirmée' : h.statut === 'infirmee' ? 'infirmée' : 'nuancée'} (${h.analyses.join(', ') || 'aucune analyse'})`,
      ),
      'Pour insérer un tableau à un endroit précis, écris sur une ligne seule : {{TABLEAU:A1}} (identifiant d’analyse). Ne recopie jamais un tableau toi-même.',
    ].join('\n');
  }

  private placeholder(node: OutlineNodeView): string {
    const qs = node.keyQuestions.length ? node.keyQuestions : [node.objective || node.title];
    return [
      '[DONNÉES À INSÉRER : résultats de l’enquête de terrain]',
      `Cette section présentera : ${node.objective || node.title}`,
      'Trame d’analyse :',
      ...qs.map(
        (q) => `- ${q} → [DONNÉES À INSÉRER : tableau, chiffres ou verbatims correspondants]`,
      ),
    ].join('\n\n');
  }

  // ------------------------------------------------------------------ introduction et conclusion générales

  async writeGeneral(
    missionId: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<WrittenSection> {
    const nodes = this.d.outline.list(missionId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new AppError('E_INTERNAL', 'Section du plan introuvable.');
    const prior = this.latest(nodeId);
    if (prior)
      return {
        nodeId,
        version: prior.version,
        words: prior.word_count,
        checks: JSON.parse(prior.checks_json ?? '{}') as SectionChecks,
        skipped: true,
        placeholder: false,
      };
    const brief = this.brief(missionId);
    const analysis = this.d.analysis.get(missionId);
    const unitWords =
      writingUnits(nodes).find((u) => u.node.id === nodeId)?.words ?? node.targetWords;
    const kids = nodes.filter((n) => n.parentId === nodeId);
    const resumes = this.summaries(missionId, node, nodes, true);
    const allowed = new Set<string>([
      ...briefNumbers(brief, node),
      ...numberTokens(resumes).map((x) => x.canon),
    ]);
    if (analysis) this.d.analysis.allowedNumbers(analysis).forEach((x) => allowed.add(x));
    for (const r of this.d.db
      .prepare(
        'SELECT markdown FROM drafts d JOIN outline_nodes n ON n.id=d.outline_node_id WHERE n.mission_id=?',
      )
      .all(missionId) as { markdown: string }[])
      numberTokens(stripMarkers(r.markdown)).forEach((x) => allowed.add(x.canon));
    const chk: CheckCtx = {
      sources: new Map<string, SourceInfo>(),
      extracts: [],
      allowedNumbers: allowed,
      smallIntMax: this.d.cfg.smallIntMax,
      ngram: this.d.cfg.ngram,
      maxQuoteWords: this.d.cfg.maxQuoteWords,
    };
    const vars = {
      discipline: brief.discipline,
      nature: node.kind === 'introduction' ? 'introduction générale' : 'conclusion générale',
      type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
      titre: brief.titre,
      problematique: brief.problematique ?? '(à définir)',
      hypotheses: brief.hypotheses.join(' ; ') || '(aucune)',
      objectifs:
        [brief.objectifGeneral, ...brief.objectifsSpecifiques].filter(Boolean).join(' ; ') ||
        '(non précisés)',
      resultats_hypotheses: analysis
        ? `Statut des hypothèses (calculé) : ${analysis.interpretation.hypotheses.map((h) => `${h.hypothese} → ${h.statut === 'confirmee' ? 'confirmée' : h.statut === 'infirmee' ? 'infirmée' : 'nuancée'}`).join(' ; ') || 'aucune hypothèse formulée'}`
        : brief.approche === 'documentaire'
          ? ''
          : 'Aucune donnée de terrain n’a été fournie : ne présente aucun résultat de terrain.',
      mots_cibles: unitWords,
      sous_parties: kids.map((k) => `- ${k.title}`).join('\n') || '- (rédaction continue)',
      plan: missionContext(brief, nodes, this.d.cfg.missionContextMaxChars),
      resumes,
      registre: this.d.cfg.register,
      personne: this.d.cfg.person,
    };
    const first = await this.callWriter(
      missionId,
      'redaction:general',
      renderPrompt('section_writer/general', vars),
      signal,
    );
    const done = await this.refine(missionId, first, chk, {
      target: unitWords,
      withGrounding: false,
      tableIds: new Set(),
      signal,
      correct: (md, issues) =>
        this.callWriter(
          missionId,
          'redaction:correction',
          renderPrompt('section_writer/correct', {
            discipline: brief.discipline,
            numerotation: node.numbering ?? '',
            titre_section: node.title,
            markdown: md,
            problemes: this.issuesText(issues),
            sources_disponibles: '(aucune : ne cite aucune source dans cette partie)',
            extraits: '(aucun)',
            resultats: '',
            mots_cibles: unitWords,
          }),
          signal,
        ),
    });
    const summary = await this.summarize(missionId, node, done.md, allowed, signal);
    const saved = this.persist(
      missionId,
      node,
      done.md,
      done.checks,
      summary,
      [],
      chk,
      'section_writer',
    );
    this.reportSection(missionId, `${node.title}`, done.checks);
    return {
      nodeId,
      version: saved.version,
      words: done.checks.wordsActual,
      checks: done.checks,
      skipped: false,
      placeholder: false,
    };
  }

  // ------------------------------------------------------------------ pages liminaires

  /** Résumé et abstract rédigés à partir du travail ; dédicace, remerciements et avertissement : modèles à compléter, jamais inventés (§7.2). */
  async writeFrontMatter(missionId: string, signal?: AbortSignal): Promise<FrontMatterView[]> {
    const brief = this.brief(missionId);
    const nodes = this.d.outline.list(missionId);
    const have = new Set(
      (
        this.d.db.prepare('SELECT key FROM front_matter WHERE mission_id=?').all(missionId) as {
          key: string;
        }[]
      ).map((r) => r.key),
    );
    const save = (key: string, md: string, kind: 'genere' | 'a_completer', checks?: unknown) => {
      const t = nowIso();
      this.d.db
        .prepare(
          `INSERT INTO front_matter(id,mission_id,key,markdown,kind,checks_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(mission_id,key) DO UPDATE SET markdown=excluded.markdown, kind=excluded.kind, checks_json=excluded.checks_json, updated_at=excluded.updated_at`,
        )
        .run(newId(), missionId, key, md, kind, checks ? JSON.stringify(checks) : null, t, t);
    };
    const lim = brief.liminaires;
    if (lim.dedicace && !have.has('dedicace'))
      save(
        'dedicace',
        '[À COMPLÉTER : dédicace — page personnelle, jamais rédigée par l’agent]',
        'a_completer',
      );
    if (lim.remerciements && !have.has('remerciements'))
      save(
        'remerciements',
        [
          '[À COMPLÉTER : remerciements au directeur ou à la directrice de mémoire]',
          '[À COMPLÉTER : remerciements à la structure d’accueil ou aux enquêtés]',
          '[À COMPLÉTER : remerciements à la famille et aux proches]',
        ].join('\n\n'),
        'a_completer',
      );
    if (lim.avertissement && !have.has('avertissement'))
      save(
        'avertissement',
        '[À COMPLÉTER : avertissement de l’établissement — « L’université n’entend donner aucune approbation ni improbation aux opinions émises dans ce travail… »]',
        'a_completer',
      );

    if ((lim.resume || lim.abstract) && !have.has('resume')) {
      const analysis = this.d.analysis.get(missionId);
      const resumes = this.summaries(missionId, nodes[0]!, nodes, true);
      const allowed = new Set<string>([
        ...briefNumbers(brief),
        ...numberTokens(resumes).map((x) => x.canon),
      ]);
      if (analysis) this.d.analysis.allowedNumbers(analysis).forEach((x) => allowed.add(x));
      const r = await runStructured(this.d.caller, {
        missionId,
        taskId: null,
        role: 'summarizer',
        label: 'redaction:resume_global',
        messages: [
          {
            role: 'system',
            content: renderPrompt('summarizer/resume', {
              type_travail: WORK_TYPE_LABEL_FR[brief.workType].toLowerCase(),
              titre: brief.titre,
              problematique: brief.problematique ?? '(à définir)',
              resumes,
              resultats_hypotheses: analysis
                ? `Statut des hypothèses : ${analysis.interpretation.hypotheses.map((h) => `${h.hypothese} → ${h.statut}`).join(' ; ')}`
                : '',
            }),
          },
          { role: 'user', content: 'Rédige le résumé.' },
        ],
        schema: SummarySchema,
        schemaName: 'resume',
        temperature: 0.3,
        promptVersion: WRITING_PROMPT_VERSION,
        signal,
      });
      const cleaned = dropOrphanNumberSentences(r.output.resume, allowed, this.d.cfg.smallIntMax);
      const kw = r.output.mots_cles.slice(0, 6);
      save('resume', `${cleaned.text}\n\n**Mots-clés :** ${kw.join(', ')}`, 'genere', {
        sentencesDropped: cleaned.dropped,
        words: wordCount(cleaned.text),
      });
      if (lim.abstract && !have.has('abstract')) {
        const a = await runStructured(this.d.caller, {
          missionId,
          taskId: null,
          role: 'summarizer',
          label: 'redaction:abstract',
          messages: [
            {
              role: 'system',
              content: renderPrompt('summarizer/abstract', {
                resume: cleaned.text,
                mots_cles: kw.join(', '),
              }),
            },
            { role: 'user', content: 'Translate.' },
          ],
          schema: SummarySchema,
          schemaName: 'abstract',
          temperature: 0,
          promptVersion: WRITING_PROMPT_VERSION,
          signal,
        });
        // L'abstract est la SEULE production en anglais (§15.4) ; même contrôle des nombres que le résumé.
        const ca = dropOrphanNumberSentences(a.output.resume, allowed, this.d.cfg.smallIntMax);
        save(
          'abstract',
          `${ca.text}\n\n**Keywords:** ${a.output.mots_cles.slice(0, 6).join(', ')}`,
          'genere',
          { sentencesDropped: ca.dropped },
        );
      }
      this.say(
        missionId,
        'success',
        'summarizer',
        `Résumeur : ${lim.abstract ? 'résumé et abstract rédigés' : 'résumé rédigé'} ; dédicace et remerciements laissés à compléter.`,
      );
    }
    return this.frontMatter(missionId);
  }

  frontMatter(missionId: string): FrontMatterView[] {
    const rows = this.d.db
      .prepare('SELECT key, markdown, kind FROM front_matter WHERE mission_id=?')
      .all(missionId) as {
      key: string;
      markdown: string;
      kind: 'genere' | 'a_completer';
    }[];
    const order = ['avertissement', 'dedicace', 'remerciements', 'resume', 'abstract'];
    return rows
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      .map((r) => ({
        key: r.key,
        label: FRONT_LABEL[r.key] ?? r.key,
        kind: r.kind,
        markdown: r.markdown,
      }));
  }

  // ------------------------------------------------------------------ lecture pour l'interface

  list(missionId: string): SectionDraftSummary[] {
    const nodes = this.d.outline.list(missionId);
    const st = new Map(
      (
        this.d.db
          .prepare('SELECT id, status FROM outline_nodes WHERE mission_id=?')
          .all(missionId) as { id: string; status: SectionDraftSummary['status'] }[]
      ).map((r) => [r.id, r.status]),
    );
    return writingUnits(nodes).map(({ node, words }) => {
      const d = this.latest(node.id);
      const checks = d?.checks_json ? (JSON.parse(d.checks_json) as SectionChecks) : null;
      return {
        nodeId: node.id,
        numbering: node.numbering,
        title: node.title,
        kind: node.kind,
        status: st.get(node.id) ?? 'planned',
        version: d?.version ?? null,
        words: d?.word_count ?? null,
        wordsTarget: words,
        groundingRate: checks?.groundingRate ?? null,
        removed: checks?.removed.length ?? 0,
        warnings: checks?.warnings.length ?? 0,
        placeholder: Boolean(checks?.warnings.some((w) => w.includes('DONNÉES À INSÉRER'))),
      };
    });
  }

  detail(nodeId: string): SectionDraftDetail | null {
    const node = this.d.db
      .prepare('SELECT id, mission_id, numbering, title FROM outline_nodes WHERE id=?')
      .get(nodeId) as
      { id: string; mission_id: string; numbering: string | null; title: string } | undefined;
    const d = node ? this.latest(nodeId) : undefined;
    if (!node || !d) return null;
    const row = this.d.db
      .prepare('SELECT markdown, summary, word_count, version FROM drafts WHERE id=?')
      .get(d.id) as {
      markdown: string;
      summary: string | null;
      word_count: number;
      version: number;
    };
    const srcRows = this.d.db
      .prepare('SELECT id, title, authors_json, year FROM sources WHERE mission_id=?')
      .all(node.mission_id) as {
      id: string;
      title: string;
      authors_json: string | null;
      year: number | null;
    }[];
    const labels = new Map(
      srcRows.map((s) => [
        s.id,
        sourceLabel(JSON.parse(s.authors_json ?? '[]') as string[], s.year, s.title),
      ]),
    );
    const claimRows = this.d.db
      .prepare(
        `SELECT c.claim_text, c.source_id, c.support_level, ch.text AS excerpt, s.abstract AS abstract FROM claims c
         LEFT JOIN chunks ch ON ch.id=c.chunk_id LEFT JOIN sources s ON s.id=c.source_id WHERE c.draft_id=? ORDER BY c.sentence_index`,
      )
      .all(d.id) as {
      claim_text: string;
      source_id: string | null;
      support_level: SectionClaimView['supportLevel'];
      excerpt: string | null;
      abstract: string | null;
    }[];
    const cited = new Set([...row.markdown.matchAll(/\[@([0-9a-f-]{36})/g)].map((m) => m[1]!));
    const sources: Record<string, string> = {};
    for (const id of cited) if (labels.has(id)) sources[id] = labels.get(id)!;
    return {
      nodeId,
      numbering: node.numbering,
      title: node.title,
      version: row.version,
      markdown: row.markdown,
      summary: row.summary,
      wordCount: row.word_count,
      checks: d.checks_json ? (JSON.parse(d.checks_json) as SectionChecks) : null,
      claims: claimRows.map((c) => ({
        sentence: c.claim_text,
        sourceLabel: c.source_id ? (labels.get(c.source_id) ?? null) : null,
        supportLevel: c.support_level,
        excerpt: (c.excerpt ?? c.abstract)?.slice(0, 400) ?? null,
      })),
      sources,
    };
  }
}
