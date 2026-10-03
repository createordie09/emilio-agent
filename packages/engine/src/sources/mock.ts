import { normalizeDoi, normalizeTitle } from './normalize';
import type { CandidateSource, OaLocation, SearchQuery, SourceConnector } from './types';

/**
 * Corpus de démonstration (mode simulé, CdC §21.2) — sujets : microfinance et inclusion financière.
 * Références **fictives** : aucune ne doit être prise pour une vraie publication. Les DOI utilisent le préfixe
 * réservé aux tests (10.5555) ; `10.5555/inexistant` n'existe volontairement dans aucune base (cas « rejetée »).
 */
export const MOCK_CORPUS: CandidateSource[] = [
  {
    origin: 'mock',
    type: 'article',
    title: 'Microfinance et inclusion financière des ménages ruraux au Bénin',
    authors: ['Adjovi, Koffi', 'Houngbo, Marie'],
    year: 2021,
    journal: 'Revue d’économie du développement (fictive)',
    doi: '10.5555/mf.2021.001',
    abstract:
      'Cette étude analyse le rôle de la microfinance dans l’inclusion financière des ménages ruraux du Bénin à partir d’une enquête auprès de 400 ménages.',
    language: 'fr',
    citationCount: 18,
    peerReviewed: true,
    africa: true,
    oaPdfUrl: 'https://exemple.test/mf-2021-001.pdf',
  },
  {
    origin: 'mock',
    type: 'article',
    title: 'Groupes de caution solidaire et taux de remboursement',
    authors: ['Sow, Aminata'],
    year: 2019,
    journal: 'Cahiers de la microfinance (fictive)',
    doi: '10.5555/mf.2019.002',
    abstract:
      'Les groupes de caution solidaire réduisent l’asymétrie d’information et améliorent le taux de remboursement des crédits de petite taille.',
    language: 'fr',
    citationCount: 42,
    peerReviewed: true,
    africa: true,
  },
  {
    origin: 'mock',
    type: 'these',
    title: 'Épargne de proximité et développement local en Afrique de l’Ouest',
    authors: ['Diallo, Mamadou'],
    year: 2017,
    doi: undefined,
    url: 'https://exemple.test/theses/diallo-2017',
    abstract:
      'Thèse consacrée aux institutions de microfinance et à la collecte de l’épargne dans les zones rurales d’Afrique de l’Ouest.',
    language: 'fr',
    africa: true,
    oaPdfUrl: 'https://exemple.test/diallo-2017.pdf',
  },
  {
    origin: 'mock',
    type: 'ouvrage',
    title: 'Économie de la microfinance',
    authors: ['Morvant-Roux, Solène'],
    year: 2015,
    publisher: 'Éditions fictives',
    isbn: '9780262026659',
    abstract: 'Panorama des approches théoriques de la microfinance.',
    language: 'fr',
  },
  {
    origin: 'mock',
    type: 'article',
    title: 'Mobile money and financial inclusion in sub-Saharan Africa',
    authors: ['Johnson, Peter', 'Okafor, Chidi'],
    year: 2022,
    journal: 'Journal of African Finance (fictive)',
    doi: '10.5555/mm.2022.003',
    abstract:
      'We study the diffusion of mobile money and its effects on financial inclusion across sub-Saharan Africa.',
    language: 'en',
    citationCount: 65,
    peerReviewed: true,
    africa: true,
  },
  {
    origin: 'mock',
    type: 'rapport',
    title: 'Rapport annuel de l’UEMOA sur les systèmes financiers décentralisés',
    authors: ['UEMOA'],
    year: 2020,
    url: 'https://exemple.test/uemoa-2020',
    abstract: 'Bilan de l’activité des systèmes financiers décentralisés dans l’UEMOA.',
    language: 'fr',
    africa: true,
  },
  {
    origin: 'mock',
    type: 'article',
    title: 'Éducation financière et surendettement des jeunes entrepreneurs',
    authors: ['Tchoumi, Éric'],
    year: 2023,
    journal: 'Revue africaine de gestion (fictive)',
    doi: '10.5555/ef.2023.004',
    abstract:
      'L’éducation financière contribue à réduire le surendettement des jeunes entrepreneurs camerounais.',
    language: 'fr',
    citationCount: 4,
    peerReviewed: true,
    africa: true,
  },
  {
    origin: 'mock',
    type: 'article',
    title: 'Une revue sans rapport sur la taxonomie des champignons',
    authors: ['Martin, Paul'],
    year: 2018,
    journal: 'Mycologie (fictive)',
    doi: '10.5555/myc.2018.005',
    abstract: 'Classification des champignons.',
    language: 'fr',
  },
  // Source « inventée » : son DOI n'existe dans aucune base → doit être rejetée par la vérification.
  {
    origin: 'mock',
    type: 'article',
    title: 'Étude fantôme sur la microfinance au Bénin',
    authors: ['Inconnu, Auteur'],
    year: 2020,
    journal: 'Revue fantôme',
    doi: '10.5555/inexistant',
    abstract: 'Cette référence n’existe pas.',
    language: 'fr',
  },
];

/** Notices « de référence » renvoyées par la vérification : deux DOI renvoient à un autre document (cas ambigu / divergent). */
const DOI_ALIASES: Record<string, string> = {};

const matches = (c: CandidateSource, q: SearchQuery): boolean => {
  const words = normalizeTitle(q.text)
    .split(' ')
    .filter((w) => w.length > 3);
  if (!words.length) return false;
  const hay = normalizeTitle(`${c.title} ${c.abstract ?? ''}`);
  return words.some((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2))));
};

/** Connecteur simulé : renvoie des sous-ensembles du corpus fictif selon son identifiant (pour exercer la fusion). */
export class MockSourceConnector implements SourceConnector {
  calls = 0;
  failWith: Error | null = null;
  readonly requestsPerSecond = 1000;
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly pick: (c: CandidateSource, i: number) => boolean = () => true,
    private readonly corpus: CandidateSource[] = MOCK_CORPUS,
    /** DOI que les bases de référence ne connaissent pas (la vérification doit les rejeter). */
    private readonly unknownDois: string[] = ['10.5555/inexistant'],
    /** Renvoie les notices sélectionnées quelle que soit la requête (simule un connecteur au bruit élevé). */
    private readonly alwaysMatch = false,
  ) {}

  async search(q: SearchQuery): Promise<CandidateSource[]> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return this.corpus
      .filter(
        (c, i) =>
          this.pick(c, i) &&
          (this.alwaysMatch || matches(c, q)) &&
          (!q.yearFrom || (c.year ?? 0) >= q.yearFrom) &&
          (!q.yearTo || (c.year ?? 9999) <= q.yearTo),
      )
      .slice(0, q.limit)
      .map((c) => ({ ...c, origin: this.id }));
  }

  async fetchByDoi(doi: string): Promise<CandidateSource | null> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    const d = normalizeDoi(DOI_ALIASES[doi] ?? doi);
    if (d && this.unknownDois.includes(d)) return null;
    const c = this.corpus.find((x) => x.doi === d);
    return c ? { ...c, origin: this.id } : null;
  }

  async openAccess(doi: string): Promise<OaLocation[]> {
    const c = this.corpus.find((x) => x.doi === normalizeDoi(doi));
    return c?.oaPdfUrl ? [{ pdfUrl: c.oaPdfUrl, version: 'publishedVersion' }] : [];
  }
}

/** Jeu de connecteurs simulés, chacun voyant une partie différente du corpus (les doublons exercent la fusion). */
export function mockConnectors(): MockSourceConnector[] {
  return [
    new MockSourceConnector('openalex', 'OpenAlex (simulé)', () => true),
    new MockSourceConnector('crossref', 'Crossref (simulé)', (c) => !!c.doi),
    new MockSourceConnector('hal', 'HAL (simulé)', (c) => c.language === 'fr'),
    new MockSourceConnector(
      'semantic_scholar',
      'Semantic Scholar (simulé)',
      (c) => c.type === 'article',
    ),
    new MockSourceConnector('unpaywall', 'Unpaywall (simulé)', (c) => !!c.oaPdfUrl),
  ];
}
