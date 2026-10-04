import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { AppError, type MissionArchiveInfo } from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { EmbeddingAdapter } from '../kb/embeddings';

export const ARCHIVE_VERSION = 1;

/** Tables d'une mission, dans l'ordre d'insertion (les clés étrangères sont différées pendant l'import). */
const TABLES: { t: string; where: string }[] = [
  { t: 'mission_files', where: 'mission_id=@id' },
  { t: 'tasks', where: 'mission_id=@id' },
  { t: 'outline_nodes', where: 'mission_id=@id' },
  { t: 'sources', where: 'mission_id=@id' },
  { t: 'chunks', where: 'mission_id=@id' },
  { t: 'reading_notes', where: 'mission_id=@id' },
  { t: 'section_sources', where: 'mission_id=@id' },
  { t: 'drafts', where: 'outline_node_id IN (SELECT id FROM outline_nodes WHERE mission_id=@id)' },
  {
    t: 'claims',
    where:
      'draft_id IN (SELECT d.id FROM drafts d JOIN outline_nodes n ON n.id=d.outline_node_id WHERE n.mission_id=@id)',
  },
  { t: 'jury_reviews', where: 'mission_id=@id' },
  { t: 'review_outcomes', where: 'mission_id=@id' },
  { t: 'revision_log', where: 'mission_id=@id' },
  { t: 'front_matter', where: 'mission_id=@id' },
  { t: 'field_analysis', where: 'mission_id=@id' },
  { t: 'plan_versions', where: 'mission_id=@id' },
  { t: 'search_log', where: 'mission_id=@id' },
  { t: 'checkpoints', where: 'mission_id=@id' },
  { t: 'events', where: 'mission_id=@id' },
  { t: 'deliverables', where: 'mission_id=@id' },
  { t: 'export_state', where: 'mission_id=@id' },
  {
    t: 'llm_calls',
    where: 'mission_id=@id OR task_id IN (SELECT id FROM tasks WHERE mission_id=@id)',
  },
];

type Row = Record<string, unknown>;
/** Colonnes qui désignent un fichier sur le disque (réécrites à l'import). */
const FILE_COLS: Record<string, string[]> = {
  mission_files: ['path', 'parsed_text_path'],
  deliverables: ['path'],
};

/** Exporte une mission en archive zip (CdC J9) : lignes de toutes les tables de la mission + fichiers importés et livrables. Sans clé ni préférences. */
export function exportMissionArchive(
  db: Db,
  missionId: string,
  destPath: string,
): MissionArchiveInfo {
  const mission = db.prepare('SELECT * FROM missions WHERE id=?').get(missionId) as Row | undefined;
  if (!mission) throw new AppError('E_BAD_REQUEST', 'Mission introuvable.');
  const files: Record<string, Uint8Array> = {};
  let fileCount = 0;
  const addFile = (row: Row, col: string): void => {
    const p = row[col];
    if (typeof p !== 'string' || !p || !existsSync(p) || !statSync(p).isFile()) {
      row[col] = null;
      return;
    }
    const name = `files/${newId()}-${basename(p)}`;
    files[name] = new Uint8Array(readFileSync(p));
    row[col] = `zip:${name}`;
    fileCount++;
  };
  const tables: Record<string, Row[]> = { missions: [mission] };
  for (const { t, where } of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t} WHERE ${where}`).all({ id: missionId }) as Row[];
    for (const r of rows) for (const c of FILE_COLS[t] ?? []) addFile(r, c);
    tables[t] = rows;
  }
  const manifest = {
    format: 'emilio-mission',
    version: ARCHIVE_VERSION,
    missionId,
    title: String(mission.title),
    exportedAt: nowIso(),
  };
  const zip = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'tables.json': strToU8(JSON.stringify(tables)),
    ...files,
  });
  writeFileSync(destPath, zip);
  return { missionId, title: manifest.title, files: fileCount, sizeBytes: zip.length };
}

const TERMINAL = ['completed', 'cancelled', 'failed', 'draft'];

/**
 * Importe une archive de mission. Refuse une archive illisible, d'une version inconnue, ou d'une mission déjà présente.
 * Les index de recherche (FTS5 par déclencheur, vecteurs recalculés) sont reconstruits ; une mission en cours devient « en pause ».
 */
export async function importMissionArchive(
  db: Db,
  dataDir: string,
  srcPath: string,
  embedder: EmbeddingAdapter,
): Promise<MissionArchiveInfo> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(readFileSync(srcPath)));
  } catch {
    throw new AppError('E_PARSE_FILE', 'Cette archive est illisible ou corrompue.');
  }
  const manifest = entries['manifest.json']
    ? (JSON.parse(strFromU8(entries['manifest.json'])) as {
        format?: string;
        version?: number;
        missionId?: string;
        title?: string;
      })
    : null;
  if (
    !manifest ||
    manifest.format !== 'emilio-mission' ||
    !manifest.missionId ||
    !entries['tables.json']
  )
    throw new AppError('E_PARSE_FILE', 'Ce fichier n’est pas une archive de mission emilio agent.');
  if ((manifest.version ?? 0) > ARCHIVE_VERSION)
    throw new AppError(
      'E_PARSE_FILE',
      'Cette archive vient d’une version plus récente de l’application : mettez-la à jour.',
    );
  const id = manifest.missionId;
  if (db.prepare('SELECT 1 FROM missions WHERE id=?').get(id))
    throw new AppError('E_BAD_REQUEST', 'Cette mission existe déjà sur cet ordinateur.');
  const tables = JSON.parse(strFromU8(entries['tables.json'])) as Record<string, Row[]>;

  // Fichiers : écrits sous le dossier de données de la nouvelle mission, chemins réécrits.
  const base = join(dataDir, 'missions', id, 'restored');
  mkdirSync(base, { recursive: true });
  let fileCount = 0;
  const restoreFile = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v.startsWith('zip:')) return null;
    const data = entries[v.slice(4)];
    if (!data) return null;
    const dest = join(base, basename(v.slice(4)));
    writeFileSync(dest, data);
    fileCount++;
    return dest;
  };
  for (const [t, cols] of Object.entries(FILE_COLS))
    for (const r of tables[t] ?? []) for (const c of cols) r[c] = restoreFile(r[c]);

  const columnsOf = (t: string): Set<string> =>
    new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
  const chunkRowids: { rowid: number; text: string; mission: string }[] = [];

  db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    const insert = (t: string, rows: Row[]): void => {
      const known = columnsOf(t);
      for (const row of rows) {
        const r = { ...row };
        if (t === 'missions') {
          const status = String(r.status);
          if (!TERMINAL.includes(status)) r.status = 'paused';
          // Le profil de normes d'une autre machine peut ne pas exister ici.
          if (
            r.norms_profile_id &&
            !db.prepare('SELECT 1 FROM norms_profiles WHERE id=?').get(r.norms_profile_id)
          )
            r.norms_profile_id = null;
        }
        if (t === 'tasks' && ['running', 'ready'].includes(String(r.status))) {
          r.status = 'ready';
          r.lease_until = null;
        }
        const cols = Object.keys(r).filter((c) => known.has(c));
        const res = db
          .prepare(
            `INSERT INTO ${t}(${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`,
          )
          .run(
            Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) as Record<
              string,
              string | number | null
            >,
          );
        if (t === 'chunks' && Number(r.is_bibliography) === 0)
          chunkRowids.push({
            rowid: Number(res.lastInsertRowid),
            text: String(r.text),
            mission: id,
          });
      }
    };
    insert('missions', tables.missions ?? []);
    for (const { t } of TABLES) insert(t, tables[t] ?? []);
  })();

  // Index vectoriel : recalculé avec l'embeddeur courant (les vecteurs ne sont pas dans l'archive).
  const BATCH = 32;
  for (let i = 0; i < chunkRowids.length; i += BATCH) {
    const part = chunkRowids.slice(i, i + BATCH);
    const vecs = await embedder.embedPassages(part.map((p) => p.text));
    db.transaction(() => {
      const ins = db.prepare('INSERT INTO chunks_vec(rowid, mission_id, embedding) VALUES (?,?,?)');
      part.forEach((p, k) => {
        const v = vecs[k]!;
        ins.run(BigInt(p.rowid), p.mission, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      });
    })();
  }
  const title = String((tables.missions?.[0] as Row | undefined)?.title ?? manifest.title ?? '');
  return { missionId: id, title, files: fileCount, sizeBytes: statSync(srcPath).size };
}
