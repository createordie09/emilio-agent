import { type Db, newId, nowIso } from '../storage/db';
import type { Chunk } from './chunk';
import type { EmbeddingAdapter } from './embeddings';

const f32 = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

export type SearchHit = {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  text: string;
  pageFrom: number | null;
  pageTo: number | null;
  sectionTitle: string | null;
  score: number;
  vectorScore: number;
  lexicalScore: number;
};

/** Poids de la recherche hybride (CdC §11.5) : 0,6 vectoriel + 0,4 BM25. */
export const HYBRID_WEIGHTS = { vector: 0.6, lexical: 0.4 } as const;

/** Échappe une requête libre pour FTS5 : chaque mot devient un terme entre guillemets, reliés par OR. */
export function ftsQuery(q: string): string {
  const terms = q
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/** Dépôt de la base de connaissances : extraits + index plein texte (FTS5) + index vectoriel (sqlite-vec). */
export class KbStore {
  constructor(private readonly db: Db) {}

  insertChunks(
    missionId: string,
    sourceId: string,
    chunks: Chunk[],
    vectors: Float32Array[],
  ): string[] {
    if (chunks.length !== vectors.length)
      throw new Error('Nombre de vecteurs différent du nombre d’extraits');
    const t = nowIso();
    const ids: string[] = [];
    this.db.transaction(() => {
      const insChunk = this.db.prepare(
        `INSERT INTO chunks(id,source_id,mission_id,ordinal,text,page_from,page_to,section_title,token_count,is_bibliography,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const insVec = this.db.prepare(
        'INSERT INTO chunks_vec(rowid, mission_id, embedding) VALUES (?,?,?)',
      );
      chunks.forEach((c, i) => {
        const id = newId();
        const r = insChunk.run(
          id,
          sourceId,
          missionId,
          c.ordinal,
          c.text,
          c.pageFrom,
          c.pageTo,
          c.sectionTitle,
          c.tokenCount,
          c.isBibliography ? 1 : 0,
          t,
          t,
        );
        // Les extraits de bibliographie sont stockés mais exclus de la recherche (§11.5) : pas de vecteur.
        if (!c.isBibliography) insVec.run(BigInt(r.lastInsertRowid), missionId, f32(vectors[i]!));
        ids.push(id);
      });
    })();
    return ids;
  }

  removeSource(sourceId: string): void {
    this.db.transaction(() => {
      const rows = this.db.prepare('SELECT rowid FROM chunks WHERE source_id=?').all(sourceId) as {
        rowid: number;
      }[];
      const del = this.db.prepare('DELETE FROM chunks_vec WHERE rowid=?');
      for (const r of rows) del.run(BigInt(r.rowid));
      this.db.prepare('DELETE FROM chunks WHERE source_id=?').run(sourceId);
    })();
  }

  count(missionId: string): { chunks: number; searchable: number } {
    const a = this.db
      .prepare('SELECT COUNT(*) n FROM chunks WHERE mission_id=?')
      .get(missionId) as { n: number };
    const b = this.db
      .prepare('SELECT COUNT(*) n FROM chunks WHERE mission_id=? AND is_bibliography=0')
      .get(missionId) as { n: number };
    return { chunks: a.n, searchable: b.n };
  }

  /**
   * Recherche hybride : score = 0,6 × similarité vectorielle + 0,4 × BM25, chacun normalisé dans [0,1]
   * sur l'ensemble des candidats. Les extraits de bibliographie sont exclus.
   */
  async search(
    embedder: EmbeddingAdapter,
    q: { missionId: string; query: string; limit?: number; sourceIds?: string[] },
  ): Promise<SearchHit[]> {
    const limit = q.limit ?? 10;
    const pool = Math.max(limit * 5, 30);
    const qv = await embedder.embedQuery(q.query);

    const vec = this.db
      .prepare(
        'SELECT rowid, distance FROM chunks_vec WHERE mission_id = ? AND embedding MATCH ? AND k = ?',
      )
      .all(q.missionId, f32(qv), pool) as { rowid: number | bigint; distance: number }[];
    // Vecteurs normalisés : cos = 1 − d²/2
    const vecSim = new Map<number, number>(
      vec.map((r) => [Number(r.rowid), Math.max(0, 1 - (r.distance * r.distance) / 2)]),
    );

    const fts = ftsQuery(q.query);
    const lex = new Map<number, number>();
    if (fts) {
      const rows = this.db
        .prepare(
          `SELECT c.rowid AS rid, bm25(chunks_fts) AS s FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
           WHERE chunks_fts MATCH ? AND c.mission_id = ? AND c.is_bibliography = 0 ORDER BY s LIMIT ?`,
        )
        .all(fts, q.missionId, pool) as { rid: number; s: number }[];
      // bm25() : plus négatif = meilleur → on inverse
      const best = Math.max(...rows.map((r) => -r.s), 1e-9);
      for (const r of rows) lex.set(r.rid, Math.max(0, -r.s) / best);
    }

    const ids = new Set([...vecSim.keys(), ...lex.keys()]);
    if (!ids.size) return [];
    const maxVec = Math.max(...vecSim.values(), 1e-9);
    const rows = this.db
      .prepare(
        `SELECT c.rowid AS rid, c.id, c.source_id, c.text, c.page_from, c.page_to, c.section_title, s.title
         FROM chunks c JOIN sources s ON s.id = c.source_id WHERE c.rowid IN (${[...ids].map(() => '?').join(',')})`,
      )
      .all(...ids) as {
      rid: number;
      id: string;
      source_id: string;
      text: string;
      page_from: number | null;
      page_to: number | null;
      section_title: string | null;
      title: string;
    }[];
    const allow = q.sourceIds ? new Set(q.sourceIds) : null;
    return rows
      .filter((r) => !allow || allow.has(r.source_id))
      .map((r) => {
        const v = (vecSim.get(r.rid) ?? 0) / maxVec;
        const l = lex.get(r.rid) ?? 0;
        return {
          chunkId: r.id,
          sourceId: r.source_id,
          sourceTitle: r.title,
          text: r.text,
          pageFrom: r.page_from,
          pageTo: r.page_to,
          sectionTitle: r.section_title,
          score: HYBRID_WEIGHTS.vector * v + HYBRID_WEIGHTS.lexical * l,
          vectorScore: v,
          lexicalScore: l,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
