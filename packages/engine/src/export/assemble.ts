import { BriefSchema, WORK_TYPE_LABEL_FR, type Brief, type OutlineNodeView } from '@emilio/shared';
import type { Db } from '../storage/db';
import type { StoredAnalysis } from '../analysis/service';
import type { AnalysisResult } from '../analysis/run';
import { writingUnits } from '../llm/estimate';
import { blocksOf, stripMarkers, tableTokenId } from '../writing/text';
import { Bibliographer, groupEntries, rowToCsl, type SourceRow } from './bibliography';
import { barChartSvg, svgToPng } from './charts';
import { resolveProfile, type ExportConfig, type ExportProfile, type ProfilesFile } from './config';
import { markdownInline } from './inline';
import {
  plainOf,
  type Block,
  type DocModel,
  type FigureBlock,
  type FrontPage,
  type Para,
  type Run,
  type TableBlock,
} from './model';
import { extractSigles } from './sigles';
import { frenchTypography } from './typography';

const OPEN = '';
const CLOSE = '';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MARKER_ONE = new RegExp(`\\[@(${UUID})(?:\\s*,\\s*(?:pp?\\.\\s*)?([^\\]]+))?\\]`, 'g');
const MARKER_RUN = new RegExp(`(?:\\[@${UUID}(?:\\s*,\\s*[^\\]]+)?\\]\\s*[;,]?\\s*)+`, 'g');
const ANY_MARKER = /\[@[^\]]*\]/g;
const PLACEHOLDER = /\[(?:À COMPLÉTER|DONNÉES À INSÉRER)[^\]]*\]/g;
const TOKEN_LINE = /^\s*\{\{TABLEAU:([A-Za-z0-9_-]+)\}\}\s*$/gm;
const stripNumbered = (c: string): string => c.replace(/^(?:Tableau|Figure)\s+\d+\s*:\s*/, '');

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const ALPHA = (i: number): string => String.fromCharCode(65 + (i % 26));

export type AssembleInput = {
  db: Db;
  missionId: string;
  nodes: OutlineNodeView[];
  analysis: StoredAnalysis | null;
  resourcesDir: string;
  profiles: ProfilesFile;
  config: ExportConfig;
};

type DraftRow = { markdown: string; word_count: number; checks_json: string | null };

/** Assemble le mémoire complet (CdC §9 P8) : texte courant des sections, citations CSL, bibliographie, listes, sigles, annexes. */
export function assembleDocument(inp: AssembleInput): DocModel {
  const { db, missionId, config } = inp;
  const mission = db
    .prepare('SELECT brief_json, title FROM missions WHERE id=?')
    .get(missionId) as { brief_json: string | null; title: string };
  const brief = BriefSchema.parse(JSON.parse(mission.brief_json ?? '{}')) as Brief;
  const { profile, style } = resolveProfile(
    inp.profiles,
    brief.profilNormesId,
    brief.styleCitation,
  );
  const notesMode = style.mode === 'notes';

  // --- sources
  const sourceRows = db
    .prepare(
      `SELECT id,type,title,authors_json,year,publisher,journal,volume,issue,pages,doi,isbn,url,language FROM sources
       WHERE mission_id=? AND verification_status IN ('verified','partially_verified') AND type != 'document_interne'`,
    )
    .all(missionId) as SourceRow[];
  const items = new Map(sourceRows.map((r) => [r.id, { ...rowToCsl(r), 'x-type': r.type }]));
  const typeOf = new Map(sourceRows.map((r) => [r.id, r.type]));
  const biblio = new Bibliographer(
    inp.resourcesDir,
    style.file,
    inp.profiles.locale,
    style.mode,
    items,
  );

  // --- plan : arbre, numérotation d'affichage, unités rédigées
  const kids = new Map<string | null, OutlineNodeView[]>();
  for (const n of inp.nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  for (const l of kids.values()) l.sort((a, b) => a.ordinal - b.ordinal);
  const draftOf = (nodeId: string): DraftRow | undefined =>
    db
      .prepare(
        `SELECT markdown, word_count, checks_json FROM drafts WHERE id = COALESCE(
           (SELECT current_version_id FROM outline_nodes WHERE id=?),
           (SELECT id FROM drafts WHERE outline_node_id=? ORDER BY version DESC LIMIT 1))`,
      )
      .get(nodeId, nodeId) as DraftRow | undefined;
  const unitIds = new Set(writingUnits(inp.nodes).map((u) => u.node.id));
  const wordsTarget = writingUnits(inp.nodes).reduce((s, u) => s + u.words, 0);

  // --- numérotation des tableaux et figures dans l'ordre du document (§16.5 : numérotation continue)
  const results = new Map((inp.analysis?.results ?? []).map((r) => [r.id, r]));
  const order: string[] = [];
  const walkOrder = (parent: string | null) => {
    for (const n of kids.get(parent) ?? []) {
      if (unitIds.has(n.id)) {
        const d = draftOf(n.id);
        if (d)
          for (const m of d.markdown.matchAll(TOKEN_LINE)) {
            const id = tableTokenId(m[0]);
            if (id && results.has(id) && !order.includes(id)) order.push(id);
          }
      } else walkOrder(n.id);
    }
  };
  walkOrder(null);
  const extra = [...results.keys()].filter((id) => !order.includes(id));
  const tableNo = new Map<string, number>();
  const figNo = new Map<string, number>();
  const oldTable = new Map<number, number>();
  const oldFigure = new Map<number, number>();
  let tn = 0;
  let fn = 0;
  for (const id of [...order, ...extra]) {
    const r = results.get(id)!;
    tableNo.set(id, ++tn);
    oldTable.set(r.tableNumber, tn);
    if (r.figure) {
      figNo.set(id, ++fn);
      oldFigure.set(r.figure.number, fn);
    }
  }
  const renumberRefs = (t: string): string =>
    t
      .replace(/\b(Tableau)\s+(\d+)\b/g, (m, w: string, n: string) =>
        oldTable.has(+n) ? `${w} ${oldTable.get(+n)}` : m,
      )
      .replace(/\b(Figure)\s+(\d+)\b/g, (m, w: string, n: string) =>
        oldFigure.has(+n) ? `${w} ${oldFigure.get(+n)}` : m,
      );

  const stats: DocModel['stats'] = {
    citedSourceIds: [],
    bibliographyIds: [],
    unresolvedMarkers: [],
    tablesPlaced: [],
    figuresPlaced: [],
    placeholders: [],
    words: 0,
    wordsTarget,
    groundingRate: null,
    deletedMissing: [],
  };
  const groundings: number[] = [];

  const tableBlock = (r: AnalysisResult): TableBlock => ({
    type: 'table',
    number: tableNo.get(r.id)!,
    caption: stripNumbered(r.caption),
    source: r.source,
    headers: r.headers,
    rows: r.rows,
  });
  const figureBlock = (r: AnalysisResult): FigureBlock | null => {
    if (!r.figure) return null;
    const svg = barChartSvg(r.figure.vegaLite, config.charts);
    return {
      type: 'figure',
      number: figNo.get(r.id)!,
      caption: stripNumbered(r.figure.caption),
      source: r.source,
      svg,
      png: svg ? svgToPng(svg, inp.resourcesDir, config.charts) : null,
      width: config.charts.width,
      height: config.charts.height,
    };
  };
  const placed = new Set<string>();
  const placeTable = (r: AnalysisResult, out: Block[]) => {
    // Un tableau n'est inséré qu'une fois (au premier jeton) : un second jeton ne le duplique pas.
    if (placed.has(r.id)) return;
    placed.add(r.id);
    out.push(tableBlock(r));
    stats.tablesPlaced.push(tableNo.get(r.id)!);
    const f = figureBlock(r);
    if (f) {
      out.push(f);
      stats.figuresPlaced.push(f.number);
    }
  };

  // --- texte courant → blocs
  const sentinel = (clusterId: string) => `${OPEN}${clusterId}${CLOSE}`;
  const prepare = (raw: string, section: string): string => {
    let t = renumberRefs(raw);
    for (const m of t.matchAll(PLACEHOLDER)) stats.placeholders.push({ section, text: m[0] });
    t = t.replace(MARKER_RUN, (run) => {
      const cited: { id: string; locator?: string }[] = [];
      for (const m of run.matchAll(MARKER_ONE)) {
        if (!items.has(m[1]!)) {
          stats.unresolvedMarkers.push(m[0]);
          continue;
        }
        cited.push({ id: m[1]!, ...(m[2] ? { locator: m[2].trim() } : {}) });
      }
      if (!cited.length) return '';
      const { clusterId } = biblio.cite(cited);
      return (notesMode ? '' : ' ') + sentinel(clusterId);
    });
    // Marqueurs mal formés restants : signalés, retirés du texte.
    for (const m of t.matchAll(ANY_MARKER)) stats.unresolvedMarkers.push(m[0]);
    t = t.replace(ANY_MARKER, '');
    if (notesMode)
      t = t
        .replace(new RegExp(`\\s*(${OPEN}[^${CLOSE}]+${CLOSE})([.,;:!?…]+)`, 'g'), '$2$1')
        .replace(new RegExp(`\\s+(${OPEN})`, 'g'), '$1');
    else t = t.replace(/\s{2,}/g, ' ').replace(new RegExp(`\\s+${OPEN}`, 'g'), ` ${OPEN}`);
    return frenchTypography(t);
  };

  const mdToBlocks = (md: string, section: string): Block[] => {
    const out: Block[] = [];
    for (const b of blocksOf(md)) {
      if (b.kind === 'table_token') {
        const id = tableTokenId(b.text);
        const r = id ? results.get(id) : undefined;
        if (r) placeTable(r, out);
        continue;
      }
      if (b.kind === 'heading') {
        const text = prepare(b.text.replace(/^#{1,6}\s*/, ''), section);
        out.push({
          type: 'heading',
          level: 4,
          id: `x${out.length}`,
          numbering: null,
          text: stripMarkers(text),
          pageBreak: false,
          toc: false,
        });
        continue;
      }
      if (b.kind === 'list') {
        const items = b.text
          .split('\n')
          .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
          .filter(Boolean);
        out.push({
          type: 'list',
          ordered: /^\s*\d+[.)]\s/.test(b.text),
          items: items.map((i) => markdownInline(prepare(i, section))),
        });
        continue;
      }
      if (b.kind === 'table') {
        const lines = b.text
          .split('\n')
          .filter((l) => /\|/.test(l) && !/^\s*\|?\s*:?-{2,}/.test(l));
        const cells = lines.map((l) =>
          l
            .replace(/^\s*\||\|\s*$/g, '')
            .split('|')
            .map((c) => c.trim()),
        );
        if (cells.length)
          out.push({
            type: 'table',
            number: 0,
            caption: '',
            source: '',
            headers: cells[0]!,
            rows: cells.slice(1),
          });
        continue;
      }
      const quote = /^>\s?/.test(b.text);
      const text = prepare(b.text.replace(/^>\s?/gm, ''), section);
      out.push({
        type: 'paragraph',
        runs: markdownInline(text),
        ...(quote ? { style: 'quote' as const } : {}),
      });
    }
    return out;
  };

  // --- corps : parcours du plan
  const depthLevel = (depth: number): 1 | 2 | 3 | 4 => Math.min(4, depth + 1) as 1 | 2 | 3 | 4;
  const body: Block[] = [];
  let hid = 0;
  const heading = (n: OutlineNodeView, label: string | null, depth: number): Block => {
    return {
      type: 'heading',
      level: depthLevel(depth),
      id: `h${++hid}`,
      numbering: label,
      text: n.title,
      pageBreak:
        depth === 0 || n.level === 'chapitre' || n.level === 'partie' || n.kind !== 'corps',
      toc: true,
    };
  };
  const romanStyle = profile.layout.headingNumbering === 'romain_alphabetique';
  const labelFor = (
    n: OutlineNodeView,
    pos: { part: number; chapter: number; section: number; sub: number },
  ): string | null => {
    if (n.kind !== 'corps') return null;
    if (!romanStyle) {
      if (n.level === 'partie') return `Partie ${n.numbering ?? ROMAN[pos.part - 1] ?? pos.part}`;
      if (n.level === 'chapitre') return `Chapitre ${n.numbering ?? pos.chapter}`;
      return n.numbering;
    }
    if (n.level === 'partie') return `Partie ${ROMAN[pos.part - 1] ?? pos.part}`;
    if (n.level === 'chapitre') return `${ROMAN[pos.chapter - 1] ?? pos.chapter}.`;
    if (n.level === 'section') return `${ALPHA(pos.section - 1)}.`;
    return `${pos.sub}.`;
  };
  const walk = (parent: string | null, depth: number) => {
    let part = 0;
    let chapter = 0;
    let section = 0;
    let sub = 0;
    for (const n of kids.get(parent) ?? []) {
      if (n.level === 'partie') part++;
      else if (n.level === 'chapitre') {
        chapter++;
        section = 0;
      } else if (n.level === 'section') {
        section++;
        sub = 0;
      } else sub++;
      const label = labelFor(n, { part, chapter, section, sub });
      const h = heading(n, label, depth);
      body.push(h);
      if (unitIds.has(n.id)) {
        const d = draftOf(n.id);
        const section2 = `${label ?? ''} ${n.title}`.trim();
        if (!d) {
          stats.deletedMissing.push(section2);
          body.push({
            type: 'paragraph',
            runs: [{ text: '[À COMPLÉTER : section non rédigée]', highlight: true }],
          });
          stats.placeholders.push({
            section: section2,
            text: '[À COMPLÉTER : section non rédigée]',
          });
        } else {
          stats.words += d.word_count;
          const ck = d.checks_json
            ? (JSON.parse(d.checks_json) as { groundingRate?: number | null })
            : null;
          if (ck?.groundingRate != null) groundings.push(ck.groundingRate);
          body.push(...mdToBlocks(d.markdown, section2));
        }
      } else walk(n.id, depth + 1);
    }
  };
  walk(null, 0);

  // --- annexes : tableaux et figures non insérés dans le texte
  const annexes: FrontPage[] = [];
  if (extra.length) {
    const blocks: Block[] = [];
    for (const id of extra) placeTable(results.get(id)!, blocks);
    annexes.push({
      key: 'annexe-tableaux',
      title: 'Annexe 1 : tableaux complémentaires',
      blocks,
      toc: true,
    });
  }

  // --- cohérence : citations → texte final (sentinelles résolues)
  const footnotes = new Map<number, Para>();
  const cl = new RegExp(`${OPEN}(c\\d+)${CLOSE}`, 'g');
  const noteOf = new Map<string, number>();
  const resolve = (runs: Para): Para => {
    const out: Run[] = [];
    for (const r of runs) {
      if (!r.text.includes(OPEN)) {
        out.push(r);
        continue;
      }
      let last = 0;
      for (const m of r.text.matchAll(cl)) {
        if (m.index! > last) out.push({ ...r, text: r.text.slice(last, m.index) });
        const id = m[1]!;
        if (notesMode) {
          let k = noteOf.get(id);
          if (!k) {
            k = noteOf.size + 1;
            noteOf.set(id, k);
            footnotes.set(k, biblio.runsOf(id));
          }
          out.push({ text: '', note: k });
        } else {
          for (const c of biblio.runsOf(id)) out.push(c);
        }
        last = m.index! + m[0].length;
      }
      if (last < r.text.length) out.push({ ...r, text: r.text.slice(last) });
    }
    return out;
  };
  const resolveBlocks = (bs: Block[]): Block[] =>
    bs.map((b) =>
      b.type === 'paragraph'
        ? { ...b, runs: resolve(b.runs) }
        : b.type === 'list'
          ? { ...b, items: b.items.map(resolve) }
          : b,
    );
  const resolvedBody = resolveBlocks(body);

  // --- liminaires
  const lim = brief.liminaires ?? {};
  const fm = db
    .prepare('SELECT key, markdown FROM front_matter WHERE mission_id=?')
    .all(missionId) as { key: string; markdown: string }[];
  const fmOf = (k: string): string | undefined => fm.find((f) => f.key === k)?.markdown;
  const paras = (md: string, section: string): Block[] =>
    resolveBlocks(mdToBlocks(md, section)).filter((b) => b.type !== 'table');
  const front: FrontPage[] = [];
  const addFront = (key: string, title: string, md: string | undefined, toc = true) => {
    if (md === undefined) return;
    front.push({ key, title, blocks: paras(md, title), toc });
  };
  if (lim.avertissement) addFront('avertissement', 'Avertissement', fmOf('avertissement'));
  if (lim.dedicace) addFront('dedicace', 'Dédicace', fmOf('dedicace'));
  if (lim.remerciements) addFront('remerciements', 'Remerciements', fmOf('remerciements'));

  const bodyText = resolvedBody
    .flatMap((b) =>
      b.type === 'paragraph' ? [plainOf(b.runs)] : b.type === 'list' ? b.items.map(plainOf) : [],
    )
    .map(stripMarkers);
  if (lim.sigles) {
    const sg = extractSigles(bodyText, config.sigles);
    if (sg.length) {
      front.push({
        key: 'sigles',
        title: 'Sigles et abréviations',
        toc: true,
        blocks: sg.map((s) => {
          if (!s.definition)
            stats.placeholders.push({
              section: 'Sigles et abréviations',
              text: `[À COMPLÉTER : définition de ${s.sigle}]`,
            });
          return {
            type: 'paragraph' as const,
            runs: [
              { text: s.sigle, bold: true },
              { text: ' : ' },
              s.definition
                ? { text: frenchTypography(s.definition) }
                : { text: '[À COMPLÉTER : définition]', highlight: true },
            ],
          };
        }),
      });
    }
  }
  const allBlocks = [...resolvedBody, ...annexes.flatMap((a) => a.blocks)];
  const tables = allBlocks
    .filter((b): b is TableBlock => b.type === 'table' && b.number > 0)
    .sort((a, b) => a.number - b.number);
  const figures = allBlocks
    .filter((b): b is FigureBlock => b.type === 'figure')
    .sort((a, b) => a.number - b.number);
  if (lim.listeTableaux && tables.length)
    front.push({
      key: 'liste-tableaux',
      title: 'Liste des tableaux',
      toc: true,
      blocks: tables.map((t) => ({
        type: 'paragraph' as const,
        runs: [{ text: frenchTypography(`Tableau ${t.number} : ${t.caption}`) }],
      })),
    });
  if (lim.listeFigures && figures.length)
    front.push({
      key: 'liste-figures',
      title: 'Liste des figures',
      toc: true,
      blocks: figures.map((f) => ({
        type: 'paragraph' as const,
        runs: [{ text: frenchTypography(`Figure ${f.number} : ${f.caption}`) }],
      })),
    });
  if (lim.sommaire) front.push({ key: 'sommaire', title: 'Sommaire', blocks: [], toc: false });
  const resume = fmOf('resume');
  if (lim.resume && resume !== undefined) {
    const kw =
      brief.motsCles.length && !/mots-clés/i.test(resume)
        ? `\n\n**Mots-clés :** ${brief.motsCles.join(' ; ')}`
        : '';
    addFront('resume', 'Résumé', resume + kw);
  }
  if (lim.abstract) addFront('abstract', 'Abstract', fmOf('abstract'));

  // --- bibliographie
  const entries = biblio.entries();
  const groups = profile.bibliography.groupByType
    ? groupEntries(entries, inp.profiles.bibliographyGroups, (id) => typeOf.get(id) ?? '')
    : [{ label: null as string | null, entries: entries.map((e) => e.runs) }];
  stats.citedSourceIds = biblio.citedIds;
  stats.bibliographyIds = entries.map((e) => e.id);
  stats.groundingRate = groundings.length
    ? groundings.reduce((a, b) => a + b, 0) / groundings.length
    : null;

  // --- page de garde
  const cover = lim.pageGarde ? buildCover(brief, stats) : null;

  return {
    title: brief.titre || mission.title,
    subtitle: brief.problematique ?? null,
    language: 'fr',
    cover,
    layout: layoutOf(profile, brief),
    front,
    tocRequested: Boolean(lim.sommaire),
    body: resolvedBody,
    bibliography: {
      title: profile.bibliography.title,
      groups: groups.length ? groups : [{ label: null, entries: [] }],
      numbered: style.mode === 'numerique',
    },
    annexes: annexes.map((a) => ({ ...a, blocks: resolveBlocks(a.blocks) })),
    footnotes,
    notesMode,
    stats,
  };
}

function layoutOf(profile: ExportProfile, brief: Brief): DocModel['layout'] {
  const mp = brief.mise_en_page ?? {};
  const m = profile.layout.margins;
  const margins = mp.margeCm
    ? { top: mp.margeCm, bottom: mp.margeCm, left: mp.margeCm, right: mp.margeCm }
    : m;
  return {
    font: mp.police ?? 'Times New Roman',
    fontSize: mp.taille ?? 12,
    lineSpacing: mp.interligne ?? 1.5,
    margins,
    paragraphIndent: profile.layout.paragraphIndent,
    justify: true,
    footnotesFontSize: profile.layout.footnotesFontSize,
  };
}

function buildCover(brief: Brief, stats: DocModel['stats']): NonNullable<DocModel['cover']> {
  const lines: NonNullable<DocModel['cover']>['lines'] = [];
  const ph = (text: string, section = 'Page de garde') => {
    stats.placeholders.push({ section, text });
    return text;
  };
  const e = brief.etablissement ?? {};
  const a = brief.auteur ?? {};
  lines.push(
    e.nom
      ? { text: e.nom, role: 'meta' }
      : { text: ph('[À COMPLÉTER : établissement]'), role: 'meta', highlight: true },
  );
  if (e.faculte) lines.push({ text: e.faculte, role: 'meta' });
  lines.push({ text: WORK_TYPE_LABEL_FR[brief.workType], role: 'type' });
  lines.push({ text: brief.titre, role: 'title' });
  lines.push({
    text: [brief.discipline, brief.specialite].filter(Boolean).join(' — '),
    role: 'meta',
  });
  lines.push(
    a.nom
      ? { text: `Présenté par : ${a.nom}`, role: 'person' }
      : { text: ph('[À COMPLÉTER : nom de l’auteur]'), role: 'person', highlight: true },
  );
  if (a.directeur) lines.push({ text: `Sous la direction de : ${a.directeur}`, role: 'person' });
  if (a.maitreStage) lines.push({ text: `Maître de stage : ${a.maitreStage}`, role: 'person' });
  lines.push(
    e.anneeAcademique
      ? { text: `Année académique ${e.anneeAcademique}`, role: 'meta' }
      : { text: ph('[À COMPLÉTER : année académique]'), role: 'meta', highlight: true },
  );
  return { lines };
}
