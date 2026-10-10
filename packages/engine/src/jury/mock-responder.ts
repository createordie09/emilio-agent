import type { LlmRequest } from '../llm/types';

const sys = (req: LlmRequest): string =>
  req.messages.find((m) => m.role === 'system')?.content ?? '';
/** Phrase ajoutée par la révision simulée : les jurés simulés la reconnaissent et relèvent leurs notes. */
export const MOCK_REVISION_SIGNATURE = 'Cette version tient compte des remarques du jury.';

/**
 * Répondeur déterministe du client simulé pour le jury, l'harmonisation et la révision (mode simulé, CdC §21.2).
 * Avant révision les notes sont insuffisantes (≈ 12/20) ; chaque section révisée les relève, de sorte qu'une ronde suffit.
 */
export function juryMockRespond(req: LlmRequest): string | undefined {
  const label = req.meta?.label ?? '';
  const prompt = sys(req);
  if (label.startsWith('jury:juror_')) {
    const crit = [...prompt.matchAll(/^- (C\d+) : .+ \((\d+) points\)$/gm)].map((m) => ({
      id: m[1]!,
      max: Number(m[2]),
    }));
    const texte = prompt.slice(prompt.indexOf('Texte à évaluer :'));
    const blocks = texte.split(/^### S\d+/m).slice(1);
    const withSig = blocks.filter((b) => b.includes(MOCK_REVISION_SIGNATURE)).length;
    const r =
      blocks.length > 1
        ? withSig / blocks.length
        : Math.min(1, (texte.split(MOCK_REVISION_SIGNATURE).length - 1) / 3);
    const adj = label.endsWith('form') ? 0.03 : label.endsWith('specialist') ? -0.02 : 0;
    // Évaluation globale : le travail d'ensemble est jugé satisfaisant ; par chapitre, les notes dépendent des révisions faites.
    const global = prompt.includes('l’ensemble du travail');
    const f = Math.max(0.3, Math.min(0.98, (global ? 0.9 : 0.6 + 0.3 * r) + adj));
    const index = [...prompt.matchAll(/^(S\d+) : /gm)].map((m) => m[1]!);
    const hasSig = (alias: string) =>
      (blocks.find((_, i) => index[i] === alias) ?? '').includes(MOCK_REVISION_SIGNATURE);
    const remarques = index
      .slice(0, 2)
      .filter((a) => !hasSig(a))
      .map((a, i) => ({
        id: '',
        section_id: a,
        localisation: 'deuxième paragraphe',
        probleme: '[simulé] Argumentation insuffisamment développée.',
        correction_attendue:
          i === 0 && label.endsWith('specialist')
            ? 'Développer l’argument avec les sources fournies (recherche complémentaire : microfinance Afrique).'
            : 'Développer l’argument avec les sources fournies.',
        gravite: i === 0 ? 'majeure' : 'mineure',
        besoin_recherche: i === 0 && label.endsWith('specialist'),
        requete_suggeree:
          i === 0 && label.endsWith('specialist') ? 'microfinance Afrique' : undefined,
      }));
    return JSON.stringify({
      scores: crit.map((c) => ({
        critere_id: c.id,
        note: Math.round(c.max * f * 10) / 10,
        justification: '[simulé] Critère globalement satisfait.',
      })),
      points_forts: ['[simulé] Structure claire.'],
      remarques,
    });
  }
  if (label === 'jury:president') {
    const lines = [
      ...prompt.matchAll(/^R\d+ \[(S\d+), (majeure|mineure|suggestion)\] .+? → (.+)$/gm),
    ];
    const by = new Map<string, { actions: Set<string>; sev: string; query: string | null }>();
    for (const m of lines) {
      const cur = by.get(m[1]!) ?? { actions: new Set<string>(), sev: 'suggestion', query: null };
      const q = /\(recherche complémentaire : ([^)]+)\)/.exec(m[3]!)?.[1] ?? null;
      cur.actions.add(m[3]!.replace(/\s*\(recherche complémentaire : [^)]+\)/, ''));
      if (
        ['majeure', 'mineure', 'suggestion'].indexOf(m[2]!) <
        ['majeure', 'mineure', 'suggestion'].indexOf(cur.sev)
      )
        cur.sev = m[2]!;
      cur.query = cur.query ?? q;
      by.set(m[1]!, cur);
    }
    return JSON.stringify({
      synthese:
        '[simulé] Texte globalement solide ; l’argumentation de certaines sections doit être renforcée.',
      plan: [...by].map(([section_id, v]) => ({
        section_id,
        actions: [...v.actions],
        priorite: v.sev,
        besoin_recherche: Boolean(v.query),
        ...(v.query ? { requete_suggeree: v.query } : {}),
      })),
    });
  }
  if (label === 'jury:justification')
    return JSON.stringify({
      justification:
        '[simulé] Les écarts s’expliquent par des exigences différentes selon les spécialisations.',
    });
  if (label === 'jury:harmonisation') {
    const first = /^(S\d+) \| /m.exec(prompt)?.[1];
    if (!first) return JSON.stringify({ modifications: [], manques: [] });
    return JSON.stringify({
      modifications: [
        {
          section_id: first,
          type: 'transition',
          apres: 'Cette partie prépare la suite du raisonnement.',
          justification: '[simulé] Transition vers la section suivante.',
        },
        {
          section_id: first,
          type: 'repetition',
          avant: 'Cette phrase n’existe pas dans la section.',
          apres: 'Une phrase de remplacement.',
          justification: '[simulé] Doit être écartée par le code.',
        },
        {
          section_id: first,
          type: 'renvoi',
          avant: 'Autre phrase absente.',
          apres: 'Voir la section [@A1] pour le détail.',
          justification: '[simulé] Marqueur de citation interdit.',
        },
      ],
      manques: [],
    });
  }
  if (label === 'redaction:revision') {
    const md = /Texte actuel :\n([\s\S]*?)\n\nRemarques du jury/.exec(prompt)?.[1] ?? '';
    return JSON.stringify({
      markdown: `${md}\n\n${MOCK_REVISION_SIGNATURE}`,
      claims: [],
      mots: 0,
      manques: [],
    });
  }
  return undefined;
}
