import type { Brief, OutlineNodeView } from '@emilio/shared';
import type { Db } from '../storage/db';
import type { KbStore } from '../kb/store';
import type { EmbeddingAdapter } from '../kb/embeddings';
import type { ReadingNote } from '../research/reading-note';
import type { Extract, SourceInfo } from './checks';
import type { WritingConfig } from './config';

type SrcRow = {
  id: string;
  title: string;
  authors_json: string | null;
  year: number | null;
  abstract: string | null;
  fulltext_status: string;
};

/** « Adjovi et al. (2021) » : libellé court d'une source pour le rédacteur et l'interface. */
export function sourceLabel(authors: string[], year: number | null, title: string): string {
  const first = (authors[0] ?? '').split(',')[0]!.trim();
  const who = !first
    ? title.slice(0, 40)
    : authors.length > 2
      ? `${first} et al.`
      : authors.length === 2
        ? `${first} et ${(authors[1] ?? '').split(',')[0]!.trim()}`
        : first;
  return `${who} (${year ?? 's.d.'})`;
}

export type SectionSources = {
  sources: Map<string, SourceInfo>;
  extracts: Extract[];
  notes: string;
};

/**
 * Sources citables d'une section (CdC §8.4) : sources retenues par la recherche (vérifiées ou partiellement vérifiées,
 * jamais « document interne »), extraits les plus pertinents (recherche hybride), à défaut le résumé ; fiches de lecture.
 * Les identifiants réels ne sont jamais montrés au modèle : alias A1…, E1….
 */
export async function loadSectionSources(
  d: { db: Db; store: KbStore; embedder: EmbeddingAdapter; cfg: WritingConfig },
  p: { missionId: string; node: OutlineNodeView; maxTokens: number },
): Promise<SectionSources> {
  const rows = d.db
    .prepare(
      `SELECT s.id, s.title, s.authors_json, s.year, s.abstract, s.fulltext_status FROM section_sources ss
       JOIN sources s ON s.id = ss.source_id
       WHERE ss.mission_id=? AND ss.section_key=? AND s.verification_status IN ('verified','partially_verified') AND s.type != 'document_interne'
       ORDER BY ss.rank LIMIT ?`,
    )
    .all(p.missionId, p.node.id, d.cfg.maxSourcesPerSection) as SrcRow[];
  const sources = new Map<string, SourceInfo>();
  let extracts: Extract[] = [];
  const query = `${p.node.title}. ${p.node.objective} ${p.node.keyQuestions.join(' ')}`.trim();
  let i = 0;
  for (const r of rows) {
    const alias = `A${++i}`;
    sources.set(alias, {
      alias,
      id: r.id,
      year: r.year,
      label: sourceLabel(JSON.parse(r.authors_json ?? '[]') as string[], r.year, r.title),
    });
    const hits = await d.store.search(d.embedder, {
      missionId: p.missionId,
      query,
      limit: d.cfg.extractsPerSource,
      sourceIds: [r.id],
    });
    if (hits.length) {
      for (const h of hits)
        extracts.push({
          alias: '',
          sourceAlias: alias,
          sourceId: r.id,
          chunkId: h.chunkId,
          page: h.pageFrom
            ? h.pageTo && h.pageTo !== h.pageFrom
              ? `${h.pageFrom}-${h.pageTo}`
              : String(h.pageFrom)
            : null,
          text: h.text.slice(0, d.cfg.extractChars),
        });
    } else if (r.abstract?.trim()) {
      // Source sans texte intégral : le résumé est le seul extrait (pas de page).
      extracts.push({
        alias: '',
        sourceAlias: alias,
        sourceId: r.id,
        chunkId: null,
        page: null,
        text: r.abstract.slice(0, d.cfg.extractChars),
      });
    }
  }
  // Budget d'extraits (≤ 12 000 jetons, et ≤ 70 % de la fenêtre du modèle) : on retire d'abord les extraits en trop des dernières sources (§8.4).
  const cost = (e: Extract) => Math.ceil((e.text.length + 40) / d.cfg.charsPerToken);
  while (
    extracts.length > sources.size &&
    extracts.reduce((s, e) => s + cost(e), 0) > p.maxTokens
  ) {
    // retire le dernier extrait de la source qui en a le plus, en commençant par la fin
    const counts = new Map<string, number>();
    for (const e of extracts) counts.set(e.sourceAlias, (counts.get(e.sourceAlias) ?? 0) + 1);
    const idx = [...extracts.keys()]
      .reverse()
      .find((k) => (counts.get(extracts[k]!.sourceAlias) ?? 0) > 1);
    if (idx === undefined) break;
    extracts.splice(idx, 1);
  }
  while (extracts.length > 1 && extracts.reduce((s, e) => s + cost(e), 0) > p.maxTokens)
    extracts.pop();
  extracts = extracts.map((e, k) => ({ ...e, alias: `E${k + 1}` }));
  const used = new Set(extracts.map((e) => e.sourceAlias));
  for (const a of [...sources.keys()]) if (!used.has(a)) sources.delete(a); // une source sans extrait n'est pas citable

  const notes: string[] = [];
  for (const [alias, s] of sources) {
    const r = d.db
      .prepare('SELECT note_json FROM reading_notes WHERE source_id=? AND section_key=?')
      .get(s.id, p.node.id) as { note_json: string } | undefined;
    if (!r) continue;
    const n = JSON.parse(r.note_json) as ReadingNote;
    notes.push(
      `[${alias}] thèse : ${n.these_principale} ; méthode : ${n.methode}${n.resultats_cles.length ? ` ; résultats : ${n.resultats_cles.join(' ; ')}` : ''}`,
    );
  }
  return { sources, extracts, notes: notes.join('\n') };
}

/** Contexte compact de la mission (≤ 1 500 jetons, §8.4) : titre, problématique, hypothèses, objectifs, plan résumé. */
export function missionContext(brief: Brief, nodes: OutlineNodeView[], maxChars: number): string {
  const lines = [
    `Titre : ${brief.titre}`,
    brief.problematique ? `Problématique : ${brief.problematique}` : '',
    brief.hypotheses.length
      ? `Hypothèses : ${brief.hypotheses.map((h, i) => `H${i + 1} ${h}`).join(' ; ')}`
      : '',
    brief.objectifGeneral ? `Objectif général : ${brief.objectifGeneral}` : '',
    brief.objectifsSpecifiques.length
      ? `Objectifs spécifiques : ${brief.objectifsSpecifiques.join(' ; ')}`
      : '',
    brief.terrain?.pays
      ? `Terrain : ${[brief.terrain.pays, brief.terrain.ville, brief.terrain.structure].filter(Boolean).join(', ')}`
      : '',
    'Plan :',
    ...nodes
      .filter((n) => n.level !== 'sous_section')
      .map((n) => `${n.numbering ?? '·'} ${n.title}`),
  ].filter(Boolean);
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}
