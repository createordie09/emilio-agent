import { describe, it, expect } from 'vitest';
import {
  sentencesOf,
  markersOf,
  wordCount,
  quotesOf,
  ngrams,
  removeSentences,
  checkSection,
  checkLength,
  numberTokens,
  numbersToJustify,
  supportingExtracts,
  type CheckCtx,
  type Extract,
} from '../src';

const EXTRACT_1 =
  'Cette étude analyse le rôle de la microfinance dans l’inclusion financière des ménages ruraux du Bénin à partir d’une enquête auprès de 400 ménages. Les groupes de caution solidaire améliorent l’accès au crédit.';
const ex = (alias: string, src: string, text: string, page = '3'): Extract => ({
  alias,
  sourceAlias: src,
  sourceId: `id-${src}`,
  chunkId: `chunk-${alias}`,
  page,
  text,
});
const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({
  sources: new Map([
    ['A1', { alias: 'A1', id: 'id-A1', label: 'Adjovi (2021)', year: 2021 }],
    ['A2', { alias: 'A2', id: 'id-A2', label: 'Houngbo (2019)', year: 2019 }],
  ]),
  extracts: [
    ex('E1', 'A1', EXTRACT_1),
    ex('E2', 'A2', 'Le crédit solidaire concerne 12 500 femmes selon le rapport annuel.'),
  ],
  allowedNumbers: new Set(['60']),
  smallIntMax: 10,
  ngram: 8,
  maxQuoteWords: 40,
  ...over,
});
const kinds = (md: string, c = ctx()) => checkSection(md, c).issues.map((i) => i.kind);

describe('découpage du texte', () => {
  it('phrases : abréviations, décimaux, marqueurs et guillemets ne coupent pas à tort', () => {
    const md =
      'Selon Adjovi et al. le taux atteint 45,3 % [@A1, p. 3]. Cela change tout (cf. p. 12). « Une citation. » Fin du paragraphe.\n\n#### Titre\n\nAutre paragraphe.';
    const s = sentencesOf(md).map((x) => x.text);
    expect(s).toEqual([
      'Selon Adjovi et al. le taux atteint 45,3 % [@A1, p. 3].',
      'Cela change tout (cf. p. 12).',
      '« Une citation. » Fin du paragraphe.',
      'Autre paragraphe.',
    ]);
  });
  it('les titres, tableaux et jetons de tableau ne sont pas des phrases', () => {
    const md = '## Titre\n\n{{TABLEAU:A1}}\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nTexte.';
    expect(sentencesOf(md).map((x) => x.text)).toEqual(['Texte.']);
  });
  it('marqueurs : valides, avec page, mal formés', () => {
    const m = markersOf('Un fait [@A1, p. 12] et un autre [@A2] puis [@A1; @A2] et [@inconnu 3].');
    expect(m.valid.map((x) => [x.alias, x.page])).toEqual([
      ['A1', '12'],
      ['A2', null],
    ]);
    expect(m.malformed).toHaveLength(2);
  });
  it('mots : titres comptés, marqueurs et jetons de tableau exclus', () => {
    expect(wordCount('## Un titre\n\nTrois petits mots [@A1, p. 3] ici.\n\n{{TABLEAU:A1}}')).toBe(
      6,
    );
  });
  it('citations, n-grammes et suppression de phrases par position', () => {
    expect(quotesOf('Il écrit « le crédit solidaire » et « autre »')).toEqual([
      'le crédit solidaire',
      'autre',
    ]);
    expect(ngrams('un deux trois quatre cinq six sept huit neuf', 8).size).toBe(2);
    const md = 'Première phrase. Deuxième phrase. Troisième phrase.\n\nUn autre paragraphe.';
    const ss = sentencesOf(md);
    expect(removeSentences(md, [ss[1]!, ss[3]!])).toBe('Première phrase. Troisième phrase.');
  });
  it('nombres : formes françaises, renvois internes exclus', () => {
    expect(numberTokens('12 500 femmes, 45,3 % et 0.031').map((t) => t.canon)).toEqual([
      '12500',
      '45.3',
      '0.031',
    ]);
    expect(
      numbersToJustify(
        'Voir le Tableau 3, la section 2.3.1, p. 12 et H2 : 60 répondants [@A1, p. 4].',
      ).map((n) => n.canon),
    ).toEqual(['60']);
  });
});

describe('contrôles d’intégrité d’une section (§12)', () => {
  it('texte propre : citations et nombres justifiés, aucune alerte, une affirmation sourcée', () => {
    const md =
      'Les groupes solidaires facilitent l’accès aux prêts pour les ménages ruraux [@A1, p. 3]. Le dispositif touche 12 500 femmes [@A2, p. 7]. L’échantillon compte 60 répondants.';
    const r = checkSection(md, ctx());
    expect(r.issues).toEqual([]);
    expect(r.claims.map((c) => c.aliases)).toEqual([['A1'], ['A2']]);
  });
  it('source inconnue ou marqueur mal formé : jamais citable (§12.1)', () => {
    expect(kinds('Un fait établi [@A9, p. 1].')).toContain('source_inconnue');
    expect(kinds('Un fait établi [@A1 p 1 ?].')).toContain('marqueur_invalide');
  });
  it('citation directe : exacte (tolérance typographique) ou refusée', () => {
    const ok =
      'Les auteurs notent que « Les groupes de caution solidaire améliorent l’accès au crédit » [@A1, p. 3].';
    expect(kinds(ok)).toEqual([]);
    const typo =
      "Les auteurs notent que « Les groupes de caution solidaire améliorent l'accès au crédit » [@A1, p. 3].";
    expect(kinds(typo)).toEqual([]);
    expect(
      kinds('Ils affirment que « la microfinance supprime la pauvreté rurale » [@A1, p. 3].'),
    ).toEqual(['citation_inexacte']);
    expect(
      kinds('Ils affirment que « la microfinance supprime la pauvreté » sans marqueur.'),
    ).toContain('citation_sans_source');
    const long = `Texte « ${Array.from({ length: 41 }, () => 'mot').join(' ')} » [@A1, p. 3].`;
    expect(kinds(long)).toContain('citation_inexacte');
  });
  it('nombres : orphelin refusé, justifié par l’extrait cité dans la phrase, entiers ≤ 10 tolérés', () => {
    expect(kinds('Le taux atteint 87 % des ménages [@A1, p. 3].')).toEqual(['nombre_orphelin']);
    expect(kinds('L’enquête porte sur 400 ménages [@A1, p. 3].')).toEqual([]);
    // 12 500 est dans l'extrait de A2, pas dans celui de A1 : citer la mauvaise source ne justifie pas le nombre
    expect(kinds('Le dispositif touche 12 500 femmes [@A1, p. 3].')).toEqual(['nombre_orphelin']);
    expect(kinds('Le dispositif touche 12 500 femmes sans source.')).toEqual(['nombre_orphelin']);
    expect(kinds('Trois pays et 5 régions sont concernés.')).toEqual([]);
    // l'année de publication de la source citée est connue ; celle d'une autre source ne l'est pas
    expect(kinds('Adjovi (2021) estime que le crédit solidaire progresse [@A1, p. 3].')).toEqual(
      [],
    );
    expect(kinds('Adjovi (2019) estime que le crédit solidaire progresse [@A1, p. 3].')).toEqual([
      'nombre_orphelin',
    ]);
    expect(kinds('Voir le Tableau 14 et la section 2.3.1, page [@A1, p. 118].')).toEqual([]);
  });
  it('similarité : 8 mots consécutifs recopiés hors guillemets signalés (§12.4)', () => {
    const copied =
      'Cette étude analyse le rôle de la microfinance dans l’inclusion financière [@A1, p. 3].';
    expect(kinds(copied)).toEqual(['recopie']);
    const para =
      'Les travaux montrent que la microfinance joue un rôle important pour l’inclusion financière rurale [@A1, p. 3].';
    expect(kinds(para)).toEqual([]);
    // en citation entre guillemets : autorisé (et vérifié littéralement)
    expect(
      kinds(
        'Ils écrivent « Cette étude analyse le rôle de la microfinance dans l’inclusion financière » [@A1, p. 3].',
      ),
    ).toEqual([]);
  });
  it('emplacements à compléter et informations manquantes ne sont pas contrôlés comme des affirmations', () => {
    expect(
      kinds('[INFORMATION MANQUANTE : le taux de 87 % de la région n’est pas fourni].'),
    ).toEqual([]);
  });
  it('longueur : ±10 % de la cible', () => {
    const md = Array.from({ length: 100 }, () => 'mot').join(' ');
    expect(checkLength(md, 100)).toBeNull();
    expect(checkLength(md, 105)).toBeNull();
    expect(checkLength(md, 150)?.kind).toBe('longueur');
    expect(checkLength(md, 70)?.detail).toContain('condense');
    expect(checkLength(md, 0)).toBeNull();
  });
  it('extrait support : celui que le modèle déclare s’il appartient à la source citée, sinon le meilleur de la source', () => {
    const c = ctx();
    const claim = checkSection(
      'Les groupes de caution solidaire améliorent l’accès au crédit rural [@A1, p. 3].',
      c,
    ).claims[0]!;
    expect(supportingExtracts(claim, c, []).map((e) => e.alias)).toEqual(['E1']);
    // le modèle déclare un extrait d'une AUTRE source : ignoré (§12.2.2)
    expect(
      supportingExtracts(claim, c, [{ phrase: claim.text, chunk_id: 'E2' }]).map((e) => e.alias),
    ).toEqual(['E1']);
  });
});
