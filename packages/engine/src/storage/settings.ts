import type { Db } from './db';
import { nowIso } from './db';

/** Dépôt clé/valeur JSON (table settings, CdC §5.1). */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO settings(key, value_json, created_at, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now, now);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
