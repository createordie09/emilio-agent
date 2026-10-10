import { basename, extname, join } from 'node:path';
import {
  AppError,
  FILE_KINDS,
  type AddFileResult,
  type DataProfile,
  type FileKind,
  type FileStatus,
  type MissionFileInfo,
} from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';
import type { FileAdapter } from '../storage/file-adapter';
import { chunkDocument } from './chunk';
import type { EmbeddingAdapter } from './embeddings';
import { DATA_EXT, TEXT_EXT, extractText } from './extract';
import { profileDataFile } from './profile';
import type { KbStore } from './store';
import type { EventJournal } from '../events/journal';

type DbKind = 'user_document' | 'field_data' | 'institution_guidelines' | 'template' | 'other';
const DB_KIND: Record<FileKind, DbKind> = {
  user_document: 'user_document',
  field_data: 'field_data',
  institution_guidelines: 'institution_guidelines',
  existing_work: 'other', // « Travail déjà rédigé » : colonne `kind` contrainte par §5.3 → rôle dans meta_json
  template: 'template',
};

type Meta = {
  role: FileKind;
  progress: number;
  message: string | null;
  chunks: number;
  pages: number | null;
  profile: DataProfile | null;
};

type Row = {
  id: string;
  mission_id: string;
  kind: DbKind;
  filename: string;
  path: string;
  mime: string | null;
  size: number | null;
  sha256: string | null;
  parsed_status: FileStatus | null;
  meta_json: string | null;
};

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const safeName = (n: string): string => n.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120);

/** Extensions acceptées par type d'import (§6.4 étape 5). */
export function allowedExtensions(kind: FileKind): Set<string> {
  if (kind === 'field_data') return DATA_EXT;
  if (kind === 'template') return new Set(['.docx']);
  return TEXT_EXT;
}

export type IngestDeps = {
  db: Db;
  files: FileAdapter;
  store: KbStore;
  embedder: () => EmbeddingAdapter;
  dataDir: string;
  journal: EventJournal;
  emit: (missionId: string, file: MissionFileInfo) => void;
  maxFileBytes?: number;
};

/**
 * Phase P0 « Préparation et ingestion » (CdC §9) : copie locale, extraction de texte, découpage, embeddings,
 * indexation (FTS5 + sqlite-vec) et profil des données de terrain. Tout est local : aucun appel réseau.
 */
export class IngestService {
  private chain: Promise<void> = Promise.resolve();
  private readonly maxBytes: number;

  constructor(private readonly d: IngestDeps) {
    this.maxBytes = d.maxFileBytes ?? 200 * 1024 * 1024;
  }

  /** Attend la fin de tous les traitements en cours (tests, finalisation d'une mission). */
  idle(): Promise<void> {
    return this.chain;
  }

  list(missionId: string): MissionFileInfo[] {
    return (
      this.d.db
        .prepare('SELECT * FROM mission_files WHERE mission_id=? ORDER BY created_at, id')
        .all(missionId) as Row[]
    ).map((r) => this.info(r));
  }

  private info(r: Row): MissionFileInfo {
    const m = JSON.parse(r.meta_json ?? '{}') as Partial<Meta>;
    return {
      id: r.id,
      kind: m.role ?? (r.kind === 'other' ? 'existing_work' : (r.kind as FileKind)),
      filename: r.filename,
      size: r.size ?? 0,
      mime: r.mime,
      status: r.parsed_status ?? 'pending',
      progress: m.progress ?? 0,
      message: m.message ?? null,
      chunks: m.chunks ?? 0,
      pages: m.pages ?? null,
      profile: m.profile ?? null,
    };
  }

  private row(id: string): Row {
    const r = this.d.db.prepare('SELECT * FROM mission_files WHERE id=?').get(id) as
      Row | undefined;
    if (!r) throw new AppError('E_INTERNAL', `Fichier introuvable : ${id}`);
    return r;
  }

  private update(id: string, status: FileStatus, patch: Partial<Meta>): void {
    const r = this.row(id);
    const meta = { ...(JSON.parse(r.meta_json ?? '{}') as Partial<Meta>), ...patch };
    this.d.db
      .prepare('UPDATE mission_files SET parsed_status=?, meta_json=?, updated_at=? WHERE id=?')
      .run(status, JSON.stringify(meta), nowIso(), id);
    this.d.emit(r.mission_id, this.info(this.row(id)));
  }

  /** Copie les fichiers dans le dossier de la mission et lance leur traitement en arrière-plan. */
  async add(
    missionId: string,
    items: { path: string; kind: FileKind }[],
  ): Promise<AddFileResult[]> {
    const out: AddFileResult[] = [];
    for (const it of items) {
      const filename = basename(it.path);
      try {
        if (!FILE_KINDS.includes(it.kind))
          throw new AppError('E_PARSE_FILE', `${filename} : type d'import inconnu`);
        const ext = extname(filename).toLowerCase();
        if (!allowedExtensions(it.kind).has(ext)) {
          throw new AppError(
            'E_PARSE_FILE',
            `${filename} : format « ${ext || 'inconnu'} » non accepté pour ce type de document`,
          );
        }
        let size: number;
        try {
          size = await this.d.files.size(it.path);
        } catch {
          throw new AppError('E_PARSE_FILE', `${filename} : fichier introuvable ou illisible`);
        }
        if (size > this.maxBytes)
          throw new AppError(
            'E_PARSE_FILE',
            `${filename} : fichier trop volumineux (maximum ${Math.round(this.maxBytes / 1048576)} Mo)`,
          );
        const id = newId();
        const dest = join(
          this.d.dataDir,
          'missions',
          missionId,
          'uploads',
          `${id}-${safeName(filename)}`,
        );
        const { sha256, size: copied } = await this.d.files.copyIn(it.path, dest);
        const dup = this.d.db
          .prepare('SELECT id FROM mission_files WHERE mission_id=? AND sha256=?')
          .get(missionId, sha256);
        if (dup) {
          await this.d.files.remove(dest);
          throw new AppError('E_PARSE_FILE', `${filename} : ce fichier a déjà été importé`);
        }
        const t = nowIso();
        const meta: Meta = {
          role: it.kind,
          progress: 0,
          message: 'En attente de traitement',
          chunks: 0,
          pages: null,
          profile: null,
        };
        this.d.db
          .prepare(
            `INSERT INTO mission_files(id,mission_id,kind,filename,path,mime,size,sha256,parsed_status,meta_json,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            missionId,
            DB_KIND[it.kind],
            filename,
            dest,
            MIME[ext] ?? null,
            copied,
            sha256,
            'pending',
            JSON.stringify(meta),
            t,
            t,
          );
        this.schedule(id);
        out.push({ filename, file: this.info(this.row(id)) });
      } catch (e) {
        const msg = e instanceof AppError ? (e.detail ?? e.messageFr) : (e as Error).message;
        out.push({ filename, errorFr: msg });
      }
    }
    return out;
  }

  /** Traitement séquentiel (calcul des embeddings gourmand en CPU, §ENF-06). */
  private schedule(fileId: string): void {
    this.chain = this.chain.then(() => this.process(fileId)).catch(() => undefined);
  }

  /** Au démarrage : reprend les fichiers restés en cours de traitement (crash, fermeture). */
  recover(): number {
    const stuck = this.d.db
      .prepare(
        "SELECT id FROM mission_files WHERE parsed_status IN ('pending','parsing','indexing')",
      )
      .all() as { id: string }[];
    for (const s of stuck) this.schedule(s.id);
    return stuck.length;
  }

  async remove(missionId: string, fileId: string): Promise<MissionFileInfo[]> {
    await this.idle();
    const r = this.row(fileId);
    if (r.mission_id !== missionId) throw new AppError('E_INTERNAL', 'Fichier hors mission');
    this.purgeIndexed(fileId);
    await this.d.files.remove(r.path);
    await this.d.files.remove(
      join(this.d.dataDir, 'missions', missionId, 'parsed', `${fileId}.txt`),
    );
    this.d.db.prepare('DELETE FROM mission_files WHERE id=?').run(fileId);
    return this.list(missionId);
  }

  /** Supprime source, extraits et vecteurs déjà créés pour ce fichier (rend le traitement idempotent). */
  private purgeIndexed(fileId: string): void {
    const srcs = this.d.db
      .prepare("SELECT id FROM sources WHERE json_extract(verification_json,'$.fileId') = ?")
      .all(fileId) as { id: string }[];
    for (const s of srcs) {
      this.d.store.removeSource(s.id);
      this.d.db.prepare('DELETE FROM sources WHERE id=?').run(s.id);
    }
  }

  private async process(fileId: string): Promise<void> {
    let r: Row;
    try {
      r = this.row(fileId);
    } catch {
      return; // supprimé entre-temps
    }
    const role = (JSON.parse(r.meta_json ?? '{}') as Meta).role ?? 'user_document';
    try {
      this.purgeIndexed(fileId);
      this.update(fileId, 'parsing', { progress: 0.05, message: 'Lecture du fichier…', chunks: 0 });
      if (role === 'template') {
        this.update(fileId, 'done', {
          progress: 1,
          message: 'Gabarit enregistré : ses styles seront appliqués à l’export.',
        });
        return;
      }
      if (role === 'field_data') {
        const profile = await profileDataFile(r.path, r.filename);
        const msg = `${profile.respondents} ligne(s), ${profile.columns.length} variable(s)`;
        this.update(fileId, profile.warnings.length ? 'warning' : 'done', {
          progress: 1,
          message: profile.warnings[0] ?? msg,
          profile,
        });
        this.d.journal.record({
          missionId: r.mission_id,
          level: 'info',
          agentRole: 'local',
          messageFr: `Données de terrain analysées : ${r.filename} (${msg}).`,
        });
        return;
      }

      const doc = await extractText(r.path, r.filename);
      const parsedPath = join(this.d.dataDir, 'missions', r.mission_id, 'parsed', `${fileId}.txt`);
      await this.d.files.write(
        parsedPath,
        doc.pages.map((p) => (p.page ? `[page ${p.page}]\n${p.text}` : p.text)).join('\n\n'),
      );
      this.d.db
        .prepare('UPDATE mission_files SET parsed_text_path=? WHERE id=?')
        .run(parsedPath, fileId);

      if (doc.scanned) {
        this.update(fileId, 'warning', {
          progress: 1,
          pages: doc.pages.length,
          message: doc.warnings[0] ?? 'PDF scanné',
        });
        return;
      }
      const chunks = chunkDocument(doc.pages);
      if (!chunks.length) {
        this.update(fileId, 'warning', {
          progress: 1,
          pages: doc.pages.length,
          message: 'Aucun texte exploitable dans ce fichier.',
        });
        return;
      }
      this.update(fileId, 'indexing', {
        progress: 0.25,
        pages: doc.pages.length,
        message: `Indexation de ${chunks.length} extrait(s)…`,
      });

      const emb = this.d.embedder();
      const vectors: Float32Array[] = [];
      const BATCH = 16;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const part = chunks.slice(i, i + BATCH).filter((c) => !c.isBibliography);
        vectors.push(...(await emb.embedPassages(part.map((c) => c.text))));
        this.update(fileId, 'indexing', {
          progress: 0.25 + 0.7 * Math.min(1, (i + BATCH) / chunks.length),
        });
      }
      // La bibliographie n'est pas vectorisée : on aligne les vecteurs sur les extraits (vecteur nul ignoré à l'insertion).
      let k = 0;
      const aligned = chunks.map((c) =>
        c.isBibliography ? new Float32Array(emb.dim) : vectors[k++]!,
      );

      const t = nowIso();
      const sourceId = newId();
      const title =
        doc.meta.title?.trim() ||
        basename(r.filename, extname(r.filename)).replace(/[_-]+/g, ' ').trim();
      const citable = role === 'user_document';
      this.d.db.transaction(() => {
        this.d.db
          .prepare(
            `INSERT INTO sources(id,mission_id,origin,type,title,authors_json,year,fulltext_status,verification_status,verification_json,language,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            sourceId,
            r.mission_id,
            'user_upload',
            citable ? 'article' : 'document_interne',
            title,
            doc.meta.author ? JSON.stringify([doc.meta.author]) : null,
            doc.meta.year ?? null,
            'fulltext',
            // Un document importé par l'utilisateur existe par définition (§12.1.4) ; seuls les documents de référence sont citables.
            citable ? 'verified' : 'unverified',
            JSON.stringify({ method: 'user_upload', fileId, sha256: r.sha256, role, checkedAt: t }),
            'fr',
            t,
            t,
          );
        this.d.store.insertChunks(r.mission_id, sourceId, chunks, aligned);
      })();
      const msg =
        `${chunks.length} extrait(s) indexé(s)` +
        (doc.pages.length > 1 ? ` · ${doc.pages.length} pages` : '');
      this.update(fileId, doc.warnings.length ? 'warning' : 'done', {
        progress: 1,
        chunks: chunks.length,
        message: doc.warnings[0] ?? msg,
      });
      this.d.journal.record({
        missionId: r.mission_id,
        level: 'info',
        agentRole: 'local',
        messageFr: `Document indexé : ${r.filename} (${msg}).`,
      });
    } catch (e) {
      const msg = e instanceof AppError ? (e.detail ?? e.messageFr) : (e as Error).message;
      this.update(fileId, 'error', { progress: 1, message: msg });
      this.d.journal.record({
        missionId: r.mission_id,
        level: 'warning',
        agentRole: 'local',
        messageFr: `Impossible de lire le fichier ${r.filename} (${msg}).`,
      });
    }
  }
}
