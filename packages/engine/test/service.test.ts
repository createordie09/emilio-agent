import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineService } from '../src';

const mk = () =>
  new EngineService({
    dbPath: join(mkdtempSync(join(tmpdir(), 'emilio-')), 'test.db'),
    fetch: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
  });

describe('EngineService', () => {
  it('ping renvoie la version du schéma', async () => {
    const e = mk();
    const r = await e.handle('ping', undefined);
    expect(r).toEqual({ ok: true, value: { ok: true, engineVersion: '0.5.0', schemaVersion: 4 } });
    e.close();
  });

  it('stocke et relit des réglages', async () => {
    const e = mk();
    await e.handle('setSetting', { key: 'ui', value: { theme: 'sombre' } });
    expect(await e.handle('getSetting', { key: 'ui' })).toEqual({
      ok: true,
      value: { theme: 'sombre' },
    });
    await e.handle('deleteSetting', { key: 'ui' });
    expect(await e.handle('getSetting', { key: 'ui' })).toEqual({ ok: true, value: null });
    e.close();
  });

  it('transforme les erreurs en résultats sérialisés en français', async () => {
    const e = mk();
    const r = await e.handle('testKey', undefined);
    expect(r).toMatchObject({ ok: false, error: { code: 'E_KEY_MISSING' } });
    expect((r as { error: { messageFr: string } }).error.messageFr).toMatch(/clé OpenRouter/);
    e.close();
  });
});
