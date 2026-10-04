import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import CSL from 'citeproc';
import { AppError } from '@emilio/shared';
import { toCsl } from '../sources/csl';
import type { CandidateSource, SourceType } from '../sources/types';
import { cslHtmlToRuns } from './inline';
import type { Para } from './model';
import type { BibGroup, CitationMode } from './config';

export type SourceRow = {
  id: string;
  type: string;
  title: string;
  authors_json: string | null;
  year: number | null;
  publisher: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  isbn: string | null;
  url: string | null;
  language: string | null;
};

/** Notice CSL-JSON reconstruite depuis les colonnes de `sources` (le CSL-JSON stocké n'est pas la seule vérité). */
export function rowToCsl(r: SourceRow): Record<string, unknown> {
  const c = {
    type: r.type as SourceType,
    title: r.title,
    authors: JSON.parse(r.authors_json ?? '[]') as string[],
    year: r.year ?? undefined,
    publisher: r.publisher ?? undefined,
    journal: r.journal ?? undefined,
    volume: r.volume ?? undefined,
    issue: r.issue ?? undefined,
    pages: r.pages ?? undefined,
    doi: r.doi ?? undefined,
    isbn: r.isbn ?? undefined,
    url: r.url ?? undefined,
    language: r.language ?? undefined,
  } as unknown as CandidateSource;
  return toCsl(c, r.id);
}

export type BibEntry = { id: string; runs: Para; type: string };

/**
 * Bibliographe (CdC §9 P8) : moteur CSL (citeproc-js) + fichier de style du profil de normes + paramètres régionaux français.
 * Les citations sont traitées dans l'ordre du document ; le texte final d'une citation n'est connu qu'une fois toutes traitées
 * (désambiguïsation des années, « ibid. », renvois courts).
 */
export class Bibliographer {
  private engine: InstanceType<typeof CSL.Engine>;
  private pre: [string, number][] = [];
  private texts = new Map<string, string>();
  private note = 0;
  private n = 0;
  private readonly cited = new Set<string>();

  constructor(
    resourcesDir: string,
    styleFile: string,
    localeFile: string,
    private readonly mode: CitationMode,
    private readonly items: Map<string, Record<string, unknown>>,
  ) {
    let style: string;
    let locale: string;
    try {
      style = readFileSync(join(resourcesDir, 'csl', styleFile), 'utf8');
      locale = readFileSync(join(resourcesDir, 'csl', localeFile), 'utf8');
    } catch {
      throw new AppError(
        'E_ENGINE',
        'Le fichier de style bibliographique est introuvable : réinstallez l’application.',
      );
    }
    this.engine = new CSL.Engine(
      { retrieveLocale: () => locale, retrieveItem: (id) => this.items.get(id) },
      style,
      'fr-FR',
      true,
    );
  }

  /** Enregistre une citation (dans l'ordre du document) ; renvoie son identifiant et, en mode notes, le numéro de la note. */
  cite(items: { id: string; locator?: string }[]): { clusterId: string; note: number | null } {
    const clusterId = `c${++this.n}`;
    const noteIndex = this.mode === 'notes' ? ++this.note : 0;
    for (const i of items) this.cited.add(i.id);
    const [, changed] = this.engine.processCitationCluster(
      {
        citationID: clusterId,
        citationItems: items.map((i) => ({
          id: i.id,
          ...(i.locator ? { locator: i.locator, label: 'page' } : {}),
        })),
        properties: { noteIndex },
      },
      this.pre.slice(),
      [],
    );
    this.pre.push([clusterId, noteIndex]);
    for (const [, text, id] of changed) this.texts.set(id, text);
    return { clusterId, note: this.mode === 'notes' ? noteIndex : null };
  }

  /** Texte final d'une citation (après désambiguïsation éventuelle). */
  runsOf(clusterId: string): Para {
    return cslHtmlToRuns(this.texts.get(clusterId) ?? '');
  }

  get citedIds(): string[] {
    return [...this.cited];
  }

  /** Entrées de la bibliographie, dans l'ordre du style, uniquement pour les sources citées. */
  entries(): BibEntry[] {
    const bib = this.engine.makeBibliography();
    if (!bib) return [];
    return bib[0].entry_ids.map((ids, i) => {
      const id = ids[0]!;
      const html = bib[1][i]!.replace(/<\/div>\s*<div/g, '</div> <div');
      return {
        id,
        runs: cslHtmlToRuns(html),
        type: String((this.items.get(id) as { 'x-type'?: string } | undefined)?.['x-type'] ?? ''),
      };
    });
  }
}

/** Regroupe les entrées par type de source selon le profil (ouvrages, articles, mémoires et thèses, rapports, textes officiels, webographie). */
export function groupEntries(
  entries: BibEntry[],
  groups: BibGroup[],
  typeOf: (id: string) => string,
): { label: string; entries: Para[] }[] {
  const out: { label: string; entries: Para[] }[] = [];
  for (const g of groups) {
    const es = entries.filter((e) => g.types.includes(typeOf(e.id)));
    if (es.length) out.push({ label: g.label, entries: es.map((e) => e.runs) });
  }
  const known = new Set(groups.flatMap((g) => g.types));
  const rest = entries.filter((e) => !known.has(typeOf(e.id)));
  if (rest.length) out.push({ label: 'Autres sources', entries: rest.map((e) => e.runs) });
  return out;
}
