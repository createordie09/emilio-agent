import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '@emilio/shared';
import {
  verifySource,
  verifyMany,
  compareRecords,
  quoteExists,
  normalizeForQuote,
  makeTextPdf,
  mockArticleLines,
  extractText,
  EngineService,
  HashEmbedder,
  MockLlmClient,
  createDemoMission,
  researchMockRespond,
  MOCK_CORPUS,
  MockSourceConnector,
  type CandidateSource,
  type VerifyDeps,
  type SectionSpec,
} from '../src';
import { writeFileSync } from 'node:fs';

const C = (o: Partial<CandidateSource>): CandidateSource => ({
  origin: 'openalex',
  type: 'article',
  title: 'Microfinance et inclusion financière au Bénin',
  authors: ['Adjovi, Koffi'],
  year: 2021,
  ...o,
});
const conn = (rec: CandidateSource | null | Error) => ({
  fetchByDoi: async () => {
    if (rec instanceof Error) throw rec;
    return rec;
  },
});
const deps = (over: Partial<VerifyDeps> = {}): VerifyDeps => ({
  doiSources: [{ id: 'crossref', connector: conn(C({ origin: 'crossref', doi: '10.5555/x' })) }],
  now: () => '2026-10-03T00:00:00.000Z',
  ...over,
});

describe('vérification des sources (§12.1)', () => {
  it('DOI confirmé (titre ≥ 0,85, année, premier auteur) → vérifiée, preuves conservées', async () => {
    const r = await verifySource(C({ doi: '10.5555/x' }), deps());
    expect(r).toMatchObject({ status: 'verified', method: 'doi_crossref', reasonFr: null });
    expect(r.evidence).toMatchObject({
      checkedAt: '2026-10-03T00:00:00.000Z',
      found: { source: 'crossref' },
      scores: { titleScore: 1, yearOk: true, authorMatch: true },
    });
  });
  it('DOI introuvable dans toutes les bases → rejetée avec la raison', async () => {
    const r = await verifySource(
      C({ doi: '10.5555/inexistant' }),
      deps({
        doiSources: [
          { id: 'crossref', connector: conn(null) },
          { id: 'openalex', connector: conn(null) },
        ],
      }),
    );
    expect(r).toMatchObject({ status: 'rejected' });
    expect(r.reasonFr).toMatch(/DOI introuvable/);
  });
  it('DOI qui renvoie à un autre document (titre < 0,6) → rejetée', async () => {
    const r = await verifySource(
      C({ doi: '10.5555/x' }),
      deps({
        doiSources: [
          {
            id: 'crossref',
            connector: conn(
              C({ title: 'Taxonomie des champignons tropicaux', authors: ['Martin, Paul'] }),
            ),
          },
        ],
      }),
    );
    expect(r.status).toBe('rejected');
    expect(r.reasonFr).toMatch(/autre document/);
  });
  it('Crossref en panne : OpenAlex prend le relais', async () => {
    const r = await verifySource(
      C({ doi: '10.5555/x' }),
      deps({
        doiSources: [
          { id: 'crossref', connector: conn(new AppError('E_REMOTE')) },
          { id: 'openalex', connector: conn(C({})) },
        ],
      }),
    );
    expect(r).toMatchObject({ status: 'verified', method: 'doi_openalex' });
    expect((r.evidence.found as { source: string }).source).toBe('openalex');
  });
  it('aucune base ne répond : E_NETWORK (la source reste non vérifiée, pas rejetée à tort)', async () => {
    const d = deps({
      doiSources: [
        { id: 'crossref', connector: conn(new AppError('E_NETWORK')) },
        { id: 'openalex', connector: conn(new AppError('E_NETWORK')) },
      ],
    });
    await expect(verifySource(C({ doi: '10.5555/x' }), d)).rejects.toMatchObject({
      code: 'E_NETWORK',
    });
    expect(await verifyMany([C({ doi: '10.5555/x' }), C({ origin: 'user_upload' })], d)).toEqual([
      null,
      expect.objectContaining({ status: 'verified' }),
    ]);
  });
  it('cas ambigus : arbitre LLM → partiellement vérifiée ou rejetée ; sans arbitre → rejetée', async () => {
    const ref = C({
      title: 'Microfinance et inclusion financière des ménages au Bénin : bilan',
      year: 2021,
    });
    const ambiguous = (arbitrate?: VerifyDeps['arbitrate']) =>
      verifySource(
        C({ doi: '10.5555/x', title: 'Microfinance et inclusion financière des ménages ruraux' }),
        deps({ doiSources: [{ id: 'crossref', connector: conn(ref) }], arbitrate }),
      );
    const same = await ambiguous(async () => ({ same: true, justification: 'Même étude.' }));
    expect(same).toMatchObject({ status: 'partially_verified' });
    expect(same.evidence.arbitration).toMatchObject({ same: true });
    expect(
      await ambiguous(async () => ({ same: false, justification: 'Autre étude.' })),
    ).toMatchObject({ status: 'rejected' });
    expect((await ambiguous()).reasonFr).toMatch(/ambiguë/);
  });
  it('écart d’année > 1 ou premier auteur différent → arbitrage', async () => {
    let asked = 0;
    const arb: VerifyDeps['arbitrate'] = async () => (asked++, { same: true, justification: 'ok' });
    const a = await verifySource(C({ doi: '10.5555/x', year: 2015 }), deps({ arbitrate: arb }));
    const b = await verifySource(
      C({ doi: '10.5555/x', authors: ['Dupont, Jean'] }),
      deps({ arbitrate: arb }),
    );
    expect([a.status, b.status, asked]).toEqual(['partially_verified', 'partially_verified', 2]);
    expect(compareRecords(C({ year: 2020 }), C({ year: 2021 })).yearOk).toBe(true);
    expect(compareRecords(C({ authors: [] }), C({})).authorMatch).toBeNull();
  });
  it('ISBN : trouvé → partiellement vérifiée ; introuvable, invalide ou autre livre → rejetée', async () => {
    const book = (title: string) => ({
      byIsbn: async () => ({ title, authors: ['Adjovi, Koffi'], publishers: ['X'] }),
    });
    const base = C({ type: 'ouvrage', isbn: '9780262026659' });
    expect(
      await verifySource(
        base,
        deps({ books: book('Microfinance et inclusion financière au Bénin') }),
      ),
    ).toMatchObject({ status: 'partially_verified', method: 'isbn_openlibrary' });
    expect((await verifySource(base, deps({ books: book('Cuisine du monde') }))).reasonFr).toMatch(
      /autre livre/,
    );
    expect(
      (await verifySource(base, deps({ books: { byIsbn: async () => null } }))).reasonFr,
    ).toMatch(/introuvable/);
    expect((await verifySource(C({ isbn: '123' }), deps({ books: book('x') }))).reasonFr).toMatch(
      /invalide/,
    );
  });
  it('URL seule : la page doit répondre et contenir les mots du titre', async () => {
    const page = (text: string | null | Error) => ({
      getText: async () => {
        if (text instanceof Error) throw text;
        return text;
      },
    });
    const c = C({ url: 'https://exemple.test/a' });
    expect(
      await verifySource(
        c,
        deps({ http: page('<html>Microfinance et inclusion financière au Bénin</html>') }),
      ),
    ).toMatchObject({ status: 'partially_verified', method: 'url' });
    expect(
      (await verifySource(c, deps({ http: page('<html>Recette de cuisine</html>') }))).reasonFr,
    ).toMatch(/ne contient pas le titre/);
    expect((await verifySource(c, deps({ http: page(null) }))).reasonFr).toMatch(/404/);
    expect(
      (await verifySource(c, deps({ http: page(new AppError('E_NETWORK')) }))).reasonFr,
    ).toMatch(/inaccessible/);
  });
  it('sans identifiant : rejetée (défaut) ou acceptée si l’exigence est désactivée ; import utilisateur : vérifiée', async () => {
    expect((await verifySource(C({}), deps())).reasonFr).toMatch(/invérifiable/);
    expect(await verifySource(C({}), deps({ requireIdentifier: false }))).toMatchObject({
      status: 'partially_verified',
      method: 'none',
    });
    expect(await verifySource(C({ origin: 'user_upload' }), deps())).toMatchObject({
      status: 'verified',
      method: 'user_upload',
    });
  });
  it('verifyMany conserve l’ordre malgré la concurrence', async () => {
    const list = Array.from({ length: 9 }, (_, i) =>
      C({ doi: `10.5555/${i}`, title: `Titre ${i}` }),
    );
    const d = deps({
      doiSources: [
        {
          id: 'crossref',
          connector: {
            fetchByDoi: async (doi: string) => {
              await new Promise((r) => setTimeout(r, 9 - Number(doi.split('/')[1])));
              return C({ title: `Titre ${doi.split('/')[1]}`, doi });
            },
          },
        },
      ],
    });
    const r = await verifyMany(list, d, 3);
    expect(r.map((x) => x!.status)).toEqual(Array(9).fill('verified'));
  });
});

describe('citations littérales (§12.2)', () => {
  it('tolère espaces, apostrophes et guillemets typographiques, tirets, césures', () => {
    const src =
      'Les groupes de caution solidaire réduisent l’asymétrie d’information entre l’institu-\ntion et les « emprunteurs » — surtout ruraux.';
    expect(quoteExists("l'asymétrie d'information entre l'institution", src)).toBe(true);
    expect(quoteExists('les "emprunteurs" - surtout ruraux', src)).toBe(true);
    expect(quoteExists('réduisent la fraude', src)).toBe(false);
    expect(quoteExists('', src)).toBe(false);
    expect(normalizeForQuote('  a  b  ')).toBe('a b');
  });
});

describe('PDF simulé', () => {
  it('le PDF généré est relu avec ses accents et ses pages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
    const f = join(dir, 'a.pdf');
    writeFileSync(
      f,
      makeTextPdf(
        mockArticleLines(
          'Épargne rurale',
          'La microfinance favorise l’inclusion financière des ménages.',
        ),
        20,
      ),
    );
    const d = await extractText(f);
    expect(d.pages.length).toBeGreaterThan(1);
    expect(d.pages.map((p) => p.text).join('\n')).toContain('Épargne rurale');
    expect(d.pages.map((p) => p.text).join('\n')).toMatch(/inclusion financi.re/);
    expect(d.scanned).toBe(false);
  });
});

const mk = (mock?: MockLlmClient) => {
  const dir = mkdtempSync(join(tmpdir(), 'emilio-res-'));
  const m =
    mock ?? new MockLlmClient({ delayMs: 0, costPerCallUsd: 0.001, respond: researchMockRespond });
  const engine = new EngineService({
    dbPath: join(dir, 'e.db'),
    dataDir: dir,
    embedder: new HashEmbedder(),
    mock: m,
    qualityWeightsPath: join(__dirname, '../../../resources/quality-weights.json'),
  });
  const id = createDemoMission(engine);
  return { engine, id, mock: m, dir };
};
const SPEC = (id: string, over: Partial<SectionSpec> = {}): SectionSpec => ({
  missionId: id,
  sectionKey: 'sec-1',
  title: 'Microfinance et inclusion financière',
  objective: 'Analyser le rôle de la microfinance dans l’inclusion financière des ménages ruraux.',
  keyQuestions: ['Quel rôle pour la caution solidaire ?'],
  discipline: 'Sciences de gestion',
  workType: 'mémoire de master',
  minSources: 3,
  prioriteAfrique: true,
  ...over,
});
const events = (e: EngineService, id: string) => e.journal.list(id, 500).map((x) => x.messageFr);

describe('recherche d’une section (§9 P3) — connecteurs simulés', () => {
  it('trouve, fusionne, classe, vérifie, rejette l’inventé, indexe le texte intégral et rédige des fiches', async () => {
    const { engine, id } = mk();
    const r = await engine.research.researchSection(SPEC(id));
    expect(r.coverageOk).toBe(true);
    expect(r.retained.length).toBeGreaterThanOrEqual(3);
    // fusion multi-connecteurs : moins de notices fusionnées que de notices brutes
    expect(r.merged).toBeLessThan(r.found);
    // la source inventée est rejetée avec sa raison, et jamais retenue
    expect(r.rejected.map((x) => x.title)).toContain('Étude fantôme sur la microfinance au Bénin');
    expect(r.rejected.find((x) => /fantôme/.test(x.title))!.reasonFr).toMatch(/DOI introuvable/);
    expect(r.retained.map((x) => x.title)).not.toContain(
      'Étude fantôme sur la microfinance au Bénin',
    );
    const status = (t: string) =>
      engine.db
        .prepare(
          'SELECT verification_status s, verification_json j FROM sources WHERE title LIKE ?',
        )
        .get(`%${t}%`) as { s: string; j: string } | undefined;
    expect(status('fantôme')!.s).toBe('rejected');
    const ok = status('Microfinance et inclusion financière des ménages ruraux');
    expect(ok!.s).toBe('verified');
    expect(JSON.parse(ok!.j)).toMatchObject({
      method: expect.stringMatching(/^doi_/),
      scores: { titleScore: 1 },
    });
    // jamais de source retenue non vérifiée
    for (const x of r.retained) expect(['verified', 'partially_verified']).toContain(x.status);
    // texte intégral pour la source avec PDF, résumé seul pour les autres
    const ft = engine.db
      .prepare(
        'SELECT title, fulltext_status s FROM sources WHERE id IN (SELECT source_id FROM section_sources)',
      )
      .all() as { title: string; s: string }[];
    expect(ft.find((x) => /ménages ruraux/.test(x.title))!.s).toBe('fulltext');
    expect(ft.some((x) => x.s === 'abstract_only')).toBe(true);
    // matrice section ↔ sources avec rangs consécutifs
    const m = engine.db
      .prepare('SELECT rank FROM section_sources WHERE section_key=? ORDER BY rank')
      .all('sec-1') as { rank: number }[];
    expect(m.map((x) => x.rank)).toEqual(m.map((_, i) => i + 1));
    expect(m).toHaveLength(r.retained.length);
    // CSL-JSON rempli
    const csl = JSON.parse(
      (
        engine.db
          .prepare('SELECT csl_json c FROM sources WHERE doi=?')
          .get('10.5555/mf.2021.001') as { c: string }
      ).c,
    );
    expect(csl).toMatchObject({
      type: 'article-journal',
      DOI: '10.5555/mf.2021.001',
      issued: { 'date-parts': [[2021]] },
    });
    // événements en français
    const ev = events(engine, id).join('\n');
    expect(ev).toMatch(
      /Chercheur \(Microfinance et inclusion financière\) : \d+ nouvelle\(s\) source\(s\)/,
    );
    expect(ev).toMatch(/Vérificateur : \d+ source\(s\) vérifiée\(s\), \d+ rejetée\(s\)/);
    expect(ev).toMatch(/Recherche terminée/);
    await engine.close();
  });

  it('un résultat hors sujet est écarté par le classement : ni vérifié ni retenu', async () => {
    const { engine, id } = mk();
    engine.mockSources.push(
      new MockSourceConnector(
        'bruit',
        'Connecteur bruyant',
        (c) => /champignons/.test(c.title),
        undefined,
        undefined,
        true,
      ),
    );
    const r = await engine.research.researchSection(SPEC(id));
    expect(r.retained.map((x) => x.title).join()).not.toMatch(/champignons/);
    expect(
      (
        engine.db
          .prepare("SELECT verification_status s FROM sources WHERE title LIKE '%champignons%'")
          .get() as { s: string }
      ).s,
    ).toBe('unverified');
    expect(r.coverageOk).toBe(true);
    await engine.close();
  });

  it('les fiches de lecture citent littéralement le texte source, avec la page', async () => {
    const { engine, id } = mk();
    const r = await engine.research.researchSection(SPEC(id));
    expect(r.notes).toBeGreaterThan(0);
    expect(r.quotesDropped).toBe(0);
    const notes = engine.db.prepare('SELECT source_id, note_json FROM reading_notes').all() as {
      source_id: string;
      note_json: string;
    }[];
    let quotes = 0;
    for (const n of notes) {
      const note = JSON.parse(n.note_json) as { citations: { texte: string; chunkId: string }[] };
      for (const c of note.citations) {
        quotes++;
        const chunk = engine.db
          .prepare('SELECT text, source_id FROM chunks WHERE id=?')
          .get(c.chunkId) as { text: string; source_id: string };
        expect(chunk.source_id).toBe(n.source_id);
        expect(quoteExists(c.texte, chunk.text)).toBe(true);
      }
    }
    expect(quotes).toBeGreaterThan(0);
    await engine.close();
  });

  it('une citation fabriquée par le modèle est supprimée par le contrôle littéral', async () => {
    const mock = new MockLlmClient({
      delayMs: 0,
      respond: (req) => {
        if (req.meta?.label === 'recherche:fiche') {
          const real = JSON.parse(researchMockRespond(req)!) as {
            citations: { extrait: string; texte: string }[];
          };
          return JSON.stringify({
            ...JSON.parse(researchMockRespond(req)!),
            citations: [
              ...real.citations,
              {
                extrait: 'E1',
                texte: 'Cette phrase inventée ne figure dans aucun extrait de la source.',
              },
            ],
          });
        }
        return researchMockRespond(req);
      },
    });
    const { engine, id } = mk(mock);
    const r = await engine.research.researchSection(SPEC(id));
    expect(r.quotesDropped).toBeGreaterThan(0);
    for (const n of engine.db.prepare('SELECT note_json FROM reading_notes').all() as {
      note_json: string;
    }[]) {
      expect(
        JSON.parse(n.note_json).citations.every(
          (c: { texte: string }) => !/inventée/.test(c.texte),
        ),
      ).toBe(true);
    }
    await engine.close();
  });

  it('un identifiant inventé dans le classement est ignoré', async () => {
    const mock = new MockLlmClient({
      delayMs: 0,
      respond: (req) => {
        const base = researchMockRespond(req);
        if (req.meta?.label !== 'recherche:classement') return base;
        const j = JSON.parse(base!);
        j.evaluations.push({ id: 'C999', score: 10, garder: true, justification: 'inventé' });
        return JSON.stringify(j);
      },
    });
    const { engine, id } = mk(mock);
    expect((await engine.research.researchSection(SPEC(id))).coverageOk).toBe(true);
    await engine.close();
  });

  it('un connecteur en panne est signalé et ignoré : la recherche aboutit quand même', async () => {
    const { engine, id } = mk();
    engine.mockSources[2]!.failWith = new AppError('E_NETWORK', 'panne simulée');
    const r = await engine.research.researchSection(SPEC(id));
    expect(r.warnings.some((w) => /ignorée/.test(w))).toBe(true);
    expect(r.coverageOk).toBe(true);
    await engine.close();
  });

  it('couverture insuffisante : 3 itérations élargies puis avertissement (E_SOURCES_INSUFFICIENT)', async () => {
    const { engine, id } = mk();
    const r = await engine.research.researchSection(SPEC(id, { minSources: 20 }));
    expect(r.iterations).toBe(3);
    expect(r.coverageOk).toBe(false);
    expect(r.warnings.join()).toMatch(
      /Peu de sources trouvées pour la section « Microfinance et inclusion financière »/,
    );
    expect(events(engine, id).filter((m) => /recherche élargie/.test(m))).toHaveLength(2);
    await engine.close();
  });

  it('coupure réseau pendant la vérification : sources laissées « non vérifiées », aucun rejet à tort', async () => {
    const { engine, id } = mk();
    for (const c of engine.mockSources)
      if (c.id === 'crossref' || c.id === 'openalex') c.failWith = new AppError('E_NETWORK');
    const r = await engine.research.researchSection(SPEC(id));
    expect(r.unverified).toBeGreaterThan(0);
    expect(r.rejected.filter((x) => /DOI/.test(x.reasonFr))).toEqual([]);
    // Les sources à DOI restent non vérifiées ; seules celles vérifiables par ISBN ou URL (autres chemins) peuvent être retenues.
    const doiRows = engine.db
      .prepare('SELECT verification_status s FROM sources WHERE doi IS NOT NULL')
      .all() as { s: string }[];
    expect(doiRows.length).toBeGreaterThan(0);
    expect(doiRows.every((x) => x.s === 'unverified')).toBe(true);
    for (const x of r.retained)
      expect(engine.db.prepare('SELECT doi FROM sources WHERE id=?').get(x.sourceId)).toEqual({
        doi: null,
      });
    await engine.close();
  });

  it('les documents importés par l’utilisateur sont prioritaires ; le guide d’établissement n’est jamais une source', async () => {
    const { engine, id } = mk();
    const fx = (f: string) => join(__dirname, 'fixtures', f);
    await engine.ingest.add(id, [
      { path: fx('memoire-exemple.pdf'), kind: 'user_document' },
      { path: fx('guide-redaction.docx'), kind: 'institution_guidelines' },
    ]);
    await engine.ingest.idle();
    const r = await engine.research.researchSection(
      SPEC(id, {
        title: 'Microfinance rurale',
        objective: 'caution solidaire asymétrie d’information microfinance ménages ruraux',
      }),
    );
    expect(r.retained[0]).toMatchObject({ status: 'user_upload', title: 'memoire exemple' });
    expect(r.retained.map((x) => x.title)).not.toContain('guide redaction');
    await engine.close();
  });

  it('relancer la recherche ne duplique ni les sources ni la matrice', async () => {
    const { engine, id } = mk();
    await engine.research.researchSection(SPEC(id));
    const count = () =>
      (
        engine.db.prepare('SELECT COUNT(*) n FROM sources WHERE mission_id=?').get(id) as {
          n: number;
        }
      ).n;
    const n1 = count();
    const m1 = (engine.db.prepare('SELECT COUNT(*) n FROM section_sources').get() as { n: number })
      .n;
    await engine.research.researchSection(SPEC(id));
    expect(count()).toBe(n1);
    expect(
      (engine.db.prepare('SELECT COUNT(*) n FROM section_sources').get() as { n: number }).n,
    ).toBe(m1);
    await engine.close();
  });

  it('les appels de modèle sont comptés dans le coût de la mission', async () => {
    const { engine, id } = mk();
    const before = engine.missions.costSpent(id);
    await engine.research.researchSection(SPEC(id));
    expect(engine.missions.costSpent(id)).toBeGreaterThan(before);
    await engine.close();
  });

  it('crédit épuisé pendant la recherche : l’erreur remonte (la mission se mettra en pause)', async () => {
    const { engine, id, mock } = mk();
    mock.creditExhausted = true;
    await expect(engine.research.researchSection(SPEC(id))).rejects.toMatchObject({
      code: 'E_NO_CREDIT',
    });
    await engine.close();
  });

  it('le corpus simulé est fictif (DOI de test) et la profondeur « rapide » limite le travail', async () => {
    expect(MOCK_CORPUS.every((c) => !c.doi || c.doi.startsWith('10.5555/'))).toBe(true);
    const a = mk();
    const lent = await a.engine.research.researchSection(SPEC(a.id, { depth: 'approfondie' }));
    const b = mk();
    const vite = await b.engine.research.researchSection(SPEC(b.id, { depth: 'rapide' }));
    expect(vite.notes).toBeLessThanOrEqual(3);
    expect(lent.notes).toBeGreaterThanOrEqual(vite.notes);
    await a.engine.close();
    await b.engine.close();
  });
});

describe('API du moteur : sources', () => {
  it('liste, fiche détaillée avec preuves et fiches de lecture, réglages et test des connexions', async () => {
    const { engine, id } = mk();
    const r = await engine.handle('demoResearch', { id });
    expect(r).toMatchObject({ ok: true, value: { coverageOk: true } });
    const list = (await engine.handle('listSources', { id })) as {
      value: { id: string; title: string; verificationStatus: string; sections: string[] }[];
    };
    expect(list.value.length).toBeGreaterThan(3);
    expect(list.value.some((s) => s.verificationStatus === 'rejected')).toBe(true);
    const retained = list.value.find(
      (s) => s.sections.includes('demo-section-1') && s.verificationStatus === 'verified',
    )!;
    const d = (await engine.handle('getSource', { id: retained.id })) as {
      value: { evidence: { method: string }; notes: { citations: unknown[] }[]; chunks: number };
    };
    expect(d.value.evidence.method).toMatch(/^doi_/);
    expect(d.value.chunks).toBeGreaterThan(0);
    expect(d.value.notes.length).toBeGreaterThan(0);
    expect(await engine.handle('getSource', { id: 'nope' })).toMatchObject({ ok: false });

    const cfg = (await engine.handle('saveSourcesConfig', {
      config: { contactEmail: ' moi@exemple.org ', enabled: { arxiv: true } },
    })) as {
      value: {
        contactEmail: string;
        connectors: { id: string; enabled: boolean; needsKey: boolean; keyConfigured: boolean }[];
      };
    };
    expect(cfg.value.contactEmail).toBe('moi@exemple.org');
    expect(cfg.value.connectors.find((c) => c.id === 'arxiv')!.enabled).toBe(true);
    expect(cfg.value.connectors.find((c) => c.id === 'core')).toMatchObject({
      needsKey: true,
      keyConfigured: false,
    });
    await engine.handle('setSourceKey', { connector: 'core', key: 'K' });
    expect(
      (
        (await engine.handle('getSourcesConfig', {})) as {
          value: { connectors: { id: string; keyConfigured: boolean }[] };
        }
      ).value.connectors.find((c) => c.id === 'core')!.keyConfigured,
    ).toBe(true);
    await engine.close();
  });

  it('la recherche de démonstration est réservée aux missions simulées', async () => {
    const { engine } = mk();
    const real = engine.missions.create({
      title: 'Réelle',
      config: { llmMode: 'real', models: {}, budgetMaxUsd: 1, parallelism: 1 },
    });
    expect(await engine.handle('demoResearch', { id: real })).toMatchObject({
      ok: false,
      error: { code: 'E_BAD_REQUEST' },
    });
    await engine.close();
  });
});
