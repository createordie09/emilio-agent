import { AppError } from '@emilio/shared';
import type { CandidateSource, SourceConnector } from '../sources/types';
import type { SourceHttp } from '../sources/http';
import {
  authorSurname,
  normalizeIsbn,
  normalizeTitle,
  titleSimilarity,
} from '../sources/normalize';

export type VerificationStatus = 'verified' | 'partially_verified' | 'rejected';
export type VerificationMethod =
  'doi_crossref' | 'doi_openalex' | 'isbn_openlibrary' | 'url' | 'user_upload' | 'none';

export type VerificationResult = {
  status: VerificationStatus;
  method: VerificationMethod;
  /** Raison lisible (en français) — surtout utile quand la source est rejetée. */
  reasonFr: string | null;
  /** Preuves conservées dans `sources.verification_json` (CdC §12.1). */
  evidence: Record<string, unknown>;
};

export type Arbiter = (
  announced: CandidateSource,
  found: CandidateSource,
  base: string,
) => Promise<{ same: boolean; justification: string }>;

export type VerifyDeps = {
  /** Bases de vérification des DOI, dans l'ordre d'essai (Crossref puis OpenAlex). */
  doiSources: { id: 'crossref' | 'openalex'; connector: Pick<SourceConnector, 'fetchByDoi'> }[];
  books?: {
    byIsbn(isbn: string): Promise<{
      title: string;
      authors: string[];
      publishers: string[];
      publishDate?: string;
    } | null>;
  };
  http?: Pick<SourceHttp, 'getText'>;
  arbitrate?: Arbiter;
  /** `verification.exigerDoiOuIsbnOuUrl` (§7.6, défaut vrai). */
  requireIdentifier?: boolean;
  now?: () => string;
};

/** Seuils du §12.1 : titre ≥ 0,85, année ± 1, premier auteur ; en dessous de 0,6 le DOI désigne un autre document. */
export const TITLE_MATCH = 0.85;
export const TITLE_DIVERGENT = 0.6;

/** Compare une notice annoncée à la notice de référence retrouvée. */
export function compareRecords(a: CandidateSource, ref: CandidateSource) {
  const titleScore = titleSimilarity(a.title, ref.title);
  const yearDelta =
    a.year !== undefined && ref.year !== undefined ? Math.abs(a.year - ref.year) : null;
  const sa = a.authors.map(authorSurname).filter(Boolean);
  const sr = ref.authors.map(authorSurname).filter(Boolean);
  // Premier auteur : on tolère un ordre différent entre bases en cherchant son nom parmi ceux de la notice de référence.
  const authorMatch = !sa.length || !sr.length ? null : sr.includes(sa[0]!);
  return {
    titleScore: Math.round(titleScore * 1000) / 1000,
    yearDelta,
    yearOk: yearDelta === null || yearDelta <= 1,
    authorMatch,
    authorOk: authorMatch !== false,
  };
}

const iso = (d: VerifyDeps) => (d.now ?? (() => new Date().toISOString()))();

/**
 * Vérification d'une source (CdC §12.1) — code d'abord, LLM seulement pour arbitrer les cas ambigus :
 * 1. DOI → Crossref (puis OpenAlex) : titre ≥ 0,85, année ± 1, premier auteur → `verified` ;
 * 2. ISBN → Open Library → `partially_verified` (l'existence du livre est établie, pas celle des passages) ;
 * 3. URL seule → la page répond et contient les mots du titre → `partially_verified` ;
 * 4. import utilisateur → `verified` par définition ;
 * 5. correspondance ambiguë → arbitrage LLM (`partially_verified` si même document) ; sans arbitre → rejet ;
 * 6. échec → `rejected` avec la raison (jamais citée).
 * Lève `E_NETWORK` si aucune base n'a pu répondre : l'état « non vérifié » est alors conservé (pas de rejet à tort).
 */
export async function verifySource(
  c: CandidateSource,
  deps: VerifyDeps,
): Promise<VerificationResult> {
  const checkedAt = iso(deps);
  const done = (
    status: VerificationStatus,
    method: VerificationMethod,
    reasonFr: string | null,
    evidence: Record<string, unknown> = {},
  ): VerificationResult => ({
    status,
    method,
    reasonFr,
    evidence: {
      method,
      checkedAt,
      announced: { title: c.title, year: c.year, doi: c.doi, isbn: c.isbn, url: c.url },
      ...evidence,
    },
  });

  if (c.origin === 'user_upload')
    return done('verified', 'user_upload', null, {
      note: 'Document importé par l’utilisateur : il existe par définition (CdC §12.1.4).',
    });

  if (c.doi) {
    const errors: string[] = [];
    let ref: CandidateSource | null = null;
    let from: 'crossref' | 'openalex' | null = null;
    let answered = 0;
    for (const s of deps.doiSources) {
      try {
        const r = await s.connector.fetchByDoi!(c.doi);
        answered++;
        if (r) {
          ref = r;
          from = s.id;
          break;
        }
      } catch (e) {
        errors.push(`${s.id} : ${e instanceof AppError ? e.messageFr : (e as Error).message}`);
      }
    }
    if (answered === 0)
      throw new AppError(
        'E_NETWORK',
        `vérification du DOI ${c.doi} impossible : ${errors.join(' ; ')}`,
      );
    const method: VerificationMethod = from === 'crossref' ? 'doi_crossref' : 'doi_openalex';
    if (!ref)
      return done(
        'rejected',
        'doi_crossref',
        `DOI introuvable (${c.doi}) dans Crossref et OpenAlex`,
        { errors },
      );
    const cmp = compareRecords(c, ref);
    const found = {
      title: ref.title,
      year: ref.year,
      authors: ref.authors.slice(0, 5),
      doi: ref.doi,
      source: from,
    };
    if (cmp.titleScore >= TITLE_MATCH && cmp.yearOk && cmp.authorOk)
      return done('verified', method, null, { found, scores: cmp });
    if (cmp.titleScore < TITLE_DIVERGENT)
      return done(
        'rejected',
        method,
        `Le DOI ${c.doi} renvoie à un autre document (« ${ref.title} »)`,
        { found, scores: cmp },
      );
    return arbitrateOrReject(c, ref, from!, method, cmp, found, deps, done);
  }

  if (c.isbn) {
    const n = normalizeIsbn(c.isbn);
    if (!n) return done('rejected', 'isbn_openlibrary', `ISBN invalide (${c.isbn})`);
    if (!deps.books)
      return done('rejected', 'isbn_openlibrary', 'Vérification des ISBN indisponible');
    const b = await deps.books.byIsbn(n);
    if (!b) return done('rejected', 'isbn_openlibrary', `ISBN ${n} introuvable dans Open Library`);
    const ref: CandidateSource = {
      origin: 'openlibrary',
      type: 'ouvrage',
      title: b.title,
      authors: b.authors,
    };
    const cmp = compareRecords(c, ref);
    const found = {
      title: b.title,
      authors: b.authors,
      publishers: b.publishers,
      publishDate: b.publishDate,
    };
    if (cmp.titleScore >= TITLE_MATCH && cmp.authorOk)
      return done('partially_verified', 'isbn_openlibrary', null, { found, scores: cmp });
    if (cmp.titleScore < TITLE_DIVERGENT)
      return done(
        'rejected',
        'isbn_openlibrary',
        `L'ISBN ${n} renvoie à un autre livre (« ${b.title} »)`,
        { found, scores: cmp },
      );
    return arbitrateOrReject(c, ref, 'Open Library', 'isbn_openlibrary', cmp, found, deps, done);
  }

  if (c.url) {
    if (!deps.http) return done('rejected', 'url', 'Vérification des pages web indisponible');
    let page: string | null = null;
    try {
      page = await deps.http.getText('web', 1, c.url, { ttlMs: 0, notFoundIsNull: true });
    } catch (e) {
      return done(
        'rejected',
        'url',
        `Page inaccessible (${e instanceof AppError ? (e.detail ?? e.messageFr) : (e as Error).message})`,
      );
    }
    if (page === null) return done('rejected', 'url', 'Page introuvable (404)');
    const words = normalizeTitle(c.title)
      .split(' ')
      .filter((w) => w.length > 3);
    const hay = normalizeTitle(page.slice(0, 400_000));
    const found = words.filter((w) => hay.includes(w)).length;
    const share = words.length ? found / words.length : 0;
    if (share >= 0.7)
      return done('partially_verified', 'url', null, {
        titleWordsFound: found,
        titleWords: words.length,
      });
    return done('rejected', 'url', 'La page répond mais ne contient pas le titre annoncé', {
      titleWordsFound: found,
      titleWords: words.length,
    });
  }

  return deps.requireIdentifier === false
    ? done('partially_verified', 'none', null, {
        note: 'Aucun identifiant : exigence désactivée par l’utilisateur.',
      })
    : done('rejected', 'none', 'Aucun DOI, ISBN ni URL : source invérifiable');
}

async function arbitrateOrReject(
  c: CandidateSource,
  ref: CandidateSource,
  base: string,
  method: VerificationMethod,
  cmp: ReturnType<typeof compareRecords>,
  found: Record<string, unknown>,
  deps: VerifyDeps,
  done: (
    s: VerificationStatus,
    m: VerificationMethod,
    r: string | null,
    e?: Record<string, unknown>,
  ) => VerificationResult,
): Promise<VerificationResult> {
  if (!deps.arbitrate)
    return done('rejected', method, 'Correspondance ambiguë et aucun arbitre disponible', {
      found,
      scores: cmp,
    });
  const a = await deps.arbitrate(c, ref, base);
  const evidence = {
    found,
    scores: cmp,
    arbitration: { by: 'source_verifier', same: a.same, justification: a.justification },
  };
  // Un arbitrage par modèle est une preuve moins forte qu'une correspondance exacte : « partiellement vérifiée ».
  return a.same
    ? done('partially_verified', method, null, evidence)
    : done(
        'rejected',
        method,
        `Correspondance refusée à l'arbitrage : ${a.justification}`,
        evidence,
      );
}

/** Vérification en parallèle borné ; une indisponibilité réseau laisse la source « non vérifiée » (résultat `null`). */
export async function verifyMany(
  list: CandidateSource[],
  deps: VerifyDeps,
  concurrency = 4,
): Promise<(VerificationResult | null)[]> {
  const out: (VerificationResult | null)[] = new Array(list.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        try {
          out[i] = await verifySource(list[i]!, deps);
        } catch (e) {
          if (!(e instanceof AppError) || e.code !== 'E_NETWORK') throw e;
          out[i] = null;
        }
      }
    }),
  );
  return out;
}
