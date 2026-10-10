import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  BriefSchema,
  DELIVERABLE_LABEL_FR,
  WORK_TYPE_LABEL_FR,
  type AgentRole,
  type Brief,
  type DeliverableKind,
  type DeliverableView,
  type ExportOverview,
  type FinalCheckView,
} from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { EventJournal } from '../events/journal';
import type { ModelCaller } from '../llm/call-model';
import type { OutlineRepo } from '../planning/outline';
import type { DataAnalysisService, StoredAnalysis } from '../analysis/service';
import type { JuryService } from '../jury/service';
import { runStructured } from '../agents/execute';
import { renderPrompt } from '../agents/prompts';
import { numbersToJustify } from '../writing/checks';
import { numberSet } from '../util/numbers';
import { missionContext } from '../writing/context';
import { assembleDocument } from './assemble';
import {
  loadExportConfig,
  loadExportProfiles,
  resolveProfile,
  type ExportConfig,
  type ProfilesFile,
} from './config';
import { buildDocx } from './docx';
import { buildFiche, type FicheQuestion } from './fiche';
import { finalCheck, reopenDocx } from './final-check';
import { buildHtml, tocHeadings } from './html';
import { plainOf, type DocModel, type TableBlock } from './model';
import { findMarkPages, type PdfAdapter } from './pdf';
import { buildPptx, type FinalSlide } from './pptx';
import { buildReportHtml, type ReportData } from './report';
import { DeckSchema, QuestionsSchema } from './schemas';

export const EXPORT_PROMPT_VERSION = 'livrables-1';
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

export type ExportDeps = {
  db: Db;
  journal: EventJournal;
  caller: ModelCaller;
  outline: OutlineRepo;
  analysis: DataAnalysisService;
  jury: JuryService;
  resourcesDir: string | undefined;
  dataDir: string;
  pdf: () => PdfAdapter | undefined;
};

type SlideKind =
  | 'titre'
  | 'plan'
  | 'contexte'
  | 'problematique'
  | 'objectifs'
  | 'cadre'
  | 'methodologie'
  | 'terrain'
  | 'resultats'
  | 'discussion'
  | 'hypotheses'
  | 'recommandations'
  | 'limites'
  | 'conclusion';
const SLIDE_TITLE: Record<SlideKind, string> = {
  titre: 'Titre',
  plan: 'Plan de la présentation',
  contexte: 'Contexte et justification',
  problematique: 'Problématique et questions de recherche',
  objectifs: 'Objectifs et hypothèses',
  cadre: 'Cadre théorique',
  methodologie: 'Méthodologie',
  terrain: 'Terrain d’étude',
  resultats: 'Résultats clés',
  discussion: 'Discussion',
  hypotheses: 'Vérification des hypothèses',
  recommandations: 'Recommandations',
  limites: 'Limites et perspectives',
  conclusion: 'Conclusion',
};
const BASE: SlideKind[] = [
  'titre',
  'plan',
  'contexte',
  'problematique',
  'objectifs',
  'cadre',
  'methodologie',
  'terrain',
  'resultats',
  'resultats',
  'discussion',
  'hypotheses',
  'recommandations',
  'limites',
  'conclusion',
];
/** Diapositives retirées en premier quand le nombre demandé est inférieur à 15. */
const DROP_ORDER: SlideKind[] = [
  'terrain',
  'objectifs',
  'cadre',
  'recommandations',
  'discussion',
  'contexte',
  'limites',
];

/** Structure du diaporama (§16.3) pour `n` diapositives : 15 par défaut ; au-delà, des diapositives de résultats en plus. */
export function slideStructure(n: number): SlideKind[] {
  const s = [...BASE];
  if (n > s.length) {
    const at = s.lastIndexOf('resultats') + 1;
    s.splice(at, 0, ...Array<SlideKind>(n - s.length).fill('resultats'));
  }
  for (const k of DROP_ORDER) {
    if (s.length <= n) break;
    const i = s.indexOf(k);
    if (i >= 0) s.splice(i, 1);
  }
  while (
    s.length > n &&
    s.includes('resultats') &&
    s.indexOf('resultats') !== s.lastIndexOf('resultats')
  )
    s.splice(s.lastIndexOf('resultats'), 1);
  return s.slice(0, Math.max(n, 5));
}

const slug = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'travail';

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const clipWords = (s: string, n: number): string => {
  const w = words(s);
  return w.length <= n
    ? s.trim()
    : w
        .slice(0, n)
        .join(' ')
        .replace(/[,;:]$/, '') + '…';
};

/** Livrables (CdC §9 P8–P9, §16) : mise en forme, DOCX, PDF, diaporama, fiche de préparation, rapport de mission, contrôle final. */
export class ExportService {
  private readonly cfg: ExportConfig;

  constructor(private readonly d: ExportDeps) {
    this.cfg = loadExportConfig(d.resourcesDir);
  }

  /** Chargé à la demande : un moteur sans ressources de mise en forme doit quand même démarrer. */
  private profilesFile(): ProfilesFile {
    return loadExportProfiles(this.d.resourcesDir);
  }

  private brief(missionId: string): Brief {
    const r = this.d.db.prepare('SELECT brief_json FROM missions WHERE id=?').get(missionId) as
      { brief_json: string | null } | undefined;
    if (!r) throw new AppError('E_BAD_REQUEST', 'Mission introuvable.');
    return BriefSchema.parse(JSON.parse(r.brief_json ?? '{}'));
  }

  private say(
    missionId: string,
    level: 'info' | 'success' | 'warning',
    role: AgentRole,
    msg: string,
  ) {
    this.d.journal.record({ missionId, level, agentRole: role, messageFr: msg });
  }

  /** Assemble le document complet (texte courant, citations, bibliographie, listes). */
  assemble(missionId: string): DocModel {
    if (!this.d.resourcesDir)
      throw new AppError(
        'E_ENGINE',
        'Les ressources de mise en forme sont introuvables : réinstallez l’application.',
      );
    return assembleDocument({
      db: this.d.db,
      missionId,
      nodes: this.d.outline.list(missionId),
      analysis: this.d.analysis.get(missionId),
      resourcesDir: this.d.resourcesDir,
      profiles: this.profilesFile(),
      config: this.cfg,
    });
  }

  // ------------------------------------------------------------------ état

  private dir(missionId: string): string {
    const p = join(this.d.dataDir, 'missions', missionId, 'livrables');
    mkdirSync(p, { recursive: true });
    return p;
  }

  private state(missionId: string): {
    skipped: { kind: DeliverableKind; reasonFr: string }[];
    bib: ExportOverview['bibliography'];
    check: FinalCheckView | null;
  } {
    const r = this.d.db
      .prepare(
        'SELECT final_check_json, bibliography_json, skipped_json FROM export_state WHERE mission_id=?',
      )
      .get(missionId) as
      | {
          final_check_json: string | null;
          bibliography_json: string | null;
          skipped_json: string | null;
        }
      | undefined;
    return {
      skipped: r?.skipped_json
        ? (JSON.parse(r.skipped_json) as { kind: DeliverableKind; reasonFr: string }[])
        : [],
      bib: r?.bibliography_json
        ? (JSON.parse(r.bibliography_json) as ExportOverview['bibliography'])
        : null,
      check: r?.final_check_json ? (JSON.parse(r.final_check_json) as FinalCheckView) : null,
    };
  }

  private saveState(
    missionId: string,
    patch: {
      skipped?: { kind: DeliverableKind; reasonFr: string }[];
      bib?: ExportOverview['bibliography'];
      check?: FinalCheckView;
    },
  ): void {
    const cur = this.state(missionId);
    this.d.db
      .prepare(
        `INSERT INTO export_state(mission_id, final_check_json, bibliography_json, skipped_json, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(mission_id) DO UPDATE SET final_check_json=excluded.final_check_json, bibliography_json=excluded.bibliography_json, skipped_json=excluded.skipped_json, updated_at=excluded.updated_at`,
      )
      .run(
        missionId,
        JSON.stringify(patch.check ?? cur.check),
        JSON.stringify(patch.bib ?? cur.bib),
        JSON.stringify(patch.skipped ?? cur.skipped),
        nowIso(),
      );
  }

  private skip(missionId: string, kind: DeliverableKind, reasonFr: string): void {
    const cur = this.state(missionId).skipped.filter((s) => s.kind !== kind);
    this.saveState(missionId, { skipped: [...cur, { kind, reasonFr }] });
    this.say(
      missionId,
      'warning',
      'bibliographer',
      `${DELIVERABLE_LABEL_FR[kind]} non produit : ${reasonFr}`,
    );
  }

  private record(
    missionId: string,
    kind: DeliverableKind,
    filename: string,
    path: string,
  ): DeliverableView {
    const size = statSync(path).size;
    const t = nowIso();
    const id = newId();
    this.d.db
      .prepare(
        `INSERT INTO deliverables(id,mission_id,kind,filename,path,size_bytes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(mission_id,kind) DO UPDATE SET filename=excluded.filename, path=excluded.path, size_bytes=excluded.size_bytes, updated_at=excluded.updated_at`,
      )
      .run(id, missionId, kind, filename, path, size, t, t);
    this.saveState(missionId, {
      skipped: this.state(missionId).skipped.filter((s) => s.kind !== kind),
    });
    return { id, kind, filename, sizeBytes: size, createdAt: t };
  }

  overview(missionId: string): ExportOverview {
    const rows = this.d.db
      .prepare(
        'SELECT id, kind, filename, path, size_bytes, created_at FROM deliverables WHERE mission_id=? ORDER BY created_at',
      )
      .all(missionId) as {
      id: string;
      kind: DeliverableKind;
      filename: string;
      path: string;
      size_bytes: number;
      created_at: string;
    }[];
    const order: DeliverableKind[] = ['docx', 'pdf', 'pptx', 'fiche', 'rapport'];
    const st = this.state(missionId);
    return {
      deliverables: rows
        .filter((r) => existsSync(r.path))
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          filename: r.filename,
          sizeBytes: r.size_bytes,
          createdAt: r.created_at,
        })),
      skipped: st.skipped,
      finalCheck: st.check,
      bibliography: st.bib,
    };
  }

  deliverable(id: string): { path: string; filename: string } {
    const r = this.d.db.prepare('SELECT path, filename FROM deliverables WHERE id=?').get(id) as
      { path: string; filename: string } | undefined;
    if (!r || !existsSync(r.path))
      throw new AppError(
        'E_BAD_REQUEST',
        'Ce fichier est introuvable : il a peut-être été déplacé ou supprimé.',
      );
    return r;
  }

  // ------------------------------------------------------------------ P8

  /** P8 : met en forme (citations, bibliographie, listes, sigles) et enregistre le bilan ; ne produit aucun fichier. */
  format(missionId: string): { cited: number; placeholders: number } {
    const doc = this.assemble(missionId);
    const brief = this.brief(missionId);
    const pf = this.profilesFile();
    const { style } = resolveProfile(pf, brief.profilNormesId, brief.styleCitation);
    const total = (
      this.d.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sources WHERE mission_id=? AND verification_status IN ('verified','partially_verified') AND type != 'document_interne'",
        )
        .get(missionId) as { n: number }
    ).n;
    this.saveState(missionId, {
      bib: {
        styleLabel: style.label,
        cited: doc.stats.citedSourceIds.length,
        total,
        notes: doc.notesMode,
      },
    });
    this.say(
      missionId,
      'success',
      'bibliographer',
      `Bibliographe : ${doc.stats.citedSourceIds.length} source(s) citée(s), style « ${style.label} »${doc.notesMode ? ' (notes de bas de page)' : ''}.`,
    );
    return { cited: doc.stats.citedSourceIds.length, placeholders: doc.stats.placeholders.length };
  }

  // ------------------------------------------------------------------ P9 : fichiers

  private title(missionId: string): string {
    return this.brief(missionId).titre;
  }

  async docx(missionId: string): Promise<DeliverableView> {
    const doc = this.assemble(missionId);
    const buf = await buildDocx(doc, this.cfg);
    const filename = `memoire-${slug(this.title(missionId))}.docx`;
    const path = join(this.dir(missionId), filename);
    writeFileSync(path, buf);
    const v = this.record(missionId, 'docx', filename, path);
    this.say(
      missionId,
      'success',
      'bibliographer',
      `Metteur en page : document Word produit (${Math.round(buf.length / 1024)} Ko).`,
    );
    return v;
  }

  async pdf(missionId: string): Promise<DeliverableView | null> {
    const adapter = this.d.pdf();
    if (!adapter) {
      this.skip(
        missionId,
        'pdf',
        'le rendu PDF n’est pas disponible dans cet environnement ; utilisez le fichier Word.',
      );
      return null;
    }
    const doc = this.assemble(missionId);
    const dir = this.dir(missionId);
    const filename = `memoire-${slug(this.title(missionId))}.pdf`;
    const pdfPath = join(dir, filename);
    const htmlPath = join(dir, '.rendu-memoire.html');
    try {
      const twoPass = doc.tocRequested && this.cfg.pdf.tocPageNumbers;
      const html1 = buildHtml(doc, this.cfg, { pages: null, marks: twoPass });
      writeFileSync(htmlPath, html1);
      await adapter.render(htmlPath, pdfPath);
      if (twoPass) {
        let pages: Map<string, number> | null = null;
        try {
          pages = await findMarkPages(
            pdfPath,
            tocHeadings(html1).map((h) => h.id),
          );
        } catch {
          pages = null;
        }
        if (pages && pages.size) {
          writeFileSync(htmlPath, buildHtml(doc, this.cfg, { pages, marks: false }));
          await adapter.render(htmlPath, pdfPath);
        } else {
          this.say(
            missionId,
            'warning',
            'bibliographer',
            'Les numéros de page du sommaire n’ont pas pu être calculés pour le PDF.',
          );
          writeFileSync(htmlPath, buildHtml(doc, this.cfg, { pages: new Map(), marks: false }));
          await adapter.render(htmlPath, pdfPath);
        }
      }
    } catch (e) {
      this.skip(
        missionId,
        'pdf',
        `le rendu a échoué (${e instanceof AppError ? e.messageFr : (e as Error).message}) ; utilisez le fichier Word.`,
      );
      return null;
    } finally {
      rmSync(htmlPath, { force: true });
    }
    const v = this.record(missionId, 'pdf', filename, pdfPath);
    this.say(missionId, 'success', 'bibliographer', 'Metteur en page : PDF produit.');
    return v;
  }

  // ------------------------------------------------------------------ diaporama et fiche

  private summaries(missionId: string): string {
    const rows = this.d.db
      .prepare(
        `SELECT n.numbering, n.title, d.summary FROM outline_nodes n
         JOIN drafts d ON d.id = COALESCE(n.current_version_id, (SELECT id FROM drafts WHERE outline_node_id=n.id ORDER BY version DESC LIMIT 1))
         WHERE n.mission_id=? AND d.summary IS NOT NULL ORDER BY n.ordinal`,
      )
      .all(missionId) as { numbering: string | null; title: string; summary: string }[];
    return rows
      .map(
        (r) =>
          `- ${r.numbering ?? '·'} ${r.title} : ${r.summary.replace(/\s+/g, ' ').slice(0, 700)}`,
      )
      .join('\n')
      .slice(0, 24000);
  }

  private allowedNumbers(doc: DocModel, brief: Brief, extra: string): Set<string> {
    const text = [
      ...doc.front.flatMap((f) => f.blocks),
      ...doc.body,
      ...doc.annexes.flatMap((a) => a.blocks),
    ]
      .map((b) =>
        b.type === 'paragraph'
          ? plainOf(b.runs)
          : b.type === 'list'
            ? b.items.map(plainOf).join(' ')
            : b.type === 'table'
              ? [...b.headers, ...b.rows.flat()].join(' ')
              : '',
      )
      .join(' ');
    return numberSet(`${text} ${JSON.stringify(brief)} ${extra}`);
  }

  /** Garde-fou chiffres des diapositives et de la fiche (§12.3) : une phrase contenant un nombre introuvable dans le travail est écartée. */
  private justified(sentence: string, allowed: Set<string>): boolean {
    return numbersToJustify(sentence).every(
      (n) => allowed.has(n.canon) || (Number.isInteger(Number(n.canon)) && Number(n.canon) <= 10),
    );
  }

  private tablesOf(
    doc: DocModel,
    analysis: StoredAnalysis | null,
  ): {
    block: TableBlock;
    facts: string[];
    figure: Extract<DocModel['body'][number], { type: 'figure' }> | null;
  }[] {
    const out: {
      block: TableBlock;
      facts: string[];
      figure: Extract<DocModel['body'][number], { type: 'figure' }> | null;
    }[] = [];
    const all = [...doc.body, ...doc.annexes.flatMap((a) => a.blocks)];
    all.forEach((b, i) => {
      if (b.type !== 'table' || b.number === 0) return;
      const r = analysis?.results.find(
        (x) => x.caption.replace(/^Tableau\s+\d+\s*:\s*/, '') === b.caption,
      );
      const next = all[i + 1];
      out.push({ block: b, facts: r?.facts ?? [], figure: next?.type === 'figure' ? next : null });
    });
    return out;
  }

  async slides(missionId: string, taskId: string | null): Promise<DeliverableView | null> {
    const brief = this.brief(missionId);
    const doc = this.assemble(missionId);
    const nodes = this.d.outline.list(missionId);
    const analysis = this.d.analysis.get(missionId);
    const n = brief.livrables.nbDiapos ?? this.cfg.pptx.defaultSlides;
    const kinds = slideStructure(n);
    const tables = this.tablesOf(doc, analysis);
    let ti = 0;
    const struct = kinds.map((k, i) => {
      const t = k === 'resultats' ? tables[ti++] : undefined;
      return {
        n: i + 1,
        kind: k,
        title:
          k === 'resultats' && t
            ? `${SLIDE_TITLE[k]} — Tableau ${t.block.number} : ${t.block.caption}`
            : SLIDE_TITLE[k],
        table: t,
      };
    });
    const facts = struct
      .filter((s) => s.table)
      .map(
        (s) =>
          `Diapositive ${s.n} (Tableau ${s.table!.block.number}) : ${s.table!.facts.join(' ')}`,
      )
      .join('\n');
    const ctx = missionContext(brief, nodes, 5200);
    const r = await runStructured(this.d.caller, {
      missionId,
      taskId,
      role: 'defense_designer',
      label: 'export:slides',
      messages: [
        {
          role: 'system',
          content: renderPrompt('defense_designer/slides', {
            type_travail: WORK_TYPE_LABEL_FR[brief.workType],
            titre: brief.titre,
            contexte: ctx,
            resumes: this.summaries(missionId) || '(aucun résumé)',
            structure: struct.map((s) => `${s.n}. [${s.kind}] ${s.title}`).join('\n'),
            faits: facts || '(aucun résultat chiffré : ne produis pas de chiffres)',
            max_puces: this.cfg.pptx.maxBulletsPerSlide,
            max_mots: this.cfg.pptx.maxWordsPerBullet,
            max_mots_notes: this.cfg.pptx.notesWordsMax,
          }),
        },
        { role: 'user', content: 'Prépare le diaporama.' },
      ],
      schema: DeckSchema,
      schemaName: 'diaporama',
      temperature: 0.4,
      promptVersion: EXPORT_PROMPT_VERSION,
    });
    const allowed = this.allowedNumbers(doc, brief, facts);
    const dropped: string[] = [];
    const clean = (arr: string[]): string[] =>
      arr.filter((s) => (this.justified(s, allowed) ? true : (dropped.push(s), false)));
    const cut = (notes: string): string => {
      const sentences = notes
        .split(/(?<=[.!?…])\s+/)
        .filter((s) => this.justified(s, allowed) || (dropped.push(s), false));
      let out = '';
      for (const s of sentences) {
        if (words(`${out} ${s}`).length > this.cfg.pptx.notesWordsMax) break;
        out = `${out} ${s}`.trim();
      }
      return out;
    };
    const e = brief.etablissement ?? {};
    const a = brief.auteur ?? {};
    const planBullets = this.planBullets(nodes);
    const slides: FinalSlide[] = struct.map((s, i) => {
      const got = r.output.diapositives[i];
      const base: FinalSlide = {
        type: s.kind,
        titre:
          s.kind === 'resultats' && s.table
            ? `${SLIDE_TITLE.resultats} : ${clipWords(s.table.block.caption, 10)}`
            : s.title,
        puces: clean(got?.puces ?? [])
          .slice(0, this.cfg.pptx.maxBulletsPerSlide)
          .map((p) => clipWords(p, this.cfg.pptx.maxWordsPerBullet)),
        notes: got ? cut(got.notes) : '',
        table: s.table?.block ?? null,
        figure: s.table?.figure ?? null,
      };
      if (!got) base.notes = '[À COMPLÉTER : notes de l’orateur]';
      if (s.kind === 'titre') {
        base.titre = brief.titre;
        base.puces = [];
        base.subtitle = [
          [brief.discipline, brief.specialite].filter(Boolean).join(' — '),
          a.nom ? `Présenté par ${a.nom}` : '[À COMPLÉTER : nom de l’auteur]',
          a.directeur ? `Sous la direction de ${a.directeur}` : '',
          e.nom ?? '[À COMPLÉTER : établissement]',
        ].filter(Boolean);
      }
      if (s.kind === 'plan') base.puces = planBullets;
      if (s.kind === 'conclusion') base.placeholders = ['[À COMPLÉTER : remerciements]'];
      return base;
    });
    if (dropped.length)
      this.say(
        missionId,
        'warning',
        'defense_designer',
        `Concepteur de soutenance : ${dropped.length} phrase(s) contenant un nombre introuvable dans le travail ont été écartées.`,
      );
    const buf = await buildPptx(slides, brief.titre, this.cfg.pptx);
    const filename = `diaporama-${slug(brief.titre)}.pptx`;
    const path = join(this.dir(missionId), filename);
    writeFileSync(path, buf);
    const v = this.record(missionId, 'pptx', filename, path);
    this.say(
      missionId,
      'success',
      'defense_designer',
      `Concepteur de soutenance : diaporama de ${slides.length} diapositives produit.`,
    );
    return v;
  }

  private planBullets(nodes: ReturnType<OutlineRepo['list']>): string[] {
    const top = nodes.filter(
      (n) =>
        n.kind === 'corps' &&
        (n.level === 'partie' ||
          (n.level === 'chapitre' && !nodes.some((p) => p.level === 'partie'))),
    );
    const items = top.length
      ? top
      : nodes.filter((n) => n.kind === 'corps' && n.level === 'chapitre');
    return [
      'Introduction',
      ...items.map((n) => clipWords(n.title, this.cfg.pptx.maxWordsPerBullet)),
      'Conclusion',
    ].slice(0, this.cfg.pptx.maxBulletsPerSlide + 2);
  }

  async fiche(missionId: string, taskId: string | null): Promise<DeliverableView> {
    const brief = this.brief(missionId);
    const doc = this.assemble(missionId);
    const nodes = this.d.outline.list(missionId);
    const jury = this.d.jury.view(missionId);
    const remarks = jury
      .flatMap((s) =>
        s.rounds
          .slice(0, 1)
          .flatMap((r) =>
            r.jurors.flatMap((j) => j.remarks.map((k) => `- ${k.problem} (${s.title})`)),
          ),
      )
      .slice(0, 25);
    const weaknesses = [
      ...jury
        .filter((s) => s.status === 'accepte_avec_reserves')
        .flatMap((s) => s.reasons.map((x) => `${s.title} : ${x}`)),
      ...doc.stats.placeholders.slice(0, 8).map((p) => `${p.section} : ${p.text}`),
      ...(doc.stats.deletedMissing.length
        ? [`Sections non rédigées : ${doc.stats.deletedMissing.join(' ; ')}`]
        : []),
    ];
    const sections = nodes.filter((n) => n.numbering).map((n) => n.numbering!);
    const r = await runStructured(this.d.caller, {
      missionId,
      taskId,
      role: 'defense_designer',
      label: 'export:questions',
      messages: [
        {
          role: 'system',
          content: renderPrompt('defense_designer/questions', {
            type_travail: WORK_TYPE_LABEL_FR[brief.workType],
            titre: brief.titre,
            contexte: missionContext(brief, nodes, 5200),
            resumes: this.summaries(missionId) || '(aucun résumé)',
            remarques_jury: remarks.join('\n') || '(aucune remarque)',
            faiblesses: weaknesses.map((w) => `- ${w}`).join('\n') || '(aucune faiblesse connue)',
            nb_min: this.cfg.fiche.questionsMin,
            nb_max: this.cfg.fiche.questionsMax,
          }),
        },
        { role: 'user', content: 'Prépare la fiche.' },
      ],
      schema: QuestionsSchema,
      schemaName: 'fiche_soutenance',
      temperature: 0.5,
      promptVersion: EXPORT_PROMPT_VERSION,
    });
    const allowed = this.allowedNumbers(doc, brief, remarks.join(' '));
    const known = new Set(sections);
    let dropped = 0;
    const qs: FicheQuestion[] = r.output.questions
      .slice(0, this.cfg.fiche.questionsMax)
      .map((q) => {
        const reponse = q.reponse
          .split(/(?<=[.!?…])\s+/)
          .filter((s) => this.justified(s, allowed) || (dropped++, false))
          .join(' ');
        return {
          question: q.question,
          reponse: reponse || '[À COMPLÉTER : éléments de réponse]',
          renvoi: known.has(q.renvoi) ? q.renvoi : '',
          origine: q.origine,
        };
      });
    if (dropped)
      this.say(
        missionId,
        'warning',
        'defense_designer',
        `Concepteur de soutenance : ${dropped} phrase(s) de la fiche contenant un nombre introuvable dans le travail ont été écartées.`,
      );
    const buf = await buildFiche(brief.titre, qs, weaknesses.slice(0, 12));
    const filename = `fiche-preparation-${slug(brief.titre)}.docx`;
    const path = join(this.dir(missionId), filename);
    writeFileSync(path, buf);
    const v = this.record(missionId, 'fiche', filename, path);
    this.say(
      missionId,
      'success',
      'defense_designer',
      `Concepteur de soutenance : fiche de préparation (${qs.length} questions) produite.`,
    );
    return v;
  }

  // ------------------------------------------------------------------ contrôle final et rapport

  async check(missionId: string): Promise<FinalCheckView> {
    const brief = this.brief(missionId);
    const doc = this.assemble(missionId);
    const row = this.d.db
      .prepare("SELECT path FROM deliverables WHERE mission_id=? AND kind='docx'")
      .get(missionId) as { path: string } | undefined;
    const docxResult = row && existsSync(row.path) ? await reopenDocx(row.path, brief.titre) : null;
    const res = finalCheck(
      doc,
      this.cfg.finalCheck,
      { requested: brief.livrables.docx, result: docxResult },
      nowIso(),
    );
    this.saveState(missionId, { check: res });
    const bad = res.items.filter((i) => i.status === 'echec');
    this.say(
      missionId,
      bad.length ? 'warning' : 'success',
      'bibliographer',
      bad.length
        ? `Contrôle final : ${bad.length} point(s) à vérifier — ${bad.map((b) => b.label).join(' ; ')}.`
        : `Contrôle final : tout est conforme (${res.placeholders.length} emplacement(s) à compléter).`,
    );
    return res;
  }

  report(missionId: string): DeliverableView {
    const brief = this.brief(missionId);
    const db = this.d.db;
    const m = db
      .prepare(
        'SELECT title, created_at, started_at, finished_at, cost_spent_usd, config_json FROM missions WHERE id=?',
      )
      .get(missionId) as {
      title: string;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      cost_spent_usd: number;
      config_json: string | null;
    };
    const phases = db
      .prepare(
        'SELECT phase, SUM(cost_usd) AS c, SUM(tokens_in) AS i, SUM(tokens_out) AS o FROM tasks WHERE mission_id=? GROUP BY phase ORDER BY phase',
      )
      .all(missionId) as { phase: string; c: number; i: number; o: number }[];
    const tasks = db
      .prepare('SELECT MIN(started_at) AS a, MAX(finished_at) AS b FROM tasks WHERE mission_id=?')
      .get(missionId) as { a: string | null; b: string | null };
    const t0 = Date.parse(m.started_at ?? tasks.a ?? m.created_at);
    const t1 = Date.parse(tasks.b ?? m.finished_at ?? nowIso());
    const counts = db
      .prepare(
        "SELECT verification_status AS s, COUNT(*) AS n FROM sources WHERE mission_id=? AND type != 'document_interne' GROUP BY verification_status",
      )
      .all(missionId) as { s: string; n: number }[];
    const cnt = (s: string) => counts.find((c) => c.s === s)?.n ?? 0;
    const rejected = db
      .prepare(
        "SELECT title, verification_json FROM sources WHERE mission_id=? AND verification_status='rejected' ORDER BY title LIMIT 200",
      )
      .all(missionId) as { title: string; verification_json: string | null }[];
    const st = this.state(missionId);
    const jury = this.d.jury.view(missionId);
    const attention = [
      ...jury
        .filter((s) => s.status === 'accepte_avec_reserves')
        .map(
          (s) =>
            `${s.title} : accepté avec réserves (${s.reasons.join(' ; ') || 'note inférieure au seuil'}).`,
        ),
      ...(st.check?.items
        .filter((i) => i.status !== 'ok' && i.id !== 'emplacements')
        .map((i) => `${i.label} : ${i.detail ?? ''}`.trim()) ?? []),
      ...(st.check?.placeholders.length
        ? [
            `${st.check.placeholders.length} emplacement(s) à compléter par vous (liste ci-dessous).`,
          ]
        : []),
    ];
    const connectors: Record<string, number> = {};
    const logs = db
      .prepare(
        'SELECT section_key, queries_json, connectors_json FROM search_log WHERE mission_id=? ORDER BY created_at',
      )
      .all(missionId) as {
      section_key: string | null;
      queries_json: string;
      connectors_json: string;
    }[];
    const titleOf = new Map(
      this.d.outline.list(missionId).map((n) => [n.id, `${n.numbering ?? ''} ${n.title}`.trim()]),
    );
    const queries: { section: string; texte: string }[] = [];
    const seen = new Set<string>();
    for (const l of logs) {
      for (const [k, v] of Object.entries(JSON.parse(l.connectors_json) as Record<string, number>))
        connectors[k] = (connectors[k] ?? 0) + v;
      for (const q of JSON.parse(l.queries_json) as { texte: string }[]) {
        const sec = l.section_key ? (titleOf.get(l.section_key.split(':')[0]!) ?? 'Plan') : 'Plan';
        const key = `${sec}|${q.texte}`;
        if (!seen.has(key)) {
          seen.add(key);
          queries.push({ section: sec, texte: q.texte });
        }
      }
    }
    const cfgJson = JSON.parse(m.config_json ?? '{}') as { llmMode?: string };
    const ov = this.overview(missionId);
    const data: ReportData = {
      title: brief.titre,
      generatedAt: new Date().toLocaleString('fr-FR'),
      params: [
        ['Type de travail', WORK_TYPE_LABEL_FR[brief.workType]],
        ['Discipline', brief.discipline],
        [
          'Niveau d’exigence',
          { standard: 'Standard', eleve: 'Élevé', tres_eleve: 'Très élevé' }[brief.exigence],
        ],
        ['Approche', brief.approche],
        ['Profil de normes', st.bib?.styleLabel ?? '—'],
        ['Rondes maximales par chapitre', String(brief.execution?.rondesMaxParChapitre ?? 3)],
        ['Rondes maximales globales', String(brief.execution?.rondesMaxGlobales ?? 2)],
        ['Profondeur de recherche', brief.execution?.profondeurRecherche ?? 'normale'],
        ['Mode', cfgJson.llmMode === 'mock' ? 'Simulé (aucun appel payant)' : 'Réel'],
      ].map(([label, value]) => ({ label: label!, value: value! })),
      durationMin: Number.isFinite(t1 - t0) ? Math.max(0, Math.round((t1 - t0) / 60000)) : null,
      costTotalUsd: m.cost_spent_usd,
      costByPhase: phases.map((p) => ({
        phase: p.phase,
        label: PHASE_LABEL[p.phase] ?? p.phase,
        costUsd: p.c,
        tokensIn: p.i,
        tokensOut: p.o,
      })),
      sources: {
        found: counts.reduce((a, c) => a + c.n, 0),
        verified: cnt('verified'),
        partially: cnt('partially_verified'),
        unverified: cnt('unverified'),
        rejected: cnt('rejected'),
        cited: st.bib?.cited ?? 0,
        rejectedList: rejected.map((r) => ({
          title: r.title,
          reason:
            (JSON.parse(r.verification_json ?? '{}') as { reasonFr?: string }).reasonFr ??
            'non vérifiable',
        })),
      },
      jury,
      attention,
      finalCheck: st.check,
      search: { connectors, queries: queries.slice(0, 120) },
      deliverables: ov.deliverables
        .filter((x) => x.kind !== 'rapport')
        .map((x) => ({ label: DELIVERABLE_LABEL_FR[x.kind], filename: x.filename })),
      skipped: ov.skipped.map((s) => ({ label: DELIVERABLE_LABEL_FR[s.kind], reason: s.reasonFr })),
      aiDeclaration:
        'J’ai utilisé un assistant d’intelligence artificielle (emilio agent) pour la recherche documentaire, la structuration et une première rédaction de ce travail. J’ai relu, vérifié et approprié l’ensemble du contenu, contrôlé les sources citées et assume la responsabilité du document final. [À COMPLÉTER : adaptez cette déclaration aux exigences de votre établissement.]',
    };
    const filename = `rapport-mission-${slug(brief.titre)}.html`;
    const path = join(this.dir(missionId), filename);
    writeFileSync(path, buildReportHtml(data));
    this.say(missionId, 'success', 'bibliographer', 'Rapport de mission produit.');
    return this.record(missionId, 'rapport', filename, path);
  }
}
