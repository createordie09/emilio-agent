import type { Db } from '../storage/db';
import { newId, nowIso } from '../storage/db';
import { runStructured } from '../agents/execute';
import { renderPrompt, RESEARCH_PROMPT_VERSION } from '../agents/prompts';
import type { ModelCaller } from '../llm/call-model';
import type { EmbeddingAdapter } from '../kb/embeddings';
import type { KbStore } from '../kb/store';
import { ReadingNoteSchema } from './schemas';

/** Normalisation tolérante (CdC §12.2) : espaces, apostrophes et guillemets typographiques, tirets, césures de fin de ligne. */
export function normalizeForQuote(s: string): string {
  return s
    .replace(/[\u00a0\u202f\u2009\u200b]/g, ' ')
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/\u00ab\s*/g, '"')
    .replace(/\s*\u00bb/g, '"')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une citation doit exister LITTÉRALEMENT dans le texte source (à la normalisation tolérante près). */
export function quoteExists(quote: string, sourceText: string): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(sourceText).includes(q);
}

export const MAX_QUOTE_WORDS = 40;

export type ReadingNote = {
  these_principale: string;
  methode: string;
  resultats_cles: string[];
  citations: { texte: string; chunkId: string; pageFrom: number | null; pageTo: number | null }[];
  limites: string[];
  pertinence: string;
  manques: string[];
  /** Citations proposées par le modèle puis écartées par le contrôle littéral. */
  citationsEcartees: number;
};

export type NoteSpec = {
  title: string;
  objective: string;
  keyQuestions: string[];
  workType?: string;
  discipline?: string;
};

export type SourceRef = {
  id: string;
  title: string;
  authors: string[];
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
};

/**
 * Fiche de lecture d'une source (CdC §9 P3.7, §10.3.4) : l'Analyste de documents résume les extraits les plus pertinents ;
 * le CODE vérifie ensuite que chaque citation existe littéralement dans un extrait fourni — sinon elle est supprimée.
 */
export async function buildReadingNote(
  deps: { db: Db; caller: ModelCaller; store: KbStore; embedder: EmbeddingAdapter },
  p: {
    missionId: string;
    sectionKey: string;
    source: SourceRef;
    spec: NoteSpec;
    signal?: AbortSignal;
  },
): Promise<ReadingNote | null> {
  const hits = await deps.store.search(deps.embedder, {
    missionId: p.missionId,
    query: `${p.spec.objective} ${p.spec.keyQuestions.join(' ')}`.trim() || p.spec.title,
    limit: 6,
    sourceIds: [p.source.id],
  });
  if (!hits.length) return null;
  const alias = new Map(hits.map((h, i) => [`E${i + 1}`, h]));
  const extraits = [...alias]
    .map(
      ([a, h]) =>
        `[${a}]${h.pageFrom ? ` (p. ${h.pageFrom}${h.pageTo && h.pageTo !== h.pageFrom ? `–${h.pageTo}` : ''})` : ''} ${h.text.slice(0, 2500)}`,
    )
    .join('\n\n');
  const reference = `${p.source.authors.slice(0, 3).join('; ') || 'Auteur inconnu'} (${p.source.year ?? 's.d.'}). ${p.source.title}${p.source.journal ? `. ${p.source.journal}` : ''}${p.source.doi ? `. DOI ${p.source.doi}` : ''}`;
  const system = renderPrompt('document_analyst/reading-note', {
    type_travail: p.spec.workType ?? 'travail académique',
    discipline: p.spec.discipline ?? 'sciences humaines et sociales',
    titre_section: p.spec.title,
    objectif: p.spec.objective,
    reference,
    extraits,
  });
  const r = await runStructured(deps.caller, {
    missionId: p.missionId,
    taskId: null,
    role: 'document_analyst',
    label: 'recherche:fiche',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Rédige la fiche de lecture.' },
    ],
    schema: ReadingNoteSchema,
    schemaName: 'fiche_lecture',
    temperature: 0.2,
    promptVersion: RESEARCH_PROMPT_VERSION,
    signal: p.signal,
  });

  const kept: ReadingNote['citations'] = [];
  let dropped = 0;
  for (const c of r.output.citations) {
    const words = c.texte.trim().split(/\s+/).length;
    const own = alias.get(c.extrait);
    // L'extrait déclaré en premier, puis tous les extraits fournis (le modèle se trompe parfois d'identifiant).
    const host =
      (own && quoteExists(c.texte, own.text) ? own : undefined) ??
      hits.find((h) => quoteExists(c.texte, h.text));
    if (!host || words > MAX_QUOTE_WORDS) {
      dropped++;
      continue;
    }
    kept.push({
      texte: normalizeForQuote(c.texte),
      chunkId: host.chunkId,
      pageFrom: host.pageFrom,
      pageTo: host.pageTo,
    });
  }
  const note: ReadingNote = {
    these_principale: r.output.these_principale,
    methode: r.output.methode,
    resultats_cles: r.output.resultats_cles,
    citations: kept,
    limites: r.output.limites,
    pertinence: r.output.pertinence,
    manques: r.output.manques,
    citationsEcartees: dropped,
  };
  const t = nowIso();
  deps.db
    .prepare(
      `INSERT INTO reading_notes(id,mission_id,source_id,section_key,note_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(source_id, section_key) DO UPDATE SET note_json=excluded.note_json, updated_at=excluded.updated_at`,
    )
    .run(newId(), p.missionId, p.source.id, p.sectionKey, JSON.stringify(note), t, t);
  return note;
}
