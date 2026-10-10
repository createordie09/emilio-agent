import { AppError } from '@emilio/shared';
import { ArxivConnector } from './arxiv';
import { CoreConnector } from './core';
import { CrossrefConnector } from './crossref';
import { DoajConnector } from './doaj';
import { EuropePmcConnector } from './europepmc';
import { HalConnector } from './hal';
import type { SourceHttp } from './http';
import { OpenAlexConnector } from './openalex';
import { OpenLibrary } from './openlibrary';
import { SemanticScholarConnector } from './semantic-scholar';
import type { ConnectorStatus, SourceConnector } from './types';
import { UnpaywallConnector } from './unpaywall';

export type SourcesConfig = {
  /** Adresse de contact transmise aux API (« polite pool » OpenAlex / Crossref ; obligatoire pour Unpaywall). */
  contactEmail?: string;
  /** Activation par connecteur ; absent = valeur par défaut. */
  enabled?: Record<string, boolean>;
};

/** Connecteurs activés par défaut (§11.2). Europe PMC et arXiv sont ciblés selon la discipline ; CORE exige une clé. */
export const DEFAULT_ENABLED: Record<string, boolean> = {
  openalex: true,
  crossref: true,
  hal: true,
  semantic_scholar: true,
  unpaywall: true,
  doaj: true,
  arxiv: false,
  europepmc: false,
  core: false,
};

export const CONNECTOR_LABELS: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  hal: 'HAL',
  semantic_scholar: 'Semantic Scholar',
  unpaywall: 'Unpaywall',
  doaj: 'DOAJ',
  arxiv: 'arXiv',
  europepmc: 'Europe PMC',
  core: 'CORE',
};

/** Connecteurs à ajouter selon la discipline du travail (§11.2 : santé → Europe PMC, sciences exactes → arXiv). */
export function extraConnectorsForDiscipline(discipline: string | undefined): string[] {
  const d = (discipline ?? '').toLowerCase();
  const out: string[] = [];
  if (/sant[ée]|m[ée]decine|pharma|infirm|épid[ée]mio|nutrition/.test(d)) out.push('europepmc');
  if (
    /informatique|math|physique|statistique|[ée]conom|ing[ée]nieur|donn[ée]es|intelligence/.test(d)
  )
    out.push('arxiv');
  return out;
}

export class SourceRegistry {
  private cache: SourceConnector[] | null = null;
  readonly books: OpenLibrary;
  constructor(
    private readonly http: SourceHttp,
    private readonly config: () => SourcesConfig,
    private readonly key: (connectorId: string) => string | undefined,
  ) {
    this.books = new OpenLibrary(http);
  }

  /** Tous les connecteurs connus (activés ou non). */
  all(): SourceConnector[] {
    this.cache ??= [
      new OpenAlexConnector(this.http),
      new CrossrefConnector(this.http),
      new HalConnector(this.http),
      new SemanticScholarConnector(this.http, () => this.key('semantic_scholar')),
      new UnpaywallConnector(this.http),
      new DoajConnector(this.http),
      new ArxivConnector(this.http),
      new EuropePmcConnector(this.http),
      new CoreConnector(this.http, () => this.key('core')),
    ];
    return this.cache;
  }

  isEnabled(id: string): boolean {
    const v = this.config().enabled?.[id] ?? DEFAULT_ENABLED[id] ?? false;
    // Un connecteur à clé obligatoire n'est utilisable que si la clé est présente.
    return v && (id !== 'core' || !!this.key('core'));
  }

  enabled(extra: string[] = []): SourceConnector[] {
    return this.all().filter((c) => this.isEnabled(c.id) || extra.includes(c.id));
  }

  get(id: string): SourceConnector | undefined {
    return this.all().find((c) => c.id === id);
  }

  /** Test de connexion de chaque connecteur (bouton « Tester les sources » des Paramètres). */
  async test(): Promise<ConnectorStatus[]> {
    // Test rapide : pas de réessai (une panne doit se voir tout de suite) et un délai court.
    const quick = new SourceRegistry(
      this.http.withConfig({ maxRetries: 0, timeoutMs: 8000, cacheTtlMs: 0 }),
      this.config,
      this.key,
    );
    return quick.runTests();
  }

  private async runTests(): Promise<ConnectorStatus[]> {
    const out: ConnectorStatus[] = [];
    for (const c of this.all()) {
      const enabled = this.isEnabled(c.id);
      const base = { id: c.id, label: c.label, enabled };
      if (!enabled) {
        out.push({
          ...base,
          ok: null,
          message: c.id === 'core' && !this.key('core') ? 'Clé d’API requise' : 'Désactivé',
          latencyMs: null,
        });
        continue;
      }
      const t0 = Date.now();
      try {
        if (c.id === 'unpaywall') await c.openAccess!('10.1038/nature12373');
        else await c.search({ text: 'microfinance', limit: 1 });
        out.push({ ...base, ok: true, message: null, latencyMs: Date.now() - t0 });
      } catch (e) {
        const msg =
          e instanceof AppError
            ? e.detail
              ? `${e.messageFr} (${e.detail})`
              : e.messageFr
            : (e as Error).message;
        out.push({ ...base, ok: false, message: msg, latencyMs: Date.now() - t0 });
      }
    }
    return out;
  }
}

/**
 * Interroge plusieurs connecteurs en parallèle. Un connecteur en panne NE bloque PAS la recherche : il est ignoré et un
 * avertissement est remonté (CdC §11.1).
 */
export async function searchAll(
  connectors: SourceConnector[],
  queries: { text: string; language?: 'fr' | 'en' }[],
  opts: { limit: number; yearFrom?: number; yearTo?: number },
  onWarning: (connectorId: string, e: unknown) => void,
): Promise<import('./types').CandidateSource[]> {
  const failed = new Set<string>();
  const results = await Promise.all(
    connectors.map(async (c) => {
      const out: import('./types').CandidateSource[] = [];
      for (const q of queries) {
        if (failed.has(c.id)) break;
        try {
          out.push(
            ...(await c.search({
              text: q.text,
              language: q.language,
              limit: opts.limit,
              yearFrom: opts.yearFrom,
              yearTo: opts.yearTo,
            })),
          );
        } catch (e) {
          failed.add(c.id);
          onWarning(c.id, e);
        }
      }
      return out;
    }),
  );
  return results.flat();
}
