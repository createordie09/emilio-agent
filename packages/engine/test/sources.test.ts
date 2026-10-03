import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  runMigrations,
  SourceHttp,
  DEFAULT_HTTP_CONFIG,
  cacheKey,
  TokenBucket,
  normalizeDoi,
  normalizeIsbn,
  normalizeTitle,
  titleSimilarity,
  authorSurname,
  parseYear,
  cleanAbstract,
  OpenAlexConnector,
  abstractFromInverted,
  mapOpenAlexWork,
  CrossrefConnector,
  mapItem,
  HalConnector,
  mapDoc,
  SemanticScholarConnector,
  UnpaywallConnector,
  locationsOf,
  ArxivConnector,
  parseAtom,
  EuropePmcConnector,
  mapResult,
  DoajConnector,
  mapHit,
  CoreConnector,
  OpenLibrary,
  dedupe,
  qualityScore,
  combinedScore,
  loadQualityWeights,
  DEFAULT_QUALITY_WEIGHTS,
  toCsl,
  SourceRegistry,
  searchAll,
  extraConnectorsForDiscipline,
  mockConnectors,
  MockSourceConnector,
  MOCK_CORPUS,
  type CandidateSource,
  type FetchLike,
} from '../src';

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function mkHttp(handler: FetchLike, email: string | undefined = 'contact@exemple.org') {
  const db = new Database(':memory:');
  runMigrations(db);
  const calls: { url: string; init?: RequestInit }[] = [];
  let t = 1_000_000;
  const http = new SourceHttp(
    db,
    async (u, i) => (calls.push({ url: u, init: i }), handler(u, i)),
    { ...DEFAULT_HTTP_CONFIG, retryBaseMs: 1, retryMaxMs: 2 },
    () => email,
    () => t,
    async (ms) => void (t += ms),
  );
  return { http, db, calls, advance: (ms: number) => (t += ms) };
}

describe('normalisation', () => {
  it('DOI : URL, préfixe doi:, casse et ponctuation finale', () => {
    expect(normalizeDoi('https://doi.org/10.1257/JEP.25.3.29')).toBe('10.1257/jep.25.3.29');
    expect(normalizeDoi('doi:10.5555/ABC-1).')).toBe('10.5555/abc-1');
    expect(normalizeDoi('http://dx.doi.org/10.1000%2Fxyz')).toBe('10.1000/xyz');
    expect(normalizeDoi('pas un doi')).toBeUndefined();
    expect(normalizeDoi(null)).toBeUndefined();
  });
  it('ISBN : somme de contrôle (10 et 13 chiffres)', () => {
    expect(normalizeIsbn('978-0-262-02665-9')).toBe('9780262026659');
    expect(normalizeIsbn('0-306-40615-2')).toBe('0306406152');
    expect(normalizeIsbn('9780262026650')).toBeUndefined();
    expect(normalizeIsbn('123')).toBeUndefined();
  });
  it('titres : insensibles aux accents, à la casse, à la ponctuation et aux balises', () => {
    expect(normalizeTitle('<i>Épargne</i> : rurale !')).toBe('epargne rurale');
    expect(
      titleSimilarity(
        'Microfinance et inclusion financière',
        'MICROFINANCE ET INCLUSION FINANCIERE.',
      ),
    ).toBe(1);
    expect(titleSimilarity('Microfinance au Bénin', 'Taxonomie des champignons')).toBeLessThan(0.3);
    expect(
      titleSimilarity(
        'Microfinance et inclusion financière au Bénin',
        'Microfinance et inclusion financière au Benin : une étude',
      ),
    ).toBeGreaterThan(0.8);
    expect(titleSimilarity('', 'x')).toBe(0);
  });
  it('auteurs, années, résumés', () => {
    expect(authorSurname('Adjovi, Koffi')).toBe('adjovi');
    expect(authorSurname('Marie-Claire Houngbo')).toBe('houngbo');
    expect(authorSurname('Éric Tchoumi')).toBe('tchoumi');
    expect(parseYear('2021-05-03')).toBe(2021);
    expect(parseYear(1200)).toBeUndefined();
    expect(parseYear('n.d.')).toBeUndefined();
    expect(
      cleanAbstract('<jats:p>Une étude &amp; ses limites, sur <i>trois</i> pays.</jats:p>'),
    ).toBe('Une étude & ses limites, sur trois pays.');
    expect(cleanAbstract('court')).toBeUndefined();
  });
});

describe('limiteur de débit', () => {
  it('espace les appels selon le débit et sert dans l’ordre', async () => {
    let t = 0;
    const waits: number[] = [];
    const b = new TokenBucket(
      2,
      1,
      () => t,
      async (ms) => (waits.push(ms), void (t += ms)),
    );
    await b.acquire(); // jeton disponible
    await b.acquire(); // 500 ms
    await b.acquire(); // 500 ms
    expect(waits).toEqual([500, 500]);
    expect(t).toBe(1000);
  });
});

describe('SourceHttp', () => {
  it('met en cache (clé sans e-mail), puis ré-interroge après expiration', async () => {
    const { http, calls, advance } = mkHttp(async () => json({ a: 1 }));
    const u = 'https://api.exemple.test/x?q=a&mailto=contact@exemple.org';
    expect(await http.getJson('t', 10, u)).toEqual({ a: 1 });
    expect(
      await http.getJson('t', 10, 'https://api.exemple.test/x?mailto=autre@x.org&q=a'),
    ).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(cacheKey('t', u)).toBe(cacheKey('t', 'https://api.exemple.test/x?q=a&email=zzz'));
    advance(DEFAULT_HTTP_CONFIG.cacheTtlMs + 1000);
    await http.getJson('t', 10, u);
    expect(calls).toHaveLength(2);
  });
  it('en-tête User-Agent poli avec adresse de contact', async () => {
    const { http, calls } = mkHttp(async () => json({}));
    await http.getJson('t', 10, 'https://api.exemple.test/ua');
    expect((calls[0]!.init!.headers as Record<string, string>)['User-Agent']).toMatch(
      /^emilio-agent\/.+ \(mailto:contact@exemple\.org\)$/,
    );
    const sans = mkHttp(async () => json({}), '');
    expect(sans.http.userAgent()).not.toContain('mailto');
  });
  it('réessaie 429 / 5xx (Retry-After respecté) puis réussit ; 401 → E_SOURCE_AUTH sans réessai ; réseau → E_NETWORK', async () => {
    let n = 0;
    const a = mkHttp(async () =>
      ++n < 3
        ? json({}, n === 1 ? 429 : 503, n === 1 ? { 'retry-after': '1' } : {})
        : json({ ok: 1 }),
    );
    expect(await a.http.getJson('t', 10, 'https://api.exemple.test/r')).toEqual({ ok: 1 });
    expect(a.calls).toHaveLength(3);
    const b = mkHttp(async () => json({}, 401));
    await expect(b.http.getJson('t', 10, 'https://api.exemple.test/k')).rejects.toMatchObject({
      code: 'E_SOURCE_AUTH',
    });
    expect(b.calls).toHaveLength(1);
    const c = mkHttp(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(c.http.getJson('t', 10, 'https://api.exemple.test/n')).rejects.toMatchObject({
      code: 'E_NETWORK',
    });
    expect(c.calls).toHaveLength(DEFAULT_HTTP_CONFIG.maxRetries + 1);
  });
  it('404 : null si autorisé (et mis en cache), erreur sinon ; JSON invalide → E_SOURCE_REMOTE', async () => {
    const a = mkHttp(async () => json({}, 404));
    expect(
      await a.http.getJson('t', 10, 'https://api.exemple.test/a', { notFoundIsNull: true }),
    ).toBeNull();
    expect(
      await a.http.getJson('t', 10, 'https://api.exemple.test/a', { notFoundIsNull: true }),
    ).toBeNull();
    expect(a.calls).toHaveLength(1);
    await expect(
      mkHttp(async () => json({}, 404)).http.getJson('t', 10, 'https://api.exemple.test/b'),
    ).rejects.toMatchObject({ code: 'E_SOURCE_REMOTE' });
    await expect(
      mkHttp(async () => new Response('<html>')).http.getJson(
        't',
        10,
        'https://api.exemple.test/c',
      ),
    ).rejects.toMatchObject({ code: 'E_SOURCE_REMOTE' });
  });
  it('téléchargement : plafond de taille', async () => {
    const ok = mkHttp(async () => new Response(Buffer.from('%PDF-1.4 petit')));
    expect((await ok.http.download('https://x.test/a.pdf', 1000)).toString()).toContain('%PDF');
    const big = mkHttp(async () => new Response(Buffer.alloc(5000)));
    await expect(big.http.download('https://x.test/b.pdf', 1000)).rejects.toMatchObject({
      code: 'E_PARSE_FILE',
    });
  });
});

// Les gabarits ci-dessous reprennent la structure DOCUMENTÉE de chaque API (documentation officielle lue le 3 oct. 2026 :
// OpenAlex « Work object », Crossref « api_format », manuel arXiv ; HAL, Semantic Scholar, Unpaywall, Europe PMC, DOAJ et CORE
// d'après leur documentation publique). Ils NE sont PAS des enregistrements de réponses réelles : voir `pnpm sources:check`.
describe('OpenAlex', () => {
  const work = {
    id: 'https://openalex.org/W1',
    doi: 'https://doi.org/10.5555/MF.2021.001',
    display_name: 'Microfinance au Bénin',
    publication_year: 2021,
    type: 'article',
    language: 'fr',
    authorships: [
      { author: { display_name: 'Koffi Adjovi' }, institutions: [{ country_code: 'BJ' }] },
      { author: { display_name: 'Marie Houngbo' }, countries: ['FR'] },
    ],
    primary_location: {
      landing_page_url: 'https://exemple.test/a',
      source: { display_name: 'Revue X', type: 'journal' },
    },
    best_oa_location: { pdf_url: 'https://exemple.test/a.pdf' },
    open_access: { oa_url: 'https://exemple.test/oa' },
    biblio: { volume: '12', issue: '3', first_page: '45', last_page: '67' },
    cited_by_count: 18,
    abstract_inverted_index: {
      Cette: [0],
      étude: [1],
      analyse: [2],
      la: [3],
      microfinance: [4, 6],
      et: [5],
      'l’inclusion': [7],
      financière: [8],
      rurale: [9],
    },
  };
  it('reconstitue le résumé depuis l’index inversé', () => {
    expect(abstractFromInverted(work.abstract_inverted_index)).toBe(
      'Cette étude analyse la microfinance et microfinance l’inclusion financière rurale',
    );
    expect(abstractFromInverted(null)).toBeUndefined();
  });
  it('mappe une œuvre (DOI normalisé, pages, pays africain, PDF)', () => {
    expect(mapOpenAlexWork(work)).toMatchObject({
      origin: 'openalex',
      type: 'article',
      title: 'Microfinance au Bénin',
      doi: '10.5555/mf.2021.001',
      year: 2021,
      journal: 'Revue X',
      volume: '12',
      issue: '3',
      pages: '45-67',
      authors: ['Koffi Adjovi', 'Marie Houngbo'],
      oaPdfUrl: 'https://exemple.test/a.pdf',
      africa: true,
      peerReviewed: true,
      citationCount: 18,
      language: 'fr',
    });
    expect(mapOpenAlexWork({ id: 'x' })).toBeNull();
  });
  it('construit une requête conforme à la documentation (search, filter, per-page, select, mailto)', async () => {
    const { http, calls } = mkHttp(async () => json({ results: [work] }));
    const r = await new OpenAlexConnector(http).search({
      text: 'microfinance Bénin',
      language: 'fr',
      yearFrom: 2015,
      yearTo: 2024,
      limit: 500,
    });
    expect(r).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://api.openalex.org/works');
    expect(u.searchParams.get('search')).toBe('microfinance Bénin');
    expect(u.searchParams.get('filter')).toBe(
      'language:fr,from_publication_date:2015-01-01,to_publication_date:2024-12-31',
    );
    expect(u.searchParams.get('per-page')).toBe('200'); // plafond documenté
    expect(u.searchParams.get('mailto')).toBe('contact@exemple.org');
    expect(u.searchParams.get('select')).toContain('abstract_inverted_index');
  });
  it('fetchByDoi utilise /works/https://doi.org/<doi> ; 404 → null', async () => {
    const a = mkHttp(async () => json(work));
    expect((await new OpenAlexConnector(a.http).fetchByDoi('10.5555/mf.2021.001'))!.title).toBe(
      'Microfinance au Bénin',
    );
    expect(a.calls[0]!.url).toContain('/works/https://doi.org/10.5555/mf.2021.001');
    expect(
      await new OpenAlexConnector(mkHttp(async () => json({}, 404)).http).fetchByDoi('10.5555/x'),
    ).toBeNull();
  });
  it('emplacements en accès ouvert', async () => {
    const { http } = mkHttp(async () =>
      json({
        best_oa_location: {
          is_oa: true,
          pdf_url: 'https://e.test/p.pdf',
          version: 'publishedVersion',
        },
        locations: [{ is_oa: false, landing_page_url: 'https://e.test/x' }],
      }),
    );
    expect(await new OpenAlexConnector(http).openAccess('10.5555/x')).toEqual([
      {
        pdfUrl: 'https://e.test/p.pdf',
        landingUrl: undefined,
        license: undefined,
        version: 'publishedVersion',
      },
    ]);
  });
});

describe('Crossref', () => {
  const item = {
    DOI: '10.5555/MF.2019.002',
    title: ['Groupes de caution solidaire'],
    author: [{ given: 'Aminata', family: 'Sow' }],
    issued: { 'date-parts': [[2019, 5]] },
    'container-title': ['Cahiers'],
    volume: '4',
    issue: '1',
    page: '1-20',
    publisher: 'Éd.',
    type: 'journal-article',
    URL: 'https://doi.org/10.5555/mf.2019.002',
    ISBN: ['978-0-262-02665-9'],
    abstract: '<jats:p>Résumé suffisamment long pour être retenu.</jats:p>',
    'is-referenced-by-count': 42,
    link: [{ URL: 'https://e.test/a.pdf', 'content-type': 'application/pdf' }],
  };
  it('mappe un élément documenté', () => {
    expect(mapItem(item)).toMatchObject({
      origin: 'crossref',
      type: 'article',
      title: 'Groupes de caution solidaire',
      authors: ['Sow, Aminata'],
      year: 2019,
      doi: '10.5555/mf.2019.002',
      pages: '1-20',
      isbn: '9780262026659',
      oaPdfUrl: 'https://e.test/a.pdf',
      abstract: 'Résumé suffisamment long pour être retenu.',
      citationCount: 42,
    });
    expect(mapItem({ DOI: '10.1/x' })).toBeNull();
  });
  it('requêtes : query.bibliographic, rows, filter, select, mailto ; DOI sans encoder les barres', async () => {
    const a = mkHttp(async () => json({ message: { items: [item] } }));
    await new CrossrefConnector(a.http).search({
      text: 'caution solidaire',
      yearFrom: 2010,
      yearTo: 2020,
      limit: 5,
    });
    const u = new URL(a.calls[0]!.url);
    expect(u.searchParams.get('query.bibliographic')).toBe('caution solidaire');
    expect(u.searchParams.get('rows')).toBe('5');
    expect(u.searchParams.get('filter')).toBe('from-pub-date:2010,until-pub-date:2020');
    expect(u.searchParams.get('mailto')).toBe('contact@exemple.org');
    const b = mkHttp(async () => json({ message: item }));
    expect((await new CrossrefConnector(b.http).fetchByDoi('10.5555/mf.2019.002'))!.doi).toBe(
      '10.5555/mf.2019.002',
    );
    expect(b.calls[0]!.url).toContain('/works/10.5555/mf.2019.002');
  });
});

describe('HAL', () => {
  const doc = {
    docid: 123,
    halId_s: 'tel-01234567',
    title_s: ['Épargne de proximité'],
    authFullName_s: ['Mamadou Diallo'],
    producedDateY_i: 2017,
    doiId_s: '10.5555/DIALLO',
    uri_s: 'https://hal.science/tel-01234567',
    abstract_s: ['Thèse sur la microfinance en Afrique de l’Ouest.'],
    docType_s: 'THESE',
    language_s: ['fr'],
    fileMain_s: 'https://hal.science/tel-01234567/document',
    journalTitle_s: undefined,
  };
  it('mappe un document (champs multi-valeurs, type THESE, ancrage africain par le texte)', () => {
    expect(mapDoc(doc)).toMatchObject({
      origin: 'hal',
      externalId: 'tel-01234567',
      type: 'these',
      title: 'Épargne de proximité',
      year: 2017,
      doi: '10.5555/diallo',
      oaPdfUrl: 'https://hal.science/tel-01234567/document',
      language: 'fr',
    });
    expect(mapDoc({ ...doc, docType_s: 'MEM' })!.type).toBe('memoire');
    expect(mapDoc({ ...doc, title_s: ['T'], abstract_s: [] })).not.toBeNull();
    expect(mapDoc({ docid: 1 })).toBeNull();
  });
  it('requête : q, wt=json, fl, fq (années, langue)', async () => {
    const { http, calls } = mkHttp(async () => json({ response: { numFound: 1, docs: [doc] } }));
    const r = await new HalConnector(http).search({
      text: 'microfinance Bénin',
      language: 'fr',
      yearFrom: 2010,
      yearTo: 2024,
      limit: 10,
    });
    expect(r).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('wt')).toBe('json');
    expect(u.searchParams.get('rows')).toBe('10');
    expect(u.searchParams.getAll('fq')).toEqual([
      'producedDateY_i:[2010 TO 2024]',
      'language_s:fr',
    ]);
    expect(u.searchParams.get('fl')).toContain('halId_s');
  });
});

describe('Semantic Scholar', () => {
  const paper = {
    paperId: 'abc',
    title: 'Mobile money',
    year: 2022,
    externalIds: { DOI: '10.5555/MM.2022.003' },
    abstract: 'Résumé en anglais suffisamment long.',
    authors: [{ name: 'Peter Johnson' }],
    openAccessPdf: { url: 'https://e.test/mm.pdf' },
    citationCount: 65,
    venue: 'JAF',
    publicationTypes: ['JournalArticle'],
  };
  it('mappe et envoie la clé dans x-api-key seulement si elle existe', async () => {
    const a = mkHttp(async () => json({ data: [paper] }));
    const r = await new SemanticScholarConnector(a.http, () => 'CLE').search({
      text: 'mobile money',
      yearFrom: 2020,
      limit: 3,
    });
    expect(r[0]).toMatchObject({
      origin: 'semantic_scholar',
      doi: '10.5555/mm.2022.003',
      oaPdfUrl: 'https://e.test/mm.pdf',
      peerReviewed: true,
      citationCount: 65,
    });
    expect((a.calls[0]!.init!.headers as Record<string, string>)['x-api-key']).toBe('CLE');
    expect(new URL(a.calls[0]!.url).searchParams.get('year')).toBe('2020-');
    const b = mkHttp(async () => json({ data: [] }));
    await new SemanticScholarConnector(b.http).search({ text: 'x y', limit: 1 });
    expect((b.calls[0]!.init!.headers as Record<string, string>)['x-api-key']).toBeUndefined();
  });
});

describe('Unpaywall', () => {
  const resp = {
    is_oa: true,
    best_oa_location: {
      url_for_pdf: 'https://e.test/best.pdf',
      url: 'https://e.test/best',
      version: 'publishedVersion',
      license: 'cc-by',
      host_type: 'publisher',
    },
    oa_locations: [
      {
        url_for_pdf: null,
        url: 'https://repo.test/x',
        version: 'submittedVersion',
        host_type: 'repository',
      },
      { url_for_pdf: 'https://e.test/best.pdf', url: 'https://e.test/best' },
    ],
  };
  it('classe les emplacements : PDF direct et version publiée d’abord, sans doublon', () => {
    const l = locationsOf(resp);
    expect(l.map((x) => x.pdfUrl ?? x.landingUrl)).toEqual([
      'https://e.test/best.pdf',
      'https://repo.test/x',
    ]);
    expect(l[0]).toMatchObject({ license: 'cc-by', version: 'publishedVersion' });
  });
  it('exige une adresse e-mail ; la transmet dans le paramètre `email` ; 404 → []', async () => {
    const a = mkHttp(async () => json(resp));
    expect(await new UnpaywallConnector(a.http).openAccess('10.5555/mm.2022.003')).toHaveLength(2);
    expect(new URL(a.calls[0]!.url).searchParams.get('email')).toBe('contact@exemple.org');
    expect(a.calls[0]!.url).toContain('/v2/10.5555/mm.2022.003');
    await expect(
      new UnpaywallConnector(mkHttp(async () => json(resp), '').http).openAccess('10.1/x'),
    ).rejects.toMatchObject({ code: 'E_KEY_MISSING' });
    expect(
      await new UnpaywallConnector(mkHttp(async () => json({}, 404)).http).openAccess('10.1/x'),
    ).toEqual([]);
  });
});

describe('arXiv', () => {
  // Extrait du manuel officiel de l'API (structure Atom 1.0).
  const atom = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
    <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">2</opensearch:totalResults>
    <entry><id>http://arxiv.org/abs/hep-ex/0307015v1</id><published>2003-07-07T13:46:39Z</published><title>Multi-Electron
     Production</title><summary>  Résumé  de l'article sur la production d'électrons, suffisamment long. </summary>
      <author><name>Alice Martin</name></author><author><name>Bob Durand</name></author>
      <arxiv:doi>10.1234/Abc</arxiv:doi><arxiv:journal_ref>Phys. Rev. D 1 (2003)</arxiv:journal_ref>
      <link title="pdf" href="http://arxiv.org/pdf/hep-ex/0307015v1" rel="related" type="application/pdf"/><link href="http://arxiv.org/abs/hep-ex/0307015v1" rel="alternate" type="text/html"/></entry>
    <entry><id>http://arxiv.org/api/errors#x</id><title>Error</title><summary>incorrect id format</summary></entry></feed>`;
  it('analyse le flux Atom ; ignore l’entrée « Error »', () => {
    const r = parseAtom(atom);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      origin: 'arxiv',
      externalId: 'hep-ex/0307015v1',
      title: 'Multi-Electron Production',
      authors: ['Alice Martin', 'Bob Durand'],
      year: 2003,
      doi: '10.1234/abc',
      journal: 'Phys. Rev. D 1 (2003)',
      oaPdfUrl: 'https://arxiv.org/pdf/hep-ex/0307015v1',
      language: 'en',
    });
    expect(r[0]!.abstract).toBe(
      "Résumé de l'article sur la production d'électrons, suffisamment long.",
    );
    expect(parseAtom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toEqual([]);
  });
  it('requête all:mot AND all:mot, filtre d’années côté client', async () => {
    const { http, calls } = mkHttp(async () => new Response(atom));
    const c = new ArxivConnector(http);
    expect(await c.search({ text: 'electron production', limit: 5, yearFrom: 2010 })).toEqual([]);
    expect(new URL(calls[0]!.url).searchParams.get('search_query')).toBe(
      'all:electron AND all:production',
    );
    expect(await c.search({ text: 'a', limit: 5 })).toEqual([]); // aucun terme exploitable : aucun appel
    expect(calls).toHaveLength(1);
  });
});

describe('Europe PMC, DOAJ, CORE, Open Library', () => {
  it('Europe PMC : résultat « core »', async () => {
    const res = {
      id: '123',
      source: 'MED',
      pmid: '123',
      doi: '10.5555/EP.1',
      title: 'Nutrition infantile.',
      authorList: { author: [{ fullName: 'Awa Traoré' }] },
      journalInfo: { volume: '5', issue: '2', journal: { title: 'Rev Santé' } },
      pubYear: '2020',
      abstractText: '<h4>Contexte</h4> Résumé suffisamment long pour être gardé.',
      citedByCount: 3,
      fullTextUrlList: {
        fullTextUrl: [
          { url: 'https://e.test/p.pdf', documentStyle: 'pdf', availability: 'Open access' },
          { url: 'https://e.test/h', documentStyle: 'html', availability: 'Subscription required' },
        ],
      },
    };
    expect(mapResult(res)).toMatchObject({
      origin: 'europepmc',
      title: 'Nutrition infantile',
      authors: ['Awa Traoré'],
      year: 2020,
      doi: '10.5555/ep.1',
      journal: 'Rev Santé',
      oaPdfUrl: 'https://e.test/p.pdf',
    });
  });
  it('Europe PMC : requête et filtre d’années', async () => {
    const { http, calls } = mkHttp(async () => json({ resultList: { result: [] } }));
    await new EuropePmcConnector(http).search({
      text: 'nutrition',
      yearFrom: 2015,
      yearTo: 2024,
      limit: 7,
    });
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('query')).toBe('nutrition AND (PUB_YEAR:[2015 TO 2024])');
    expect([
      u.searchParams.get('format'),
      u.searchParams.get('resultType'),
      u.searchParams.get('pageSize'),
    ]).toEqual(['json', 'core', '7']);
  });
  it('DOAJ : notice bibjson ; le terme est encodé dans le chemin', async () => {
    const hit = {
      id: 'd1',
      bibjson: {
        title: 'Gestion des PME',
        abstract: 'Résumé suffisamment long pour le test.',
        year: '2021',
        author: [{ name: 'Koffi A.' }],
        journal: {
          title: 'Rev. Gestion',
          volume: '3',
          number: '1',
          publisher: 'Éd.',
          language: ['FR'],
        },
        identifier: [{ type: 'doi', id: '10.5555/DOAJ.1' }],
        link: [{ type: 'fulltext', url: 'https://e.test/f.pdf', content_type: 'PDF' }],
      },
    };
    expect(mapHit(hit)).toMatchObject({
      origin: 'doaj',
      doi: '10.5555/doaj.1',
      year: 2021,
      language: 'fr',
      oaPdfUrl: 'https://e.test/f.pdf',
      peerReviewed: true,
    });
    const { http, calls } = mkHttp(async () => json({ results: [hit] }));
    await new DoajConnector(http).search({ text: 'PME béninoises', limit: 5 });
    expect(calls[0]!.url).toContain('/api/search/articles/PME%20b%C3%A9ninoises');
  });
  it('CORE : clé obligatoire, transmise en Bearer', async () => {
    const w = {
      id: 5,
      doi: '10.5555/core.1',
      title: 'Un texte',
      authors: [{ name: 'A. B.' }],
      abstract: 'Résumé suffisamment long pour le test.',
      yearPublished: 2018,
      downloadUrl: 'https://core.test/d.pdf',
      documentType: 'thesis',
    };
    await expect(
      new CoreConnector(mkHttp(async () => json({})).http, () => undefined).search({
        text: 'x',
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'E_KEY_MISSING' });
    const { http, calls } = mkHttp(async () => json({ results: [w] }));
    const r = await new CoreConnector(http, () => 'SECRET').search({ text: 'x', limit: 1 });
    expect(r[0]).toMatchObject({
      origin: 'core',
      type: 'these',
      oaPdfUrl: 'https://core.test/d.pdf',
    });
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer SECRET');
  });
  it('Open Library : ISBN valide → notice ; invalide → aucun appel', async () => {
    const { http, calls } = mkHttp(async () =>
      json({
        'ISBN:9780262026659': {
          title: 'Microfinance',
          authors: [{ name: 'A. Auteur' }],
          publishers: [{ name: 'MIT Press' }],
          publish_date: '2010',
          url: 'https://openlibrary.org/books/x',
        },
      }),
    );
    const ol = new OpenLibrary(http);
    expect(await ol.byIsbn('978-0-262-02665-9')).toMatchObject({
      title: 'Microfinance',
      authors: ['A. Auteur'],
      publishers: ['MIT Press'],
    });
    expect(new URL(calls[0]!.url).searchParams.get('bibkeys')).toBe('ISBN:9780262026659');
    expect(await ol.byIsbn('123')).toBeNull();
    expect(calls).toHaveLength(1);
    expect(
      await new OpenLibrary(mkHttp(async () => json({})).http).byIsbn('9780262026659'),
    ).toBeNull();
  });
});

const C = (o: Partial<CandidateSource>): CandidateSource => ({
  origin: 'a',
  type: 'article',
  title: 'T',
  authors: [],
  ...o,
});

describe('déduplication (§11.3)', () => {
  it('même DOI → fusion (casse du DOI normalisée), la notice la plus complète est gardée et complétée', () => {
    const out = dedupe([
      C({ origin: 'openalex', title: 'Titre A', doi: '10.1/x', year: 2020 }),
      C({
        origin: 'hal',
        title: 'Titre A (version longue)',
        doi: '10.1/x',
        year: 2020,
        journal: 'Revue',
        volume: '3',
        abstract: 'Un résumé détaillé qui dépasse largement le minimum requis.',
        authors: ['A', 'B'],
        citationCount: 7,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      journal: 'Revue',
      volume: '3',
      authors: ['A', 'B'],
      citationCount: 7,
    });
    expect(out[0]!.seenIn!.sort()).toEqual(['hal', 'openalex']);
  });
  it('sans DOI : titre normalisé + année identique ; années différentes → deux notices', () => {
    const out = dedupe([
      C({ title: 'Épargne rurale !', year: 2019 }),
      C({ origin: 'b', title: 'EPARGNE RURALE', year: 2019, url: 'https://x' }),
      C({ origin: 'c', title: 'Épargne rurale', year: 2020 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe('https://x');
  });
  it('un DOI sur une notice et pas sur l’autre : la fusion récupère le DOI et la clé DOI reste cohérente', () => {
    const out = dedupe([
      C({ title: 'Même titre', year: 2018 }),
      C({ origin: 'b', title: 'Même titre', year: 2018, doi: '10.9/z' }),
      C({ origin: 'c', title: 'Autre titre', year: 2018, doi: '10.9/z' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.doi).toBe('10.9/z');
  });
});

describe('score de qualité (§11.4) et fichier de pondérations', () => {
  const y = new Date().getFullYear();
  it('un article récent, cité, avec DOI et texte intégral bat un site web ancien sans identifiant', () => {
    const bon = qualityScore(
      C({
        doi: '10.1/a',
        year: y - 2,
        citationCount: 40,
        oaPdfUrl: 'https://p',
        peerReviewed: true,
      }),
    );
    const mauvais = qualityScore(C({ type: 'site_web', year: y - 30, url: 'https://x' }));
    expect(bon).toBeGreaterThan(0.8);
    expect(mauvais).toBeLessThan(0.3);
  });
  it('bonus Afrique seulement si activé ; bonus import utilisateur fort ; borné à 1', () => {
    const c = C({ doi: '10.1/a', year: y - 3, africa: true });
    expect(qualityScore(c, undefined, { prioriteAfrique: true })).toBeGreaterThan(qualityScore(c));
    expect(qualityScore(C({ type: 'memoire' }), undefined, { userUpload: true })).toBeGreaterThan(
      qualityScore(C({ type: 'memoire' })) + 0.25,
    );
    expect(
      qualityScore(
        C({
          doi: '10.1/a',
          year: y,
          citationCount: 1e6,
          oaPdfUrl: 'x',
          peerReviewed: true,
          africa: true,
        }),
        undefined,
        { prioriteAfrique: true, userUpload: true },
      ),
    ).toBe(1);
  });
  it('la récence décroît avec l’âge', () => {
    const q = (age: number) => qualityScore(C({ year: y - age }));
    expect(q(2)).toBeGreaterThan(q(15));
    expect(q(15)).toBeGreaterThan(q(39));
  });
  it('le fichier resources/quality-weights.json est valide (poids de base = 1) et pondère pertinence 0,6 / qualité 0,4', () => {
    const w = loadQualityWeights(join(__dirname, '../../../resources/quality-weights.json'));
    expect(Object.values(w.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(w).toMatchObject(DEFAULT_QUALITY_WEIGHTS);
    expect(combinedScore(1, 0, w)).toBeCloseTo(0.6);
    expect(combinedScore(0, 1, w)).toBeCloseTo(0.4);
    expect(loadQualityWeights('/inexistant.json')).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });
});

describe('CSL-JSON', () => {
  it('convertit une notice (auteurs « Nom, Prénom » et « Prénom Nom »)', () => {
    const csl = toCsl(
      C({
        type: 'chapitre',
        title: 'Titre',
        authors: ['Sow, Aminata', 'Koffi Adjovi', 'ONU'],
        year: 2019,
        journal: 'Rev',
        doi: '10.1/a',
      }),
      's1',
    );
    expect(csl).toMatchObject({
      id: 's1',
      type: 'chapter',
      'container-title': 'Rev',
      DOI: '10.1/a',
      issued: { 'date-parts': [[2019]] },
    });
    expect(csl.author).toEqual([
      { family: 'Sow', given: 'Aminata' },
      { family: 'Adjovi', given: 'Koffi' },
      { literal: 'ONU' },
    ]);
  });
});

describe('registre et recherche multi-connecteurs', () => {
  it('activations par défaut, clé CORE requise, extras par discipline', () => {
    const { http } = mkHttp(async () => json({}));
    let keys: Record<string, string | undefined> = {};
    const cfg = { enabled: { core: true } as Record<string, boolean> };
    const reg = new SourceRegistry(
      http,
      () => cfg,
      (id) => keys[id],
    );
    expect(reg.enabled().map((c) => c.id)).toEqual([
      'openalex',
      'crossref',
      'hal',
      'semantic_scholar',
      'unpaywall',
      'doaj',
    ]);
    keys = { core: 'k' };
    expect(reg.enabled().map((c) => c.id)).toContain('core');
    expect(reg.enabled(['arxiv']).map((c) => c.id)).toContain('arxiv');
    expect(extraConnectorsForDiscipline('Santé publique')).toEqual(['europepmc']);
    expect(extraConnectorsForDiscipline('Économie')).toEqual(['arxiv']);
    expect(extraConnectorsForDiscipline('Droit')).toEqual([]);
  });
  it('un connecteur en panne est ignoré avec un avertissement, les autres continuent', async () => {
    const [a, b, c] = mockConnectors();
    b!.failWith = new Error('panne');
    const warnings: string[] = [];
    const r = await searchAll(
      [a!, b!, c!],
      [{ text: 'microfinance' }, { text: 'inclusion financière' }],
      { limit: 20 },
      (id) => warnings.push(id),
    );
    expect(r.length).toBeGreaterThan(0);
    expect(warnings).toEqual([b!.id]);
    expect(b!.calls).toBe(1); // abandonné après la première panne
  });
  it('test() : état de chaque connecteur (désactivé, ok, erreur en français)', async () => {
    const { http } = mkHttp(async (u) =>
      u.includes('openalex') ? json({ results: [] }) : json({}, 500),
    );
    const reg = new SourceRegistry(
      http,
      () => ({
        enabled: {
          crossref: false,
          hal: false,
          semantic_scholar: false,
          unpaywall: false,
          doaj: false,
        },
      }),
      () => undefined,
    );
    const st = await reg.test();
    expect(st.find((s) => s.id === 'openalex')).toMatchObject({ enabled: true, ok: true });
    expect(st.find((s) => s.id === 'crossref')).toMatchObject({
      enabled: false,
      ok: null,
      message: 'Désactivé',
    });
    expect(st.find((s) => s.id === 'core')).toMatchObject({
      ok: null,
      message: 'Clé d’API requise',
    });
  }, 30000);
  it('corpus simulé : DOI fictifs, un DOI inexistant, filtrage par années', async () => {
    expect(MOCK_CORPUS.filter((c) => c.doi).every((c) => c.doi!.startsWith('10.5555/'))).toBe(true);
    const m = new MockSourceConnector('openalex', 'OA');
    const r = await m.search({ text: 'microfinance Bénin', limit: 20, yearFrom: 2020 });
    expect(r.every((c) => (c.year ?? 0) >= 2020)).toBe(true);
    expect(await m.fetchByDoi('10.5555/inexistant')).toBeNull(); // la source « fantôme » est inconnue des bases de référence
    expect(await m.fetchByDoi('10.5555/mf.2021.001')).not.toBeNull();
    expect(await m.fetchByDoi('10.9999/absent')).toBeNull();
  });
});
