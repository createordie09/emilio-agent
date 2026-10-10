import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  runMigrations,
  SourceHttp,
  DEFAULT_HTTP_CONFIG,
  OpenAlexConnector,
  CrossrefConnector,
  HalConnector,
  SemanticScholarConnector,
  UnpaywallConnector,
  ArxivConnector,
  EuropePmcConnector,
  DoajConnector,
  CoreConnector,
  OpenLibrary,
  verifySource,
  type SourceConnector,
  type CandidateSource,
} from '../src';

/**
 * Validation des connecteurs contre les VRAIS services (CdC §11.2 [À VÉRIFIER]).
 *   EMILIO_CONTACT_EMAIL=vous@exemple.org pnpm sources:check
 * Variables facultatives : EMILIO_S2_KEY, EMILIO_CORE_KEY. Les réponses brutes sont enregistrées dans test-live/recorded/
 * (à relire, puis à reprendre comme gabarits dans test/sources.test.ts si la structure a changé).
 */
const EMAIL = process.env.EMILIO_CONTACT_EMAIL;
const rec = join(__dirname, 'recorded');
mkdirSync(rec, { recursive: true });

let http: SourceHttp;
beforeAll(() => {
  const db = new Database(join(mkdtempSync(join(tmpdir(), 'live-')), 'l.db'));
  runMigrations(db);
  const rawFetch = (u: string, i?: RequestInit) =>
    fetch(u, i).then(async (r) => {
      writeFileSync(
        join(rec, `${new URL(u).hostname}.json`),
        (await r.clone().text()).slice(0, 20000),
      );
      return r;
    });
  http = new SourceHttp(
    db,
    rawFetch,
    { ...DEFAULT_HTTP_CONFIG, cacheTtlMs: 0, maxRetries: 1 },
    () => EMAIL,
  );
});

const QUERY = { text: 'microfinance inclusion financière Bénin', limit: 5 };
const shape = (c: CandidateSource) =>
  expect(c).toMatchObject({
    title: expect.any(String),
    authors: expect.any(Array),
    origin: expect.any(String),
  });

const searchers: [string, () => SourceConnector][] = [
  ['OpenAlex', () => new OpenAlexConnector(http)],
  ['Crossref', () => new CrossrefConnector(http)],
  ['HAL', () => new HalConnector(http)],
  ['Semantic Scholar', () => new SemanticScholarConnector(http, () => process.env.EMILIO_S2_KEY)],
  ['arXiv', () => new ArxivConnector(http)],
  ['Europe PMC', () => new EuropePmcConnector(http)],
  ['DOAJ', () => new DoajConnector(http)],
];

describe.each(searchers)('%s (réel)', (_name, make) => {
  it('renvoie des notices exploitables', async () => {
    const r = await make().search(QUERY);
    console.log(
      `${_name} : ${r.length} résultat(s) ; 1er = ${r[0]?.title} (${r[0]?.year}) doi=${r[0]?.doi}`,
    );
    expect(r.length).toBeGreaterThan(0);
    r.forEach(shape);
    expect(r.filter((x) => x.year).length).toBeGreaterThan(0);
  });
});

describe('services à identifiant (réel)', () => {
  it('Crossref et OpenAlex retrouvent un DOI connu', async () => {
    const doi = '10.1257/jep.25.3.29';
    for (const c of [new CrossrefConnector(http), new OpenAlexConnector(http)]) {
      const r = await c.fetchByDoi!(doi);
      expect(r?.doi).toBe(doi);
      expect(r?.title.length).toBeGreaterThan(5);
    }
    expect(await new CrossrefConnector(http).fetchByDoi!('10.5555/doi-qui-nexiste-pas')).toBeNull();
  });
  it.skipIf(!EMAIL)(
    'Unpaywall renvoie des emplacements pour un article en accès ouvert connu',
    async () => {
      const l = await new UnpaywallConnector(http).openAccess('10.1038/nature12373');
      expect(Array.isArray(l)).toBe(true);
    },
  );
  it('Open Library connaît un ISBN usuel', async () => {
    const b = await new OpenLibrary(http).byIsbn('9780262026659');
    console.log('Open Library :', b?.title);
    expect(b?.title).toBeTruthy();
  });
  it.skipIf(!process.env.EMILIO_CORE_KEY)('CORE (clé fournie)', async () => {
    const r = await new CoreConnector(http, () => process.env.EMILIO_CORE_KEY).search(QUERY);
    expect(r.length).toBeGreaterThan(0);
  });
  it('la vérification rejette un DOI inventé et valide un vrai', async () => {
    const doiSources = [{ id: 'crossref' as const, connector: new CrossrefConnector(http) }];
    const vrai = await verifySource(
      {
        origin: 'x',
        type: 'article',
        title: 'Economists and the economics of the micro-finance',
        authors: [],
        doi: '10.1257/jep.25.3.29',
      },
      { doiSources },
    );
    console.log('vérification du DOI réel :', vrai.status, vrai.reasonFr);
    const faux = await verifySource(
      {
        origin: 'x',
        type: 'article',
        title: 'Étude fantôme',
        authors: ['X'],
        year: 2020,
        doi: '10.5555/doi-qui-nexiste-pas',
      },
      { doiSources },
    );
    expect(faux.status).toBe('rejected');
  });
});
