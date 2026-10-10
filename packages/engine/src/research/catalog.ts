import type { ReadingNoteView, SourceDetail, SourceSummary } from '@emilio/shared';
import type { Db } from '../storage/db';

type Row = Record<string, string | number | null>;

const summary = (r: Row, sections: string[]): SourceSummary => {
  const ev = r.verification_json
    ? (JSON.parse(String(r.verification_json)) as { reasonFr?: string; note?: string })
    : null;
  return {
    id: String(r.id),
    title: String(r.title),
    authors: r.authors_json ? (JSON.parse(String(r.authors_json)) as string[]) : [],
    year: (r.year as number | null) ?? null,
    type: String(r.type),
    origin: String(r.origin),
    doi: (r.doi as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    verificationStatus: r.verification_status as SourceSummary['verificationStatus'],
    verificationNote: ev?.reasonFr ?? ev?.note ?? null,
    fulltextStatus: r.fulltext_status as SourceSummary['fulltextStatus'],
    relevance: (r.relevance_score as number | null) ?? null,
    quality: (r.quality_score as number | null) ?? null,
    sections,
    usedInText: Number(r.used_in_text ?? 0),
  };
};

/** Liste des sources d'une mission (hors documents internes : guide d'établissement, travail déjà rédigé). */
export function listSources(db: Db, missionId: string): SourceSummary[] {
  const rows = db
    .prepare(
      "SELECT * FROM sources WHERE mission_id=? AND type != 'document_interne' ORDER BY quality_score IS NULL, quality_score DESC, created_at",
    )
    .all(missionId) as Row[];
  const secs = db
    .prepare('SELECT source_id, section_key FROM section_sources WHERE mission_id=? ORDER BY rank')
    .all(missionId) as { source_id: string; section_key: string }[];
  const bySource = new Map<string, string[]>();
  for (const s of secs)
    bySource.set(s.source_id, [...(bySource.get(s.source_id) ?? []), s.section_key]);
  return rows.map((r) => summary(r, bySource.get(String(r.id)) ?? []));
}

export function getSource(db: Db, sourceId: string): SourceDetail | null {
  const r = db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId) as Row | undefined;
  if (!r) return null;
  const secs = (
    db
      .prepare('SELECT section_key FROM section_sources WHERE source_id=? ORDER BY rank')
      .all(sourceId) as { section_key: string }[]
  ).map((s) => s.section_key);
  const notes = (
    db
      .prepare('SELECT section_key, note_json FROM reading_notes WHERE source_id=?')
      .all(sourceId) as { section_key: string; note_json: string }[]
  ).map((n): ReadingNoteView => {
    const note = JSON.parse(n.note_json) as Omit<ReadingNoteView, 'sectionKey' | 'citations'> & {
      citations: { texte: string; pageFrom: number | null; pageTo: number | null }[];
    };
    return {
      sectionKey: n.section_key,
      these_principale: note.these_principale,
      methode: note.methode,
      resultats_cles: note.resultats_cles,
      citations: note.citations.map((c) => ({
        texte: c.texte,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
      })),
      limites: note.limites,
      pertinence: note.pertinence,
      citationsEcartees: (note as unknown as { citationsEcartees: number }).citationsEcartees,
    };
  });
  return {
    ...summary(r, secs),
    abstract: (r.abstract as string | null) ?? null,
    journal: (r.journal as string | null) ?? null,
    publisher: (r.publisher as string | null) ?? null,
    volume: (r.volume as string | null) ?? null,
    issue: (r.issue as string | null) ?? null,
    pages: (r.pages as string | null) ?? null,
    isbn: (r.isbn as string | null) ?? null,
    language: (r.language as string | null) ?? null,
    oaPdfUrl: (r.oa_pdf_url as string | null) ?? null,
    evidence: r.verification_json
      ? (JSON.parse(String(r.verification_json)) as Record<string, unknown>)
      : null,
    notes,
    chunks: (
      db.prepare('SELECT COUNT(*) n FROM chunks WHERE source_id=?').get(sourceId) as { n: number }
    ).n,
  };
}
