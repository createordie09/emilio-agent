import type { LlmRequest } from '../llm/types';

const sys = (req: LlmRequest): string =>
  req.messages.find((m) => m.role === 'system')?.content ?? '';

type Sk = { cle: string; niveau: string; titre: string; enfants?: Sk[] };
type Out = {
  ref: string;
  parent: string | null;
  cle?: string;
  niveau: string;
  titre: string;
  objectif: string;
  questions_cles: string[];
  mots_cibles: number;
  sources: string[];
  remarques?: string;
};

const GENERIC: Sk[] = [
  { cle: 'g.intro', niveau: 'chapitre', titre: 'Introduction générale' },
  { cle: 'g.c1', niveau: 'chapitre', titre: 'Cadre conceptuel et revue de littérature' },
  { cle: 'g.c2', niveau: 'chapitre', titre: 'Démarche méthodologique' },
  { cle: 'g.c3', niveau: 'chapitre', titre: 'Résultats et discussion' },
  { cle: 'g.concl', niveau: 'chapitre', titre: 'Conclusion générale' },
];

/**
 * Répondeur déterministe du client simulé pour le cadrage (P1) et le plan (P2) — mode simulé, CdC §21.2.
 * Il lit le prompt rendu et produit des JSON conformes aux schémas ; `undefined` si l'appel n'est pas de ce domaine.
 */
export function planningMockRespond(req: LlmRequest): string | undefined {
  const label = req.meta?.label ?? '';
  const prompt = sys(req);
  if (label === 'plan:cadrage') {
    const titre = /- Thème \/ titre provisoire : (.+)/.exec(prompt)?.[1]?.trim() ?? 'le sujet';
    const motsCles = (/- Mots-clés : (.+)/.exec(prompt)?.[1] ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean);
    const concepts = motsCles.length
      ? motsCles.slice(0, 4)
      : titre
          .split(/\s+/)
          .filter((w) => w.length > 5)
          .slice(0, 3);
    const proposer = prompt.includes('La problématique est à proposer');
    const hasHyp = /- Hypothèses : /.test(prompt);
    return JSON.stringify({
      incoherences: hasHyp
        ? []
        : [
            {
              element: 'Hypothèses',
              probleme: '[simulé] Aucune hypothèse formulée alors que la démarche est explicative.',
              proposition:
                'Formuler 2 ou 3 hypothèses vérifiables à partir des questions de recherche.',
            },
          ],
      problematiques: proposer
        ? [1, 2, 3].map((i) => ({
            formulation: `[simulé] Dans quelle mesure ${titre.toLowerCase()} — formulation ${i} (délimitée dans l'espace et le temps) ?`,
            justification: `[simulé] Formulation ${i} : question centrale claire. Elle se prête à une vérification empirique.`,
          }))
        : [],
      concepts: concepts.map((nom) => ({ nom, a_definir: true })),
      cadres_theoriques_pistes: [
        '[simulé] Approche institutionnelle',
        '[simulé] Théorie du capital social',
      ],
      requetes: concepts.map((c) => ({
        concept: c,
        fr: [c, `${c} Afrique`, `${c} impact`],
        en: [`${c}`, `${c} Africa`, `${c} financial inclusion`],
      })),
      manques: [],
    });
  }
  if (label === 'plan:architecte') {
    const a = prompt.indexOf('\n[\n');
    const b = prompt.indexOf('\n\nSources candidates');
    let skeleton: Sk[] = GENERIC;
    if (a >= 0 && b > a) {
      try {
        skeleton = JSON.parse(prompt.slice(a + 1, b)) as Sk[];
      } catch {
        skeleton = GENERIC;
      }
    }
    const aliases = [...prompt.matchAll(/^(S\d+) \| /gm)].map((m) => m[1]!);
    const instr = /Instructions supplémentaires de l'utilisateur \(à respecter\) :\n([^\n]+)/.exec(
      prompt,
    )?.[1];
    const out: Out[] = [];
    let n = 0;
    let src = 0;
    const pick = (): string[] =>
      aliases.length ? [aliases[src++ % aliases.length]!, aliases[src++ % aliases.length]!] : [];
    const EXTRA = [
      'Cadrage et définitions',
      'Analyse approfondie',
      'Synthèse et mise en perspective',
    ];
    const walk = (list: Sk[], parent: string | null) => {
      for (const s of list) {
        const ref = `n${++n}`;
        const leaf = !s.enfants?.length;
        const bodyChapter =
          s.niveau === 'chapitre' && !/^(intro|concl|g\.intro|g\.concl)/.test(s.cle);
        out.push({
          ref,
          parent,
          cle: s.cle,
          niveau: s.niveau,
          titre: s.titre,
          objectif: `[simulé] Traiter « ${s.titre} » de façon rigoureuse et sourcée.`,
          questions_cles: [
            `[simulé] Quels éléments établis sur « ${s.titre} » ?`,
            '[simulé] Quelles limites ?',
          ],
          mots_cibles: 0,
          sources: leaf && !bodyChapter ? pick() : [],
        });
        if (s.enfants?.length) walk(s.enfants, ref);
        else if (bodyChapter && s.niveau === 'chapitre') {
          EXTRA.forEach((t) => {
            const r2 = `n${++n}`;
            out.push({
              ref: r2,
              parent: ref,
              niveau: 'section',
              titre: `${t} — ${s.titre.split(' ').slice(0, 4).join(' ')}`,
              objectif: `[simulé] Développer l'angle « ${t.toLowerCase()} ».`,
              questions_cles: [
                '[simulé] Que disent les sources vérifiées ?',
                '[simulé] Quel apport pour la problématique ?',
              ],
              mots_cibles: 1,
              sources: pick(),
            });
          });
        }
      }
    };
    walk(skeleton, null);
    return JSON.stringify({
      noeuds: out,
      justification_globale: `[simulé] Plan progressif : du cadre conceptuel vers l'analyse.${instr ? ` Instructions prises en compte : ${instr}` : ''}`,
      methodologie:
        '[simulé] Vérification des hypothèses par comparaison des résultats aux attentes de la littérature.',
      hypotheses: [],
      risques: aliases.length
        ? ['[simulé] Littérature africaine récente à renforcer.']
        : [
            '[simulé] Peu de littérature trouvée pour ce sujet : prévoir des documents fournis par l’utilisateur.',
          ],
      manques: [],
    });
  }
  return undefined;
}
