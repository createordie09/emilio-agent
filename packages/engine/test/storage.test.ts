import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations, schemaVersion, newId } from '../src/storage/db';
import { SettingsRepo } from '../src/storage/settings';

const mem = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
};

describe('migrations', () => {
  it('applique 0001 et crée toutes les tables du CdC §5', () => {
    const db = mem();
    expect(runMigrations(db)).toBe(6);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of [
      'settings',
      'missions',
      'mission_files',
      'tasks',
      'llm_calls',
      'sources',
      'chunks',
      'chunks_fts',
      'outline_nodes',
      'drafts',
      'claims',
      'jury_reviews',
      'checkpoints',
      'events',
      'norms_profiles',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('est idempotente', () => {
    const db = mem();
    runMigrations(db);
    runMigrations(db);
    expect(schemaVersion(db)).toBe(6);
  });

  it('ordonne les migrations par numéro', () => {
    const m = loadMigrations({ './b/0002_b.sql': 'SELECT 1', './a/0001_a.sql': 'SELECT 1' });
    expect(m.map((x) => x.version)).toEqual([1, 2]);
  });

  it('annule une migration en échec (transaction)', () => {
    const db = mem();
    expect(() =>
      runMigrations(db, [
        { version: 1, name: 'x', sql: 'CREATE TABLE a(x); INSERT INTO nope VALUES (1)' },
      ]),
    ).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='a'").get()).toBeUndefined();
  });

  it("l'index plein texte FTS5 suit les insertions de chunks", () => {
    const db = mem();
    runMigrations(db);
    const mid = newId();
    const sid = newId();
    db.prepare('INSERT INTO missions(id,title) VALUES (?,?)').run(mid, 'T');
    db.prepare('INSERT INTO sources(id,mission_id,origin,type,title) VALUES (?,?,?,?,?)').run(
      sid,
      mid,
      'user_upload',
      'article',
      'S',
    );
    db.prepare('INSERT INTO chunks(id,source_id,mission_id,ordinal,text) VALUES (?,?,?,?,?)').run(
      newId(),
      sid,
      mid,
      0,
      'Étude du développement rural en Afrique',
    );
    const hit = db
      .prepare("SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'etude'")
      .get() as { n: number };
    expect(hit.n).toBe(1); // insensible aux accents
  });

  it('refuse un statut de mission invalide', () => {
    const db = mem();
    runMigrations(db);
    expect(() =>
      db.prepare("INSERT INTO missions(id,title,status) VALUES ('1','t','bogus')").run(),
    ).toThrow();
  });

  it('génère des UUID v7 ordonnés', () => {
    const a = newId();
    const b = newId();
    expect(a[14]).toBe('7');
    expect(a < b || a.slice(0, 13) === b.slice(0, 13)).toBe(true);
  });
});

describe('SettingsRepo', () => {
  it('lit, écrit, met à jour et supprime', () => {
    const db = mem();
    runMigrations(db);
    const s = new SettingsRepo(db);
    expect(s.get('k')).toBeUndefined();
    s.set('k', { a: 1 });
    s.set('k', { a: 2 });
    expect(s.get('k')).toEqual({ a: 2 });
    s.delete('k');
    expect(s.get('k')).toBeUndefined();
  });
});
