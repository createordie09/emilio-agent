import { AppError, type AgentRole } from '@emilio/shared';
import type { Db } from '../storage/db';
import { newId, nowIso } from '../storage/db';
import type { EventJournal } from '../events/journal';
import type { MissionRepo } from '../storage/missions';
import type { ModelCaller } from '../llm/call-model';
import type { MissionExecConfig } from '../llm/exec-config';
import { runStructured } from '../agents/execute';
import { renderPrompt, RESEARCH_PROMPT_VERSION } from '../agents/prompts';
import type { EmbeddingAdapter } from '../kb/embeddings';
import type { KbStore } from '../kb/store';
import type { IngestService } from '../kb/ingest';
import type { FileAdapter } from '../storage/file-adapter';
import { dedupe } from '../sources/dedup';
import { normalizeTitle } from '../sources/normalize';
import { CONNECTOR_LABELS, extraConnectorsForDiscipline, searchAll } from '../sources/registry';
import { combinedScore, qualityScore, type QualityWeights } from '../sources/score';
import { toCsl } from '../sources/csl';
import type { CandidateSource, SourceConnector } from '../sources/types';
import { verifyMany, type Arbiter, type VerifyDeps } from '../verification/verify';
import { acquireFullText, type FullTextDeps } from './fulltext';
import { buildReadingNote, type NoteSpec } from './reading-note';
import { ArbitrationSchema, QueriesSchema, RankSchema } from './schemas';

export type Depth = 'rapide' | 'normale' | 'approfondie';

/** Réglages selon la profondeur de recherche (CdC §7.6) : plus c'est profond, plus c'est long et coûteux. */
export const DEPTH: Record<
  Depth,
  { perQuery: number; queries: number; rankTop: number; fullText: number; notes: number }
> = {
  rapide: { perQuery: 10, queries: 3, rankTop: 15, fullText: 3, notes: 3 },
  normale: { perQuery: 20, queries: 4, rankTop: 30, fullText: 6, notes: 6 },
  approfondie: { perQuery: 40, queries: 6, rankTop: 30, fullText: 12, notes: 12 },
};

export type SectionSpec = {
  missionId: string;
  /** Identifiant du nœud du plan (J5) ; pour l'instant une clé libre stable. */
  sectionKey: string;
  title: string;
  objective: string;
  keyQuestions: string[];
  workType?: string;
  discipline?: string;
  depth?: Depth;
  /** Nombre minimal de sources vérifiées pour la section (§7.6 `minSourcesParSection`, défaut 3). */
  minSources?: number;
  /** Part minimale de sources de moins de 10 ans (§7.6, défaut 0,5). */
  recentShare?: number;
  prioriteAfrique?: boolean;
  requireIdentifier?: boolean;
  yearFrom?: number;
  signal?: AbortSignal;
};

export type RetainedSource = {
  sourceId: string;
  title: string;
  status: 'verified' | 'partially_verified' | 'user_upload';
  score: number;
  fullText: 'fulltext' | 'abstract_only' | 'none';
};

export type SectionResearchResult = {
  sectionKey: string;
  iterations: number;
  found: number;
  merged: number;
  verified: number;
  rejected: { sourceId: string; title: string; reasonFr: string }[];
  unverified: number;
  retained: RetainedSource[];
  notes: number;
  quotesDropped: number;
  byConnector: Record<string, number>;
  warnings: string[];
  coverageOk: boolean;
};

export type ResearchDeps = {
  db: Db;
  missions: MissionRepo;
  journal: EventJournal;
  caller: ModelCaller;
  store: KbStore;
  ingest: IngestService;
  embedder: () => EmbeddingAdapter;
  files: FileAdapter;
  dataDir: string;
  weights: QualityWeights;
  /** Connecteurs de recherche, selon le mode de la mission (simulé ou réel). */
  connectors: (mode: MissionExecConfig['llmMode'], extra: string[]) => SourceConnector[];
  /** Connecteur d'un identifiant donné (vérification des DOI, accès ouvert). */
  connector: (mode: MissionExecConfig['llmMode'], id: string) => SourceConnector | undefined;
  verifyDeps: (mode: MissionExecConfig['llmMode']) => Pick<VerifyDeps, 'books' | 'http'>;
  fullTextHttp: (mode: MissionExecConfig['llmMode']) => FullTextDeps['http'];
  now?: () => number;
};

type Row = { id: string; doi: string | null; title: string; year: number | null };
type Scored = {
  c: CandidateSource;
  sourceId: string;
  relevance: number;
  quality: number;
  score: number;
  keep: boolean;
};

const cos = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/**
 * Recherche approfondie d'une section (CdC §9 P3) : requêtes → connecteurs → déduplication → score et classement →
 * vérification → texte intégral → fiches de lecture → contrôle de couverture (jusqu'à 3 itérations élargies).
 * Un connecteur en panne est ignoré ; une source non vérifiée n'est jamais retenue.
 */
export class ResearchService {
  constructor(private readonly d: ResearchDeps) {}

  private say(
    missionId: string,
    level: 'info' | 'success' | 'warning',
    agentRole: AgentRole,
    messageFr: string,
  ) {
    this.d.journal.record({ missionId, level, agentRole, messageFr });
  }

  async researchSection(spec: SectionSpec): Promise<SectionResearchResult> {
    const { missionId } = spec;
    const cfg = this.d.missions.config<MissionExecConfig>(missionId);
    const mode = cfg.llmMode;
    const depth = DEPTH[spec.depth ?? 'normale'];
    const minSources = spec.minSources ?? 3;
    const recentShare = spec.recentShare ?? 0.5;
    const connectors = this.d.connectors(mode, extraConnectorsForDiscipline(spec.discipline));
    const result: SectionResearchResult = {
      sectionKey: spec.sectionKey,
      iterations: 0,
      found: 0,
      merged: 0,
      verified: 0,
      rejected: [],
      unverified: 0,
      retained: [],
      notes: 0,
      quotesDropped: 0,
      byConnector: {},
      warnings: [],
      coverageOk: false,
    };
    const warn = (m: string) => {
      result.warnings.push(m);
      this.say(missionId, 'warning', 'researcher', m);
    };
    const failedConnectors = new Set<string>();
    const onFail = (id: string, e: unknown) => {
      if (failedConnectors.has(id)) return;
      failedConnectors.add(id);
      const why = e instanceof AppError ? e.messageFr : (e as Error).message;
      warn(`Source ${CONNECTOR_LABELS[id] ?? id} ignorée : ${why}`);
    };

    const emb = this.d.embedder();
    const [qv] = await emb.embedPassages([
      `${spec.title}. ${spec.objective} ${spec.keyQuestions.join(' ')}`,
    ]);
    const scoredBySource = new Map<string, Scored>();
    const usedQueries: string[] = [];
    const verifiedIds = new Set<string>();

    for (let iter = 0; iter < 3; iter++) {
      result.iterations = iter + 1;
      // 1. Requêtes (FR + EN) ; aux itérations suivantes, élargissement (synonymes, concepts voisins).
      const queries = await this.generateQueries(spec, depth.queries, usedQueries, iter);
      usedQueries.push(...queries.map((q) => q.texte));

      // 2. Connecteurs en parallèle, panne isolée.
      const raw = await searchAll(
        connectors,
        queries.map((q) => ({ text: q.texte, language: q.langue })),
        { limit: depth.perQuery, yearFrom: spec.yearFrom },
        onFail,
      );
      const merged = dedupe(raw).filter((c) => !scoredBySource.has(this.key(c)));
      for (const c of raw) result.byConnector[c.origin] = (result.byConnector[c.origin] ?? 0) + 1;
      result.found += raw.length;
      result.merged += merged.length;
      if (merged.length) {
        this.say(
          missionId,
          'info',
          'researcher',
          `Chercheur (${spec.title}) : ${merged.length} nouvelle(s) source(s) trouvée(s) — ${Object.entries(
            result.byConnector,
          )
            .map(([k, v]) => `${CONNECTOR_LABELS[k] ?? k} ${v}`)
            .join(', ')}.`,
        );
      }

      // 3. Score de pertinence (embeddings) et de qualité ; classement par le modèle sur les meilleurs candidats.
      const vecs = merged.length
        ? await emb.embedPassages(
            merged.map((c) => `${c.title}. ${c.abstract ?? ''}`.slice(0, 2000)),
          )
        : [];
      const sims = vecs.map((v) => cos(qv!, v));
      const lo = Math.min(...sims, 1);
      const hi = Math.max(...sims, -1);
      const rows: Scored[] = merged.map((c, i) => {
        const relevance = hi > lo ? (sims[i]! - lo) / (hi - lo) : 0.5;
        const quality = qualityScore(c, this.d.weights, {
          prioriteAfrique: spec.prioriteAfrique,
          weightRecent: recentShare > 0,
        });
        return {
          c,
          sourceId: this.upsertSource(missionId, c, relevance, quality),
          relevance,
          quality,
          score: combinedScore(relevance, quality, this.d.weights),
          keep: true,
        };
      });
      rows.sort((a, b) => b.score - a.score);
      await this.rank(spec, rows.slice(0, depth.rankTop));
      for (const r of rows) scoredBySource.set(this.key(r.c), r);

      // 4. Vérification des meilleurs candidats (jamais de citation sans vérification).
      const pool = [...scoredBySource.values()]
        .filter((r) => r.keep && !verifiedIds.has(r.sourceId))
        .sort((a, b) => b.score - a.score);
      const toVerify = pool.slice(0, Math.max(minSources * 2, 12));
      await this.verify(spec, toVerify, mode, result, verifiedIds);

      // 5. Sélection et contrôle de couverture.
      result.retained = this.select(spec, mode, minSources, recentShare, scoredBySource);
      if (result.retained.length >= minSources) break;
      if (iter < 2)
        this.say(
          missionId,
          'info',
          'researcher',
          `Chercheur (${spec.title}) : couverture insuffisante (${result.retained.length}/${minSources}), recherche élargie.`,
        );
    }

    // 6. Sources importées par l'utilisateur : prioritaires, déjà « vérifiées » par définition (§11.4).
    await this.addUserDocs(spec, result);

    // 7. Texte intégral et fiches de lecture pour les meilleures sources retenues.
    await this.readSources(spec, mode, depth, result);

    result.coverageOk = result.retained.length >= minSources;
    if (!result.coverageOk)
      warn(
        `Peu de sources trouvées pour la section « ${spec.title} » (${result.retained.length}/${minSources}) : à compléter par vos propres documents.`,
      );
    this.writeMatrix(spec, result, scoredBySource);
    this.say(
      missionId,
      result.coverageOk ? 'success' : 'warning',
      'researcher',
      `Recherche terminée (${spec.title}) : ${result.retained.length} source(s) retenue(s), ${result.verified} vérifiée(s), ${result.rejected.length} rejetée(s), ${result.notes} fiche(s) de lecture.`,
    );
    return result;
  }

  /**
   * Recherche exploratoire pour le plan (CdC §9 P2.1–2.2) : ≈ 30 à 60 candidats (métadonnées et résumés seulement),
   * vérification rapide de l'existence des DOI, sans texte intégral ni fiche de lecture.
   */
  async explore(spec: {
    missionId: string;
    topic: string;
    queries: { texte: string; langue: 'fr' | 'en' }[];
    perQuery: number;
    maxCandidates: number;
    discipline?: string;
    prioriteAfrique?: boolean;
    signal?: AbortSignal;
  }): Promise<{
    sources: {
      id: string;
      title: string;
      authors: string[];
      year: number | null;
      abstract: string | null;
      status: 'unverified' | 'verified' | 'partially_verified' | 'rejected';
    }[];
    found: number;
    byConnector: Record<string, number>;
    warnings: string[];
  }> {
    const { missionId } = spec;
    const mode = this.d.missions.config<MissionExecConfig>(missionId).llmMode;
    const connectors = this.d.connectors(mode, extraConnectorsForDiscipline(spec.discipline));
    const warnings: string[] = [];
    const failed = new Set<string>();
    const raw = await searchAll(
      connectors,
      spec.queries.map((q) => ({ text: q.texte, language: q.langue })),
      { limit: spec.perQuery },
      (id, e) => {
        if (failed.has(id)) return;
        failed.add(id);
        const why = e instanceof AppError ? e.messageFr : (e as Error).message;
        warnings.push(`Source ${CONNECTOR_LABELS[id] ?? id} ignorée : ${why}`);
      },
    );
    const byConnector: Record<string, number> = {};
    for (const c of raw) byConnector[c.origin] = (byConnector[c.origin] ?? 0) + 1;
    const merged = dedupe(raw);
    const emb = this.d.embedder();
    const [qv] = await emb.embedPassages([spec.topic]);
    const vecs = merged.length
      ? await emb.embedPassages(merged.map((c) => `${c.title}. ${c.abstract ?? ''}`.slice(0, 2000)))
      : [];
    const sims = vecs.map((v) => cos(qv!, v));
    const lo = Math.min(...sims, 1);
    const hi = Math.max(...sims, -1);
    const rows = merged
      .map((c, i) => {
        const relevance = hi > lo ? (sims[i]! - lo) / (hi - lo) : 0.5;
        const quality = qualityScore(c, this.d.weights, { prioriteAfrique: spec.prioriteAfrique });
        return { c, relevance, quality, score: combinedScore(relevance, quality, this.d.weights) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, spec.maxCandidates)
      .map((r) => ({ ...r, id: this.upsertSource(missionId, r.c, r.relevance, r.quality) }));

    // Vérification rapide : existence des DOI (Crossref puis OpenAlex), sans arbitrage par un modèle.
    const doiSources = (['crossref', 'openalex'] as const).flatMap((id) => {
      const c = this.d.connector(mode, id);
      return c ? [{ id, connector: c }] : [];
    });
    const base = this.d.verifyDeps(mode);
    const results = rows.length
      ? await verifyMany(
          rows.map((r) => r.c),
          { doiSources, books: base.books, http: base.http, requireIdentifier: false },
        )
      : [];
    const upd = this.d.db.prepare(
      'UPDATE sources SET verification_status=?, verification_json=?, updated_at=? WHERE id=?',
    );
    const status = new Map<string, 'unverified' | 'verified' | 'partially_verified' | 'rejected'>();
    rows.forEach((r, i) => {
      const v = results[i];
      if (!v) return status.set(r.id, 'unverified');
      upd.run(v.status, JSON.stringify(v.evidence), nowIso(), r.id);
      status.set(r.id, v.status as 'verified' | 'partially_verified' | 'rejected');
    });
    return {
      sources: rows.map((r) => ({
        id: r.id,
        title: r.c.title,
        authors: r.c.authors,
        year: r.c.year ?? null,
        abstract: r.c.abstract ?? null,
        status: status.get(r.id) ?? 'unverified',
      })),
      found: raw.length,
      byConnector,
      warnings,
    };
  }

  private key(c: CandidateSource): string {
    return c.doi ? `doi:${c.doi}` : `t:${normalizeTitle(c.title)}|${c.year ?? ''}`;
  }

  private async generateQueries(
    spec: SectionSpec,
    n: number,
    previous: string[],
    iter: number,
  ): Promise<{ texte: string; langue: 'fr' | 'en' }[]> {
    const mode =
      iter === 0
        ? ''
        : `Requêtes déjà essayées (ne les répète pas, élargis : synonymes, concepts voisins, termes anglais) :\n${previous.map((p) => `- ${p}`).join('\n')}`;
    const system = renderPrompt('researcher/queries', {
      type_travail: spec.workType ?? 'travail académique',
      discipline: spec.discipline ?? 'sciences humaines et sociales',
      titre_section: spec.title,
      objectif: spec.objective,
      questions_cles: spec.keyQuestions.map((q) => `- ${q}`).join('\n') || '- (non précisées)',
      mode,
      nombre: n,
    });
    try {
      const r = await runStructured(this.d.caller, {
        missionId: spec.missionId,
        taskId: null,
        role: 'researcher',
        label: 'recherche:requetes',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Propose les requêtes.' },
        ],
        schema: QueriesSchema,
        schemaName: 'requetes',
        temperature: 0.2,
        promptVersion: RESEARCH_PROMPT_VERSION,
        signal: spec.signal,
      });
      const qs = r.output.requetes.filter((q) => !previous.includes(q.texte));
      if (qs.length) return qs.slice(0, n + 2);
    } catch (e) {
      // Pannes de crédit / réseau / budget : on remonte pour que la mission se mette en pause (§8.6).
      if (
        e instanceof AppError &&
        ['E_NO_CREDIT', 'E_BUDGET', 'E_NETWORK', 'E_KEY_INVALID', 'E_KEY_MISSING'].includes(e.code)
      )
        throw e;
    }
    // Repli déterministe : titre de la section et mots de l'objectif.
    const words = spec.objective
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 4)
      .join(' ');
    return [
      { texte: spec.title, langue: 'fr' as const },
      ...(words ? [{ texte: words, langue: 'fr' as const }] : []),
    ].filter((q) => !previous.includes(q.texte));
  }

  /** Classement par le modèle (0–10) des meilleurs candidats ; mélangé au score calculé (§9 P3.3). */
  private async rank(spec: SectionSpec, top: Scored[]): Promise<void> {
    if (!top.length) return;
    const alias = new Map(top.map((r, i) => [`C${i + 1}`, r]));
    const candidats = [...alias]
      .map(
        ([a, r]) =>
          `- [${a}] ${r.c.title} (${r.c.year ?? 's.d.'}${r.c.journal ? `, ${r.c.journal}` : ''}) — ${(r.c.abstract ?? 'pas de résumé').slice(0, 400)}`,
      )
      .join('\n');
    const system = renderPrompt('researcher/rank', {
      type_travail: spec.workType ?? 'travail académique',
      discipline: spec.discipline ?? 'sciences humaines et sociales',
      titre_section: spec.title,
      objectif: spec.objective,
      questions_cles: spec.keyQuestions.map((q) => `- ${q}`).join('\n') || '- (non précisées)',
      candidats,
    });
    try {
      const r = await runStructured(this.d.caller, {
        missionId: spec.missionId,
        taskId: null,
        role: 'researcher',
        label: 'recherche:classement',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Évalue les candidats.' },
        ],
        schema: RankSchema,
        schemaName: 'classement',
        temperature: 0.2,
        promptVersion: RESEARCH_PROMPT_VERSION,
        signal: spec.signal,
      });
      for (const ev of r.output.evaluations) {
        const row = alias.get(ev.id);
        if (!row) continue; // identifiant inventé par le modèle : ignoré
        row.score = 0.5 * row.score + 0.5 * (ev.score / 10);
        row.keep = ev.garder;
        if (!ev.garder) row.score *= 0.3;
      }
    } catch (e) {
      if (
        e instanceof AppError &&
        ['E_NO_CREDIT', 'E_BUDGET', 'E_NETWORK', 'E_KEY_INVALID', 'E_KEY_MISSING'].includes(e.code)
      )
        throw e;
      // Échec de classement : on garde le score calculé seul.
    }
  }

  private arbiter(spec: SectionSpec): Arbiter {
    return async (a, b, base) => {
      const fmt = (c: CandidateSource) =>
        `${c.authors.slice(0, 3).join('; ') || 'auteurs inconnus'} (${c.year ?? 's.d.'}). ${c.title}${c.journal ? `. ${c.journal}` : ''}`;
      const system = renderPrompt('source_verifier/arbitration', {
        annoncee: fmt(a),
        retrouvee: fmt(b),
        base,
      });
      const r = await runStructured(this.d.caller, {
        missionId: spec.missionId,
        taskId: null,
        role: 'source_verifier',
        label: 'recherche:arbitrage',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Décide.' },
        ],
        schema: ArbitrationSchema,
        schemaName: 'arbitrage',
        temperature: 0,
        promptVersion: RESEARCH_PROMPT_VERSION,
        signal: spec.signal,
      });
      return { same: r.output.meme_document, justification: r.output.justification };
    };
  }

  private async verify(
    spec: SectionSpec,
    rows: Scored[],
    mode: MissionExecConfig['llmMode'],
    result: SectionResearchResult,
    done: Set<string>,
  ): Promise<void> {
    if (!rows.length) return;
    const doiSources = (['crossref', 'openalex'] as const).flatMap((id) => {
      const c = this.d.connector(mode, id);
      return c ? [{ id, connector: c }] : [];
    });
    const base = this.d.verifyDeps(mode);
    const results = await verifyMany(
      rows.map((r) => r.c),
      {
        doiSources,
        books: base.books,
        http: base.http,
        arbitrate: this.arbiter(spec),
        requireIdentifier: spec.requireIdentifier ?? true,
      },
    );
    let ok = 0;
    let rej = 0;
    rows.forEach((r, i) => {
      const v = results[i];
      if (!v) {
        result.unverified++;
        return;
      }
      done.add(r.sourceId);
      this.d.db
        .prepare(
          'UPDATE sources SET verification_status=?, verification_json=?, updated_at=? WHERE id=?',
        )
        .run(v.status, JSON.stringify(v.evidence), nowIso(), r.sourceId);
      if (v.status === 'rejected') {
        rej++;
        result.rejected.push({
          sourceId: r.sourceId,
          title: r.c.title,
          reasonFr: v.reasonFr ?? 'Rejetée',
        });
      } else ok++;
    });
    result.verified += ok;
    this.say(
      spec.missionId,
      ok ? 'success' : 'info',
      'source_verifier',
      `Vérificateur : ${ok} source(s) vérifiée(s), ${rej} rejetée(s)${rej ? ` (${[...new Set(result.rejected.slice(-rej).map((x) => x.reasonFr.split(' (')[0]))].join(' ; ')})` : ''}.`,
    );
  }

  /** Sources vérifiées les mieux classées, avec un rééquilibrage vers les sources récentes (§7.6). */
  private select(
    spec: SectionSpec,
    mode: MissionExecConfig['llmMode'],
    minSources: number,
    recentShare: number,
    scored: Map<string, Scored>,
  ): RetainedSource[] {
    const status = (id: string) =>
      (
        this.d.db.prepare('SELECT verification_status s FROM sources WHERE id=?').get(id) as {
          s: string;
        }
      ).s;
    const ok = [...scored.values()]
      .filter((r) => ['verified', 'partially_verified'].includes(status(r.sourceId)))
      .sort((a, b) => b.score - a.score);
    const max = Math.max(minSources + 2, Math.ceil(minSources * 1.5));
    let pick = ok.slice(0, max);
    const isRecent = (r: Scored) =>
      (r.c.year ?? 0) >= new Date(this.d.now?.() ?? Date.now()).getFullYear() - 10;
    const need = Math.ceil(recentShare * pick.length);
    if (pick.filter(isRecent).length < need) {
      const spare = ok.slice(max).filter(isRecent);
      for (const s of spare) {
        if (pick.filter(isRecent).length >= need) break;
        const idx = [...pick].reverse().findIndex((p) => !isRecent(p));
        if (idx < 0) break;
        pick.splice(pick.length - 1 - idx, 1, s);
      }
      pick = pick.sort((a, b) => b.score - a.score);
    }
    void mode;
    return pick.map((r) => ({
      sourceId: r.sourceId,
      title: r.c.title,
      status: status(r.sourceId) as RetainedSource['status'],
      score: r.score,
      fullText: 'none' as const,
    }));
  }

  private async addUserDocs(spec: SectionSpec, result: SectionResearchResult): Promise<void> {
    const hits = await this.d.store.search(this.d.embedder(), {
      missionId: spec.missionId,
      query: `${spec.title} ${spec.objective}`,
      limit: 12,
    });
    const ids = new Set(result.retained.map((r) => r.sourceId));
    for (const h of hits) {
      const s = this.d.db
        .prepare(
          "SELECT id,title,type FROM sources WHERE id=? AND origin='user_upload' AND type != 'document_interne'",
        )
        .get(h.sourceId) as { id: string; title: string; type: string } | undefined;
      if (!s || ids.has(s.id)) continue;
      ids.add(s.id);
      result.retained.unshift({
        sourceId: s.id,
        title: s.title,
        status: 'user_upload',
        score: 1,
        fullText: 'fulltext',
      });
    }
  }

  private async readSources(
    spec: SectionSpec,
    mode: MissionExecConfig['llmMode'],
    depth: (typeof DEPTH)[Depth],
    result: SectionResearchResult,
  ): Promise<void> {
    const oaProviders = (['unpaywall', 'openalex', 'semantic_scholar'] as const).flatMap((id) => {
      const c = this.d.connector(mode, id);
      return c ? [c] : [];
    });
    const ftDeps: FullTextDeps = {
      http: this.d.fullTextHttp(mode),
      ingest: this.d.ingest,
      files: this.d.files,
      dataDir: this.d.dataDir,
      oaProviders,
    };
    const noteSpec: NoteSpec = {
      title: spec.title,
      objective: spec.objective,
      keyQuestions: spec.keyQuestions,
      workType: spec.workType,
      discipline: spec.discipline,
    };
    let ft = 0;
    let notes = 0;
    for (const r of result.retained) {
      const row = this.d.db.prepare('SELECT * FROM sources WHERE id=?').get(r.sourceId) as Record<
        string,
        string | number | null
      >;
      if (r.status !== 'user_upload' && ft < depth.fullText) {
        ft++;
        const o = await acquireFullText(
          ftDeps,
          spec.missionId,
          {
            id: r.sourceId,
            title: String(row.title),
            doi: (row.doi as string) ?? undefined,
            oaPdfUrl: (row.oa_pdf_url as string) ?? undefined,
            abstract: (row.abstract as string) ?? undefined,
          },
          spec.signal,
        );
        r.fullText = o.status;
        this.d.db
          .prepare('UPDATE sources SET fulltext_status=?, updated_at=? WHERE id=?')
          .run(o.status, nowIso(), r.sourceId);
      } else if (r.status !== 'user_upload' && row.abstract) {
        // Au-delà du quota de textes intégraux : le résumé seul reste ancrable.
        const have = (
          this.d.db.prepare('SELECT COUNT(*) n FROM chunks WHERE source_id=?').get(r.sourceId) as {
            n: number;
          }
        ).n;
        if (!have) {
          await this.d.ingest.indexPages(spec.missionId, r.sourceId, [
            { page: null, text: String(row.abstract) },
          ]);
          this.d.db
            .prepare("UPDATE sources SET fulltext_status='abstract_only', updated_at=? WHERE id=?")
            .run(nowIso(), r.sourceId);
          r.fullText = 'abstract_only';
        }
      }
      if (notes < depth.notes) {
        const note = await buildReadingNote(
          {
            db: this.d.db,
            caller: this.d.caller,
            store: this.d.store,
            embedder: this.d.embedder(),
          },
          {
            missionId: spec.missionId,
            sectionKey: spec.sectionKey,
            spec: noteSpec,
            signal: spec.signal,
            source: {
              id: r.sourceId,
              title: String(row.title),
              authors: row.authors_json ? (JSON.parse(String(row.authors_json)) as string[]) : [],
              year: row.year as number | null,
              journal: row.journal as string | null,
              doi: row.doi as string | null,
            },
          },
        );
        if (note) {
          notes++;
          result.quotesDropped += note.citationsEcartees;
        }
      }
    }
    result.notes = notes;
  }

  private writeMatrix(
    spec: SectionSpec,
    result: SectionResearchResult,
    scored: Map<string, Scored>,
  ): void {
    const rel = new Map([...scored.values()].map((s) => [s.sourceId, s.relevance]));
    const t = nowIso();
    this.d.db.transaction(() => {
      this.d.db
        .prepare('DELETE FROM section_sources WHERE mission_id=? AND section_key=?')
        .run(spec.missionId, spec.sectionKey);
      const ins = this.d.db.prepare(
        'INSERT INTO section_sources(mission_id,section_key,source_id,relevance,rank,created_at) VALUES (?,?,?,?,?,?)',
      );
      result.retained.forEach((r, i) =>
        ins.run(spec.missionId, spec.sectionKey, r.sourceId, rel.get(r.sourceId) ?? 1, i + 1, t),
      );
    })();
  }

  /** Insère la source si elle n'existe pas déjà dans la mission (DOI, puis titre normalisé + année) ; renvoie son identifiant. */
  private upsertSource(
    missionId: string,
    c: CandidateSource,
    relevance: number,
    quality: number,
  ): string {
    const existing = this.d.db
      .prepare('SELECT id, doi, title, year FROM sources WHERE mission_id=?')
      .all(missionId) as Row[];
    const nt = normalizeTitle(c.title);
    const hit = existing.find(
      (e) =>
        (c.doi && e.doi === c.doi) ||
        (normalizeTitle(e.title) === nt && (e.year ?? null) === (c.year ?? null)),
    );
    if (hit) {
      this.d.db
        .prepare('UPDATE sources SET relevance_score=?, quality_score=?, updated_at=? WHERE id=?')
        .run(relevance, quality, nowIso(), hit.id);
      return hit.id;
    }
    const id = newId();
    const t = nowIso();
    this.d.db
      .prepare(
        `INSERT INTO sources(id,mission_id,origin,type,title,authors_json,year,publisher,journal,volume,issue,pages,doi,isbn,url,oa_pdf_url,language,abstract,
           fulltext_status,verification_status,relevance_score,quality_score,csl_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        missionId,
        c.origin,
        c.type,
        c.title,
        JSON.stringify(c.authors),
        c.year ?? null,
        c.publisher ?? null,
        c.journal ?? null,
        c.volume ?? null,
        c.issue ?? null,
        c.pages ?? null,
        c.doi ?? null,
        c.isbn ?? null,
        c.url ?? null,
        c.oaPdfUrl ?? null,
        c.language ?? null,
        c.abstract ?? null,
        'none',
        'unverified',
        relevance,
        quality,
        JSON.stringify(toCsl(c, id)),
        t,
        t,
      );
    return id;
  }
}
