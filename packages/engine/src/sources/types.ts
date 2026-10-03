/** Types communs des connecteurs de sources (CdC §11.1). */
export type SourceType =
  | 'article'
  | 'ouvrage'
  | 'chapitre'
  | 'these'
  | 'memoire'
  | 'rapport'
  | 'texte_officiel'
  | 'site_web'
  | 'donnees';

export type CandidateSource = {
  /** Connecteur d'origine (`openalex`, `hal`…) — colonne `sources.origin`. */
  origin: string;
  externalId?: string;
  type: SourceType;
  title: string;
  authors: string[];
  year?: number;
  publisher?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  /** DOI normalisé : minuscules, sans préfixe d'URL. */
  doi?: string;
  isbn?: string;
  url?: string;
  oaPdfUrl?: string;
  language?: string;
  abstract?: string;
  citationCount?: number;
  /** Revue à comité de lecture connue / indice de qualité éditoriale (quand le connecteur le sait). */
  peerReviewed?: boolean;
  /** Indices d'ancrage africain : pays d'affiliation, mots du titre / résumé… */
  africa?: boolean;
  /** Tous les connecteurs qui ont renvoyé cette notice (après fusion). */
  seenIn?: string[];
};

export type SearchQuery = {
  text: string;
  language?: 'fr' | 'en';
  yearFrom?: number;
  yearTo?: number;
  limit: number;
};

export type OaLocation = {
  pdfUrl?: string;
  landingUrl?: string;
  license?: string;
  version?: string;
  hostType?: string;
};

export interface SourceConnector {
  readonly id: string;
  readonly label: string;
  /** Débit maximal toléré (requêtes par seconde). */
  readonly requestsPerSecond: number;
  search(q: SearchQuery): Promise<CandidateSource[]>;
  fetchByDoi?(doi: string): Promise<CandidateSource | null>;
  /** Localisations en accès ouvert d'un DOI (Unpaywall, OpenAlex…). */
  openAccess?(doi: string): Promise<OaLocation[]>;
}

export type { ConnectorStatus } from '@emilio/shared';
