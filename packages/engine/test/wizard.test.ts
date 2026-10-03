import { describe, it, expect } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_ROLES, defaultBrief, type BriefDraft, type EngineLiveEvent } from '@emilio/shared';
import { EngineService, HashEmbedder } from '../src';
import { tmpDb } from './helpers';

const fx = (f: string) => join(__dirname, 'fixtures', f);
const RES = join(__dirname, '../../../resources');
const mk = (over: object = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'emilio-w-'));
  const engine = new EngineService({
    dbPath: join(dir, 'e.db'),
    dataDir: dir,
    embedder: new HashEmbedder(),
    presetsPath: join(RES, 'presets.json'),
    normsProfilesPath: join(RES, 'norms-profiles.json'),
    ...over,
  });
  return { engine, dir };
};
const complete = (): BriefDraft => ({
  ...defaultBrief('memoire_master'),
  discipline: 'Sciences de gestion',
  titre: 'Microfinance et inclusion financière au Bénin',
  problematique: 'Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière ?',
  approche: 'documentaire',
  execution: { ...defaultBrief().execution!, preset: 'equilibre', budgetMaxUsd: 12 },
  profilNormesId: 'afrique-francophone-standard',
});

describe('brouillons de mission', () => {
  it('crée un brouillon avec les valeurs par défaut, l’enregistre automatiquement et le liste', async () => {
    const { engine } = mk();
    const d = engine.drafts.create({ workType: 'rapport_stage' });
    expect(d.status).toBe('draft');
    expect(d.brief.workType).toBe('rapport_stage');
    expect(d.brief.longueur).toEqual({ unite: 'pages', min: 25, max: 40 });
    const saved = engine.drafts.save(d.id, { titre: 'Mon sujet', discipline: 'Droit' });
    expect(saved.brief).toMatchObject({
      titre: 'Mon sujet',
      discipline: 'Droit',
      workType: 'rapport_stage',
    });
    expect(engine.drafts.list()).toEqual([
      expect.objectContaining({ id: d.id, title: 'Mon sujet', workType: 'rapport_stage' }),
    ]);
    await engine.close();
  });

  it('refuse un brouillon invalide (mots-clés > 10, longueur incohérente)', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    expect(() =>
      engine.drafts.save(d.id, { motsCles: Array.from({ length: 11 }, (_, i) => `m${i}`) }),
    ).toThrow();
    expect(() =>
      engine.drafts.save(d.id, { longueur: { unite: 'pages', min: 80, max: 20 } }),
    ).toThrow();
    await engine.close();
  });

  it('supprime un brouillon avec ses fichiers, extraits et vecteurs', async () => {
    const { engine, dir } = mk();
    const d = engine.drafts.create();
    await engine.ingest.add(d.id, [{ path: fx('memoire-exemple.pdf'), kind: 'user_document' }]);
    await engine.ingest.idle();
    expect(engine.store.count(d.id).chunks).toBeGreaterThan(0);
    await engine.drafts.remove(d.id);
    expect(engine.drafts.list()).toEqual([]);
    expect((engine.db.prepare('SELECT COUNT(*) n FROM chunks_vec').get() as { n: number }).n).toBe(
      0,
    );
    expect(existsSync(join(dir, 'missions', d.id))).toBe(false);
    await engine.close();
  });
});

describe('import et traitement des fichiers (P0)', () => {
  it('document de référence : indexé, source vérifiée, recherche hybride opérationnelle, événements de progression', async () => {
    const { engine, dir } = mk();
    const live: EngineLiveEvent[] = [];
    engine.onLive((e) => live.push(e));
    const d = engine.drafts.create();
    const [r] = await engine.ingest.add(d.id, [
      { path: fx('memoire-exemple.pdf'), kind: 'user_document' },
    ]);
    expect(r!.file).toMatchObject({
      kind: 'user_document',
      status: 'pending',
      filename: 'memoire-exemple.pdf',
    });
    await engine.ingest.idle();
    const [f] = engine.ingest.list(d.id);
    expect(f).toMatchObject({ status: 'done', progress: 1 });
    expect(f!.chunks).toBeGreaterThan(3);
    expect(f!.pages).toBeGreaterThanOrEqual(8);

    const src = engine.db.prepare('SELECT * FROM sources WHERE mission_id=?').get(d.id) as Record<
      string,
      unknown
    >;
    expect(src).toMatchObject({
      origin: 'user_upload',
      type: 'article',
      verification_status: 'verified',
      fulltext_status: 'fulltext',
    });
    expect(existsSync(join(dir, 'missions', d.id, 'parsed', `${f!.id}.txt`))).toBe(true);

    const res = await engine.handle('searchKb', {
      id: d.id,
      query: 'caution solidaire asymétrie d’information',
      limit: 3,
    });
    expect(res).toMatchObject({ ok: true });
    const hits = (res as { value: { text: string; pageFrom: number }[] }).value;
    expect(hits[0]!.text).toMatch(/caution solidaire/);

    const fileEvents = live.filter(
      (e): e is Extract<EngineLiveEvent, { kind: 'file.updated' }> => e.kind === 'file.updated',
    );
    const progress = fileEvents.map((e) => e.file.progress);
    expect(progress[0]).toBeLessThan(0.3);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(new Set(fileEvents.map((e) => e.file.status))).toEqual(
      new Set(['parsing', 'indexing', 'done']),
    );
    await engine.close();
  });

  it('données de terrain : profil CSV et XLSX, pas d’extraits dans la base de connaissances', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    await engine.ingest.add(d.id, [
      { path: fx('donnees-enquete.csv'), kind: 'field_data' },
      { path: fx('donnees-enquete.xlsx'), kind: 'field_data' },
    ]);
    await engine.ingest.idle();
    const files = engine.ingest.list(d.id);
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(f.profile!.respondents).toBe(60);
      expect(f.profile!.columns.length).toBe(9);
      expect(f.chunks).toBe(0);
    }
    expect(engine.store.count(d.id).chunks).toBe(0);
    await engine.close();
  });

  it('guide de l’établissement, travail déjà rédigé, gabarit : jamais citables comme sources', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    await engine.ingest.add(d.id, [
      { path: fx('guide-redaction.docx'), kind: 'institution_guidelines' },
      { path: fx('memoire-exemple.pdf'), kind: 'existing_work' },
    ]);
    await engine.ingest.idle();
    const rows = engine.db
      .prepare('SELECT type, verification_status FROM sources WHERE mission_id=?')
      .all(d.id);
    expect(rows).toEqual([
      { type: 'document_interne', verification_status: 'unverified' },
      { type: 'document_interne', verification_status: 'unverified' },
    ]);
    expect(
      engine.ingest
        .list(d.id)
        .map((f) => f.kind)
        .sort(),
    ).toEqual(['existing_work', 'institution_guidelines']);
    // le gabarit est simplement enregistré
    const tpl = join(mkdtempSync(join(tmpdir(), 'tpl-')), 'gabarit.docx');
    writeFileSync(tpl, Buffer.concat([readFileSync(fx('guide-redaction.docx')), Buffer.from(' ')]));
    const t = await engine.ingest.add(d.id, [{ path: tpl, kind: 'template' }]);
    await engine.ingest.idle();
    expect(t[0]!.file).toBeDefined();
    expect(engine.ingest.list(d.id).find((f) => f.kind === 'template')).toMatchObject({
      status: 'done',
      chunks: 0,
    });
    await engine.close();
  });

  it('PDF scanné : avertissement OCR, aucun extrait, pas de source', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    await engine.ingest.add(d.id, [{ path: fx('scan.pdf'), kind: 'user_document' }]);
    await engine.ingest.idle();
    const [f] = engine.ingest.list(d.id);
    expect(f).toMatchObject({ status: 'warning', chunks: 0 });
    expect(f!.message).toMatch(/OCR/);
    expect(engine.db.prepare('SELECT COUNT(*) n FROM sources').get()).toEqual({ n: 0 });
    await engine.close();
  });

  it('erreurs claires en français : format refusé, mauvais type, doublon, fichier absent, fichier corrompu', async () => {
    const { engine, dir } = mk();
    const d = engine.drafts.create();
    const bad = join(dir, 'faux.pdf');
    writeFileSync(bad, 'pas un pdf');
    const r = await engine.ingest.add(d.id, [
      { path: fx('generate.mjs'), kind: 'user_document' },
      { path: fx('memoire-exemple.pdf'), kind: 'field_data' },
      { path: fx('donnees-enquete.csv'), kind: 'user_document' },
      { path: join(dir, 'absent.pdf'), kind: 'user_document' },
      { path: fx('memoire-exemple.pdf'), kind: 'user_document' },
      { path: fx('memoire-exemple.pdf'), kind: 'user_document' },
      { path: bad, kind: 'user_document' },
    ]);
    expect(r.map((x) => x.errorFr ?? 'ok')).toEqual([
      expect.stringMatching(/non accepté/),
      expect.stringMatching(/non accepté/),
      expect.stringMatching(/non accepté/),
      expect.stringMatching(/introuvable/),
      'ok',
      expect.stringMatching(/déjà été importé/),
      'ok',
    ]);
    await engine.ingest.idle();
    const files = engine.ingest.list(d.id);
    expect(files.find((f) => f.filename === 'faux.pdf')).toMatchObject({ status: 'error' });
    expect(files.find((f) => f.filename === 'memoire-exemple.pdf')).toMatchObject({
      status: 'done',
    });
    await engine.close();
  });

  it('retrait d’un fichier : extraits, vecteurs, source et copie disque supprimés', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    const [r] = await engine.ingest.add(d.id, [
      { path: fx('memoire-exemple.pdf'), kind: 'user_document' },
    ]);
    await engine.ingest.idle();
    const stored = engine.db
      .prepare('SELECT path FROM mission_files WHERE id=?')
      .get(r!.file!.id) as { path: string };
    expect(existsSync(stored.path)).toBe(true);
    expect(await engine.ingest.remove(d.id, r!.file!.id)).toEqual([]);
    expect(existsSync(stored.path)).toBe(false);
    expect(engine.store.count(d.id).chunks).toBe(0);
    expect((engine.db.prepare('SELECT COUNT(*) n FROM chunks_vec').get() as { n: number }).n).toBe(
      0,
    );
    expect(engine.db.prepare('SELECT COUNT(*) n FROM sources').get()).toEqual({ n: 0 });
    await engine.close();
  });

  it('reprise après interruption : le fichier est retraité sans doublon', async () => {
    const dbPath = tmpDb();
    const dir = mkdtempSync(join(tmpdir(), 'emilio-r-'));
    const a = new EngineService({ dbPath, dataDir: dir, embedder: new HashEmbedder() });
    const d = a.drafts.create();
    await a.ingest.add(d.id, [{ path: fx('memoire-exemple.pdf'), kind: 'user_document' }]);
    await a.ingest.idle();
    const before = a.store.count(d.id).chunks;
    // simule un crash en plein indexation : statut resté « indexing »
    a.db.prepare("UPDATE mission_files SET parsed_status='indexing'").run();
    await a.close();
    const b = new EngineService({ dbPath, dataDir: dir, embedder: new HashEmbedder() });
    expect(b.ingest.recover()).toBe(1);
    await b.ingest.idle();
    expect(b.ingest.list(d.id)[0]!.status).toBe('done');
    expect(b.store.count(d.id).chunks).toBe(before);
    expect(b.db.prepare('SELECT COUNT(*) n FROM sources').get()).toEqual({ n: 1 });
    expect((b.db.prepare('SELECT COUNT(*) n FROM chunks_vec').get() as { n: number }).n).toBe(
      b.store.count(d.id).searchable,
    );
    await b.close();
  });

  it('copie les fichiers : modifier ou supprimer l’original n’affecte pas la mission', async () => {
    const { engine, dir } = mk();
    const d = engine.drafts.create();
    const src = join(dir, 'original.csv');
    copyFileSync(fx('donnees-enquete.csv'), src);
    await engine.ingest.add(d.id, [{ path: src, kind: 'field_data' }]);
    await engine.ingest.idle();
    const f = engine.db.prepare('SELECT path, sha256, size FROM mission_files').get() as {
      path: string;
      sha256: string;
      size: number;
    };
    expect(f.path).toContain(join('missions', d.id, 'uploads'));
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.size).toBe(3292); // taille réelle du fichier copié (BOM inclus)
    await engine.close();
  });
});

describe('validation finale du brief (§6.4 étape 7, §7.3)', () => {
  it('refuse un brief incomplet avec les messages de validation', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    await expect(engine.drafts.finalize(d.id)).rejects.toMatchObject({ code: 'E_BAD_REQUEST' });
    await engine.close();
  });

  it('exige la confirmation quand l’approche est empirique et qu’aucune donnée n’est fournie', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    engine.drafts.save(d.id, { ...complete(), approche: 'quantitative' });
    await expect(engine.drafts.finalize(d.id)).rejects.toMatchObject({
      detail: expect.stringContaining('Confirmation requise'),
    });
    const s = await engine.drafts.finalize(d.id, { confirmNoFieldData: true });
    expect(s.status).toBe('briefing');
    expect(engine.journal.list(d.id).some((e) => /DONNÉES À INSÉRER/.test(e.messageFr))).toBe(true);
    await engine.close();
  });

  it('avec des données de terrain, aucune confirmation n’est nécessaire', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    engine.drafts.save(d.id, { ...complete(), approche: 'mixte' });
    await engine.ingest.add(d.id, [{ path: fx('donnees-enquete.csv'), kind: 'field_data' }]);
    expect((await engine.drafts.finalize(d.id)).status).toBe('briefing');
    await engine.close();
  });

  it('construit la configuration d’exécution depuis le préréglage : un modèle par rôle, budget, mode réel', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    engine.drafts.save(d.id, complete());
    const s = await engine.drafts.finalize(d.id);
    expect(s).toMatchObject({
      status: 'briefing',
      title: 'Microfinance et inclusion financière au Bénin',
      budgetMaxUsd: 12,
    });
    const cfg = engine.missions.config<{
      llmMode: string;
      models: Record<string, string>;
      budgetMaxUsd: number;
    }>(d.id);
    expect(cfg.llmMode).toBe('real');
    expect(Object.keys(cfg.models).sort()).toEqual([...AGENT_ROLES].sort());
    expect(cfg.budgetMaxUsd).toBe(12);
    expect(
      engine.db.prepare('SELECT norms_profile_id AS n FROM missions WHERE id=?').get(d.id),
    ).toEqual({ n: 'afrique-francophone-standard' });
    expect(
      engine.db.prepare('SELECT COUNT(*) c FROM norms_profiles WHERE builtin=1').get(),
    ).toEqual({ c: 6 });
    expect(engine.drafts.list()).toEqual([]); // n'est plus un brouillon
    expect(() => engine.drafts.save(d.id, { titre: 'x' })).toThrow();
    await engine.close();
  });

  it('refuse sans budget ni modèles', async () => {
    const { engine } = mk();
    const d = engine.drafts.create();
    const c = complete();
    engine.drafts.save(d.id, {
      ...c,
      execution: { ...c.execution!, budgetMaxUsd: undefined },
    } as BriefDraft);
    await expect(engine.drafts.finalize(d.id)).rejects.toMatchObject({
      detail: expect.stringContaining('Budget'),
    });
    engine.drafts.save(d.id, {
      ...c,
      execution: { ...c.execution!, preset: 'inexistant' },
    } as BriefDraft);
    await expect(engine.drafts.finalize(d.id)).rejects.toMatchObject({
      detail: expect.stringContaining('Modèles manquants'),
    });
    await engine.close();
  });
});

describe('catalogues de configuration', () => {
  it('préréglages : tous les rôles couverts, jurés d’une autre famille que le rédacteur (§10.2)', async () => {
    const { engine } = mk();
    const r = (await engine.handle('listPresets', {})) as {
      value: { id: string; models: Record<string, string>; missing: string[] }[];
    };
    expect(r.value.map((p) => p.id)).toEqual(['economique', 'equilibre', 'excellence']);
    const family = (m: string) => m.split('/')[0];
    for (const p of r.value) {
      expect(Object.keys(p.models).sort()).toEqual([...AGENT_ROLES].sort());
      for (const j of ['juror_methodologist', 'juror_specialist', 'juror_form'])
        expect(family(p.models[j]!)).not.toBe(family(p.models.section_writer!));
      expect(p.missing).toEqual([]); // liste de modèles inconnue : rien de signalé
    }
    await engine.close();
  });

  it('signale les modèles absents de la liste OpenRouter courante', async () => {
    const { engine } = mk();
    engine.settings.set('openrouter_models_cache', {
      fetchedAt: new Date().toISOString(),
      models: [{ id: 'google/gemini-3.8-flash' }, { id: 'deepseek/deepseek-v4-flash' }],
    });
    const r = (await engine.handle('listPresets', {})) as {
      value: { id: string; missing: string[] }[];
    };
    expect(r.value.find((p) => p.id === 'economique')!.missing).toEqual([
      'deepseek/deepseek-v4-pro',
    ]);
    expect(r.value.find((p) => p.id === 'equilibre')!.missing).toContain(
      'anthropic/claude-sonnet-5.5',
    );
    await engine.close();
  });

  it('fichiers de configuration absents : le moteur démarre avec des listes vides', async () => {
    const { engine } = mk({
      presetsPath: '/nulle/part/presets.json',
      normsProfilesPath: '/nulle/part/norms.json',
    });
    expect(await engine.handle('listPresets', {})).toEqual({ ok: true, value: [] });
    expect(await engine.handle('listNormsProfiles', {})).toEqual({ ok: true, value: [] });
    await engine.close();
  });

  it('fichier de préréglages corrompu ou incomplet : erreur explicite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const bad = join(dir, 'p.json');
    writeFileSync(bad, '{ pas du json');
    const { engine } = mk({ presetsPath: bad });
    expect((await engine.handle('listPresets', {})).ok).toBe(false);
    writeFileSync(
      bad,
      JSON.stringify({
        presets: [{ id: 'x', label: 'X', description: '', models: { orchestrator: 'a/b' } }],
      }),
    );
    expect(await engine.handle('listPresets', {})).toMatchObject({ ok: false });
    await engine.close();
  });

  it('profils de normes', async () => {
    const { engine } = mk();
    const r = (await engine.handle('listNormsProfiles', {})) as {
      value: { id: string; citationMode: string; exampleCitation: string }[];
    };
    expect(r.value[0]!.id).toBe('afrique-francophone-standard');
    expect(
      r.value.every((p) => p.exampleCitation && ['auteur_date', 'notes'].includes(p.citationMode)),
    ).toBe(true);
    await engine.close();
  });
});
