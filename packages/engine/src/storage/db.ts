import Database from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';

export type Db = Database.Database;

export const newId = (): string => uuidv7();
export const nowIso = (): string => new Date().toISOString();

const migrationFiles = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export type Migration = { version: number; name: string; sql: string };

export function loadMigrations(files: Record<string, string> = migrationFiles): Migration[] {
  return Object.entries(files)
    .map(([path, sql]) => {
      const m = /(\d+)_([^/]+)\.sql$/.exec(path);
      if (!m) throw new Error(`Nom de migration invalide : ${path}`);
      return { version: Number(m[1]), name: m[2]!, sql };
    })
    .sort((a, b) => a.version - b.version);
}

/** Applique les migrations manquantes, chacune dans une transaction. Ne modifie jamais une migration livrée. */
export function runMigrations(db: Db, migrations: Migration[] = loadMigrations()): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)').run(
        m.version,
        m.name,
        nowIso(),
      );
    })();
  }
  return schemaVersion(db);
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}
