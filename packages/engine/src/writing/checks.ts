import { quoteExists } from '../research/reading-note';
import { numberTokens } from '../util/numbers';
import {
  copiedNgrams,
  markersOf,
  ngrams,
  quotesOf,
  sentencesOf,
  removeSentences,
  stripMarkers,
  wordCount,
  type Sentence,
} from './text';

/** Source citable proposée au rédacteur sous un alias (A1, A2…). */
export type SourceInfo = { alias: string; id: string; label: string; year?: number | null };
/** Extrait proposé au rédacteur sous un alias (E1, E2…), avec sa source et sa page. */
export type Extract = {
  alias: string;
  sourceAlias: string;
  sourceId: string;
  chunkId: string | null;
  page: string | null;
  text: string;
};

export type CheckCtx = {
  sources: Map<string, SourceInfo>;
  extracts: Extract[];
  /** Nombres autorisés partout : résultats P4, brief, plan (§12.3). */
  allowedNumbers: Set<string>;
  /** Entiers jusqu'à cette valeur tolérés sans source (« trois pays », « 2 sections »). */
  smallIntMax: number;
  /** Longueur d'un n-gramme pour la similarité (§12.4 : 8). */
  ngram: number;
  /** Taille maximale d'une citation directe (§12.2 : 40 mots). */
  maxQuoteWords: number;
};

export type IssueKind =
  | 'source_inconnue'
  | 'marqueur_invalide'
  | 'citation_inexacte'
  | 'citation_sans_source'
  | 'nombre_orphelin'
  | 'recopie'
  | 'non_etaye'
  | 'partiel'
  | 'longueur'
  | 'tableau_inconnu';

export type Issue = {
  kind: IssueKind;
  /** Phrase concernée (null pour un problème global comme la longueur). */
  sentence: Sentence | null;
  /** Explication en français, transmise au Rédacteur pour la correction ciblée. */
  detail: string;
};

/** Ces problèmes entraînent la suppression de la phrase si la correction échoue ; les autres sont seulement signalés. */
export const PRUNABLE: ReadonlySet<IssueKind> = new Set([
  'source_inconnue',
  'marqueur_invalide',
  'citation_inexacte',
  'citation_sans_source',
  'nombre_orphelin',
  'recopie',
  'non_etaye',
]);

export const REASON_FR: Record<IssueKind, string> = {
  source_inconnue: 'source non citable ou inconnue',
  marqueur_invalide: 'marqueur de citation mal formé',
  citation_inexacte: 'citation absente du texte de la source',
  citation_sans_source: 'citation directe sans source',
  nombre_orphelin: 'nombre absent des sources citées et des résultats',
  recopie: 'passage recopié d’une source',
  non_etaye: 'affirmation non étayée par l’extrait cité',
  partiel: 'affirmation seulement partiellement étayée',
  longueur: 'longueur hors tolérance',
  tableau_inconnu: 'tableau inconnu',
};

const REFERENCES = [
  /\[@[^\]]*\]/g,
  /\b(?:Tableau|Figure|Chapitre|chapitre|Section|section|Partie|partie|Annexe|annexe|Graphique|graphique)\s+\d+(?:\.\d+)*/g,
  /\bH\d{1,2}\b/g,
  /\bpp?\.\s*\d+(?:\s*[-–]\s*\d+)?/g,
  /\bn°\s*\d+/g,
  /\{\{TABLEAU:[^}]*\}\}/g,
];

/** Nombres d'une phrase à justifier (hors renvois internes, pages, numéros de tableaux, marqueurs). */
export function numbersToJustify(sentence: string): { raw: string; canon: string }[] {
  let t = sentence;
  for (const r of REFERENCES) t = t.replace(r, ' ');
  return numberTokens(t).map((x) => ({ raw: x.raw, canon: x.canon }));
}

const PLACEHOLDER = /\[(?:INFORMATION MANQUANTE|DONNÉES À INSÉRER|À COMPLÉTER)[^\]]*\]/;

export type Claim = {
  /** Phrase (marqueurs retirés). */
  text: string;
  sentence: Sentence;
  aliases: string[];
  page: string | null;
};

/**
 * Contrôles par le code d'une version de section (CdC §12) : sources citables (§12.1), citations littérales (§12.2),
 * chiffres (§12.3), similarité (§12.4). Renvoie aussi les affirmations sourcées à faire vérifier par le Vérificateur d'ancrage.
 */
export function checkSection(md: string, ctx: CheckCtx): { issues: Issue[]; claims: Claim[] } {
  const issues: Issue[] = [];
  const claims: Claim[] = [];
  const reference = new Set<string>();
  for (const e of ctx.extracts) for (const g of ngrams(e.text, ctx.ngram)) reference.add(g);
  const bySource = new Map<string, Extract[]>();
  for (const e of ctx.extracts)
    bySource.set(e.sourceAlias, [...(bySource.get(e.sourceAlias) ?? []), e]);

  for (const s of sentencesOf(md)) {
    if (PLACEHOLDER.test(s.text)) continue;
    const { valid, malformed } = markersOf(s.text);
    if (malformed.length)
      issues.push({
        kind: 'marqueur_invalide',
        sentence: s,
        detail: `Marqueur mal formé : ${malformed[0]}. Utilise [@A1] ou [@A1, p. 12].`,
      });
    const unknown = valid.filter((m) => !ctx.sources.has(m.alias));
    if (unknown.length)
      issues.push({
        kind: 'source_inconnue',
        sentence: s,
        detail: `La source « ${unknown[0]!.alias} » n'existe pas dans la liste des sources disponibles (identifiants valides : ${[...ctx.sources.keys()].join(', ') || 'aucun'}).`,
      });
    const known = valid.filter((m) => ctx.sources.has(m.alias));
    const cited = known.flatMap((m) => bySource.get(m.alias) ?? []);

    for (const q of quotesOf(s.text)) {
      const words = q.split(/\s+/).length;
      if (!known.length) {
        issues.push({
          kind: 'citation_sans_source',
          sentence: s,
          detail: `La citation « ${q.slice(0, 60)}… » n'est suivie d'aucun marqueur [@A…, p. N].`,
        });
      } else if (words > ctx.maxQuoteWords) {
        issues.push({
          kind: 'citation_inexacte',
          sentence: s,
          detail: `La citation dépasse ${ctx.maxQuoteWords} mots : paraphrase-la ou raccourcis-la.`,
        });
      } else if (!cited.some((e) => quoteExists(q, e.text))) {
        issues.push({
          kind: 'citation_inexacte',
          sentence: s,
          detail: `La citation « ${q.slice(0, 80)} » ne figure pas mot pour mot dans les extraits de la source citée : recopie-la exactement ou paraphrase.`,
        });
      }
    }

    // §12.3 : tout nombre vient d'un extrait cité dans la même phrase, ou des résultats / du brief.
    const allowed = new Set<string>(ctx.allowedNumbers);
    for (const e of cited) numberTokens(e.text).forEach((x) => allowed.add(x.canon));
    // L'année de publication d'une source citée dans la phrase (« Adjovi et Houngbo (2021) ») est connue de la base.
    for (const m of known) {
      const y = ctx.sources.get(m.alias)?.year;
      if (y) allowed.add(String(y));
    }
    const orphan = numbersToJustify(s.text).find(
      (n) =>
        !allowed.has(n.canon) &&
        !(
          Number.isInteger(Number(n.canon)) &&
          Number(n.canon) <= ctx.smallIntMax &&
          Number(n.canon) >= 0
        ),
    );
    if (orphan)
      issues.push({
        kind: 'nombre_orphelin',
        sentence: s,
        detail: `Le nombre « ${orphan.raw} » ne figure ni dans l'extrait cité dans cette phrase ni dans les résultats fournis : supprime-le ou cite la source qui le contient.`,
      });

    // §12.4 : aucun passage de ≥ 8 mots identiques hors guillemets.
    if (reference.size && copiedNgrams(s.text, reference, ctx.ngram) > 0)
      issues.push({
        kind: 'recopie',
        sentence: s,
        detail: `Cette phrase recopie ${ctx.ngram} mots consécutifs ou plus d'un extrait : reformule avec tes propres mots (ou mets entre guillemets si c'est essentiel).`,
      });

    if (known.length)
      claims.push({
        text: stripMarkers(s.text),
        sentence: s,
        aliases: [...new Set(known.map((m) => m.alias))],
        page: known.find((m) => m.page)?.page ?? null,
      });
  }
  return { issues, claims };
}

/** Longueur : ±10 % de la cible (§9 P5.3). Les jetons de tableaux et les marqueurs ne comptent pas. */
export function checkLength(md: string, target: number, tolerance = 0.1): Issue | null {
  if (!target) return null;
  const n = wordCount(md);
  if (n < target * (1 - tolerance) || n > target * (1 + tolerance))
    return {
      kind: 'longueur',
      sentence: null,
      detail: `Le texte compte ${n} mots pour une cible de ${target} (±${Math.round(tolerance * 100)} %) : ${n < target ? 'développe' : 'condense'}.`,
    };
  return null;
}

const toks = (s: string): string[] =>
  stripMarkers(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);

const overlap = (a: string[], b: Set<string>): number =>
  a.length ? a.filter((w) => b.has(w)).length / a.length : 0;

/**
 * Extrait support d'une affirmation : l'extrait que le modèle a déclaré dans `claims` s'il appartient bien à la source citée (§12.2.2),
 * sinon le meilleur extrait de cette source (recouvrement lexical). Vide si la source n'a aucun extrait.
 */
export function supportingExtracts(
  claim: Claim,
  ctx: CheckCtx,
  declared: { phrase: string; chunk_id?: string }[],
): Extract[] {
  const out: Extract[] = [];
  const words = toks(claim.text);
  const norm = (s: string) => toks(s).join(' ');
  const decl = declared.find(
    (d) =>
      norm(d.phrase) === norm(claim.text) ||
      (norm(d.phrase) &&
        (norm(claim.text).includes(norm(d.phrase)) || norm(d.phrase).includes(norm(claim.text)))),
  );
  for (const alias of claim.aliases.slice(0, 2)) {
    const mine = ctx.extracts.filter((e) => e.sourceAlias === alias);
    if (!mine.length) continue;
    const named = decl?.chunk_id
      ? mine.find((e) => e.alias === decl.chunk_id!.trim().toUpperCase())
      : undefined;
    const best = [...mine].sort(
      (a, b) => overlap(words, new Set(toks(b.text))) - overlap(words, new Set(toks(a.text))),
    )[0]!;
    out.push(named ?? best);
  }
  return out;
}

/** Retire les phrases d'un texte libre contenant un nombre absent de `allowed` (§12.3) ; renvoie le texte nettoyé et le nombre de phrases retirées. */
export function dropOrphanNumberSentences(
  text: string,
  allowed: Set<string>,
  smallIntMax: number,
): { text: string; dropped: number } {
  const bad = sentencesOf(text).filter((s) =>
    numbersToJustify(s.text).some(
      (n) =>
        !allowed.has(n.canon) &&
        !(Number.isInteger(Number(n.canon)) && Number(n.canon) <= smallIntMax),
    ),
  );
  return { text: bad.length ? removeSentences(text, bad) : text, dropped: bad.length };
}
