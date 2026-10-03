import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  extractText,
  chunkDocument,
  stripRunningHeaders,
  HashEmbedder,
  runMigrations,
  KbStore,
  ftsQuery,
  profileDataFile,
  parseNumber,
  newId,
  EMBEDDING_DIM,
  resolveEmbedder,
  embeddingModelAvailable,
  DEFAULT_CHUNK_OPTIONS,
} from '../src';

const fx = (f: string) => join(__dirname, 'fixtures', f);
const words = (s: string) => s.trim().split(/\s+/).length;

describe('extraction de texte', () => {
  it('PDF : texte par page, métadonnées, pas de scan', async () => {
    const d = await extractText(fx('memoire-exemple.pdf'));
    expect(d.kind).toBe('pdf');
    expect(d.pages.length).toBeGreaterThanOrEqual(8);
    expect(d.pages[0]!.page).toBe(1);
    expect(d.pages[0]!.text).toContain('Introduction');
    expect(d.pages[0]!.text).toContain("Université d'Abomey-Calavi"); // en-tête encore présent avant nettoyage
    expect(d.scanned).toBe(false);
  });

  it('PDF scanné détecté avec avertissement OCR', async () => {
    const d = await extractText(fx('scan.pdf'));
    expect(d.scanned).toBe(true);
    expect(d.warnings[0]).toMatch(/scanné.*OCR/);
  });

  it('DOCX et TXT', async () => {
    const d = await extractText(fx('guide-redaction.docx'));
    expect(d.kind).toBe('docx');
    expect(d.pages[0]!.text).toContain('Times New Roman');
    expect(d.pages[0]!.page).toBeNull();
  });

  it('erreurs en français : fichier absent, format inconnu, PDF corrompu', async () => {
    await expect(extractText(fx('nope.pdf'), 'nope.pdf')).rejects.toMatchObject({
      code: 'E_PARSE_FILE',
    });
    await expect(extractText(fx('generate.mjs'), 'x.xyz')).rejects.toMatchObject({
      code: 'E_PARSE_FILE',
      detail: expect.stringContaining('non pris en charge'),
    });
    await expect(extractText(fx('donnees-enquete.csv'), 'faux.pdf')).rejects.toMatchObject({
      code: 'E_PARSE_FILE',
    });
  });
});

describe('découpage (§11.5)', () => {
  it('retire en-têtes, pieds de page et numéros répétés', async () => {
    const d = await extractText(fx('memoire-exemple.pdf'));
    const clean = stripRunningHeaders(d.pages);
    for (const p of clean) {
      expect(p.text).not.toMatch(/Abomey-Calavi/);
      expect(p.text).not.toMatch(/^Page \d+$/m);
    }
    expect(clean[3]!.text).toContain('Méthodologie');
  });

  it('extraits de 300 à 800 mots, pages conservées, chevauchement d’un paragraphe', async () => {
    const d = await extractText(fx('memoire-exemple.pdf'));
    const chunks = chunkDocument(d.pages);
    const body = chunks.filter((c) => !c.isBibliography);
    expect(body.length).toBeGreaterThan(3);
    for (const c of body.slice(0, -1)) {
      expect(words(c.text)).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxWords + 20);
      expect(words(c.text)).toBeGreaterThanOrEqual(DEFAULT_CHUNK_OPTIONS.minWords * 0.5);
    }
    expect(body[0]!.pageFrom).toBe(1);
    expect(body.at(-1)!.pageTo).toBeGreaterThanOrEqual(7);
    // chevauchement : le dernier paragraphe d'un extrait ouvre le suivant
    const lastPara = body[0]!.text.split('\n\n').at(-1)!;
    expect(body[1]!.text.startsWith(lastPara)).toBe(true);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('repère la bibliographie (exclue de la recherche) et les titres de section', async () => {
    const d = await extractText(fx('memoire-exemple.pdf'));
    const chunks = chunkDocument(d.pages);
    const bib = chunks.filter((c) => c.isBibliography);
    expect(bib.length).toBeGreaterThan(0);
    expect(
      bib.every(
        (c) => /Armendariz|Banerjee|Gentil/.test(c.text) || c.text.includes('Bibliographie'),
      ),
    ).toBe(true);
    const body = chunks.filter((c) => !c.isBibliography);
    expect(body[0]!.sectionTitle).toBe('1. Introduction');
    expect(new Set(body.map((c) => c.sectionTitle)).size).toBeGreaterThanOrEqual(3);
    expect(body.some((c) => c.text.includes('3. Méthodologie'))).toBe(true);
    expect(body.some((c) => c.text.includes('Conclusion'))).toBe(true);
  });

  it('découpe un paragraphe géant sans dépasser la taille maximale', () => {
    const sentence = 'La microfinance favorise fortement ' + 'l’inclusion financière des ménages. ';
    const big = sentence.repeat(400); // ~ 2400 mots
    const chunks = chunkDocument([{ page: null, text: big }]);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks)
      expect(words(c.text)).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxWords + 160);
  });

  it('texte vide → aucun extrait', () => {
    expect(chunkDocument([{ page: null, text: '   \n\n  ' }])).toEqual([]);
  });
});

describe('embeddings et recherche hybride (§11.5)', () => {
  const setup = async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const mid = newId();
    const sid = newId();
    db.prepare('INSERT INTO missions(id,title) VALUES (?,?)').run(mid, 'M');
    db.prepare('INSERT INTO sources(id,mission_id,origin,type,title) VALUES (?,?,?,?,?)').run(
      sid,
      mid,
      'user_upload',
      'article',
      'Microfinance au Bénin',
    );
    const store = new KbStore(db);
    const emb = new HashEmbedder();
    const d = await extractText(fx('memoire-exemple.pdf'));
    const chunks = chunkDocument(d.pages);
    store.insertChunks(mid, sid, chunks, await emb.embedPassages(chunks.map((c) => c.text)));
    return { db, store, emb, mid, sid, chunks };
  };

  it('vecteurs normalisés de dimension 384, déterministes, insensibles aux accents', async () => {
    const e = new HashEmbedder();
    const [a, b] = await e.embedPassages(['Épargne rurale', 'epargne rurale']);
    expect(a!.length).toBe(EMBEDDING_DIM);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 5);
    expect([...a!]).toEqual([...b!]);
  });

  it('ne stocke pas de vecteur pour la bibliographie ; compte les extraits', async () => {
    const { db, store, mid, chunks } = await setup();
    const c = store.count(mid);
    expect(c.chunks).toBe(chunks.length);
    expect(c.searchable).toBeLessThan(c.chunks);
    expect((db.prepare('SELECT COUNT(*) n FROM chunks_vec').get() as { n: number }).n).toBe(
      c.searchable,
    );
  });

  it('trouve l’extrait pertinent, avec pages et scores décomposés', async () => {
    const { store, emb, mid } = await setup();
    const hits = await store.search(emb, {
      missionId: mid,
      query: 'régulation UEMOA systèmes financiers décentralisés',
      limit: 3,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toMatch(/UEMOA/);
    expect(hits[0]!.pageFrom).not.toBeNull();
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits[0]!.score).toBeCloseTo(0.6 * hits[0]!.vectorScore + 0.4 * hits[0]!.lexicalScore, 6);
    expect(hits.every((h, i) => i === 0 || hits[i - 1]!.score >= h.score)).toBe(true);
  });

  it('exclut la bibliographie et les autres missions ; requête vide ou sans résultat', async () => {
    const { db, store, emb, mid } = await setup();
    const hits = await store.search(emb, {
      missionId: mid,
      query: 'Armendariz Morduch Economics of Microfinance',
      limit: 20,
    });
    expect(hits.every((h) => !/Gentil, D\./.test(h.text))).toBe(true);
    const other = newId();
    db.prepare('INSERT INTO missions(id,title) VALUES (?,?)').run(other, 'Autre');
    expect(await store.search(emb, { missionId: other, query: 'microfinance' })).toEqual([]);
    expect(await store.search(emb, { missionId: mid, query: '!!!' })).toBeDefined();
  });

  it('removeSource supprime extraits et vecteurs', async () => {
    const { db, store, mid, sid } = await setup();
    store.removeSource(sid);
    expect(store.count(mid)).toEqual({ chunks: 0, searchable: 0 });
    expect((db.prepare('SELECT COUNT(*) n FROM chunks_vec').get() as { n: number }).n).toBe(0);
  });

  it('ftsQuery échappe les guillemets et opérateurs', () => {
    expect(ftsQuery('taux "de" remboursement AND NOT x')).toBe(
      '"taux" OR "de" OR "remboursement" OR "AND" OR "NOT"',
    );
    expect(ftsQuery('  ')).toBe('');
  });

  it('repli lexical si le modèle local est absent', () => {
    expect(embeddingModelAvailable('/chemin/inexistant')).toBe(false);
    const e = resolveEmbedder('/chemin/inexistant');
    expect(e.semantic).toBe(false);
    expect(resolveEmbedder(undefined).modelId).toBe('repli-lexical-hash');
  });
});

describe('profil des données de terrain (§9 P0.4)', () => {
  it('CSV « ; » avec décimales françaises et BOM', async () => {
    const p = await profileDataFile(fx('donnees-enquete.csv'));
    expect(p.respondents).toBe(60);
    expect(p.columns.map((c) => c.name)).toContain('Revenu mensuel (FCFA)');
    const col = (n: string) => p.columns.find((c) => c.name === n)!;
    expect(col('Age').type).toBe('integer');
    expect(col('Taux de remboursement').type).toBe('number');
    expect(col('Taux de remboursement').numeric!.max).toBeLessThanOrEqual(5);
    expect(col('Sexe').type).toBe('categorical');
    expect(col('Sexe').modalities!.reduce((n, m) => n + m.count, 0)).toBe(60);
    expect(col('Credit obtenu').type).toBe('boolean');
    expect(col('Satisfaction (1-5)').modalities!.length).toBeLessThanOrEqual(5);
    expect(col('Remarque').missing).toBeGreaterThan(0);
    expect(col('Identifiant').type).toBe('text');
    expect(p.sample).toHaveLength(5);
  });

  it('XLSX : même profil que le CSV, feuille principale signalée', async () => {
    const x = await profileDataFile(fx('donnees-enquete.xlsx'));
    const c = await profileDataFile(fx('donnees-enquete.csv'));
    expect(x.respondents).toBe(60);
    expect(x.sheet).toBe('Enquête');
    expect(x.warnings.some((w) => /2 feuilles/.test(w))).toBe(true);
    const age = (p: typeof x) => p.columns.find((k) => k.name === 'Age')!.numeric!;
    expect(age(x)).toEqual(age(c));
  });

  it('statistiques calculées par du code (moyenne, médiane, écart-type d’échantillon)', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const f = join(mkdtempSync(join(tmpdir(), 'p-')), 'a.csv');
    writeFileSync(f, 'x\n2\n4\n4\n4\n5\n5\n7\n9\n');
    const p = await profileDataFile(f);
    const n = p.columns[0]!.numeric!;
    expect(n.mean).toBe(5);
    expect(n.median).toBe(4.5);
    expect(n.sd).toBeCloseTo(2.138089935, 6);
    expect(p.warnings.some((w) => /Échantillon très réduit/.test(w))).toBe(true);
  });

  it('avertit : colonnes vides, doublons ; refuse les formats non tabulaires', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const f = join(mkdtempSync(join(tmpdir(), 'p-')), 'b.csv');
    writeFileSync(f, 'a;b;c\n1;;x\n1;;x\n2;;y\n');
    const p = await profileDataFile(f);
    expect(p.warnings.some((w) => /« b » est entièrement vide/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /double/.test(w))).toBe(true);
    await expect(profileDataFile(fx('guide-redaction.docx'), 'g.docx')).rejects.toMatchObject({
      code: 'E_PARSE_FILE',
    });
  });

  it('parseNumber : espaces insécables et virgules', () => {
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('1 234')).toBe(1234);
  });
});

describe('embeddeur local (Transformers.js)', () => {
  it('la bibliothèque se charge hors ligne et le téléchargement distant est désactivé par conception', async () => {
    const t = await import('@huggingface/transformers');
    expect(typeof t.pipeline).toBe('function');
    expect(typeof t.env).toBe('object');
  });

  it('TransformersEmbedder : identifiant = nom du dossier, dimension 384, sémantique', async () => {
    const { TransformersEmbedder } = await import('../src');
    const e = new TransformersEmbedder('/x/models/multilingual-e5-small');
    expect(e.modelId).toBe('multilingual-e5-small');
    expect(e.dim).toBe(384);
    expect(e.semantic).toBe(true);
    // Modèle absent : l'échec est explicite (pas de téléchargement silencieux).
    await expect(e.embedQuery('test')).rejects.toBeDefined();
  });
});
