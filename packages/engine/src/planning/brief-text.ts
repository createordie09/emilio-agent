import {
  WORK_TYPE_LABEL_FR,
  type Brief,
  type MissionFileInfo,
  type OutlineNodeView,
} from '@emilio/shared';

const line = (label: string, v: string | string[] | undefined | null): string[] => {
  const t = Array.isArray(v) ? v.join(' ; ') : v;
  return t && t.trim() ? [`- ${label} : ${t.trim()}`] : [];
};

/** Brief condensé pour les prompts (CdC §10.3.1 `brief_compact`). Aucune donnée personnelle de l'auteur n'est transmise. */
export function compactBrief(b: Brief): string {
  return [
    ...line('Type de travail', WORK_TYPE_LABEL_FR[b.workType]),
    ...line('Discipline', [b.discipline, b.specialite ?? ''].filter(Boolean).join(' — ')),
    ...line('Thème / titre provisoire', b.titre),
    ...line('Problématique', b.problematique),
    ...(b.problematiqueAProposer ? ["- Problématique : à proposer par l'équipe."] : []),
    ...line('Questions de recherche', b.questionsRecherche),
    ...line('Objectif général', b.objectifGeneral),
    ...line('Objectifs spécifiques', b.objectifsSpecifiques),
    ...line('Hypothèses', b.hypotheses),
    ...line(
      'Terrain',
      [b.terrain?.pays, b.terrain?.ville, b.terrain?.structure, b.terrain?.periode].filter(
        (x): x is string => Boolean(x),
      ),
    ),
    ...line('Approche', b.approche === 'a_proposer' ? 'à proposer' : b.approche),
    ...line('Mots-clés', b.motsCles),
    ...line(
      'Collecte',
      [b.collecte?.echantillon, b.collecte?.mode, b.collecte?.outil].filter((x): x is string =>
        Boolean(x),
      ),
    ),
    ...line('Exigence', b.exigence),
    ...line('Critères du jury', b.criteresJury),
    ...line(
      'Longueur',
      `${b.longueur.min} à ${b.longueur.max} ${b.longueur.unite === 'pages' ? 'pages' : 'mots'}`,
    ),
    ...line('Instructions libres', b.instructionsLibres),
  ].join('\n');
}

/** Description des données de terrain (profil calculé par du code, jamais par le modèle, CdC §17). */
export function dataProfileText(files: MissionFileInfo[]): string {
  const f = files.filter((x) => x.kind === 'field_data' && x.profile);
  if (!f.length) return 'aucune donnée de terrain fournie';
  return f
    .map((x) => {
      const p = x.profile!;
      const cols = p.columns
        .slice(0, 12)
        .map((c) => c.name)
        .join(', ');
      return `${x.filename} : ${p.respondents} répondant(s), ${p.columns.length} variable(s) (${cols}${p.columns.length > 12 ? '…' : ''})`;
    })
    .join(' ; ');
}

/** Plan courant en texte (régénération avec commentaire : le modèle voit ce que l'utilisateur a déjà modifié). */
export function outlineText(nodes: OutlineNodeView[]): string {
  const depth = (n: OutlineNodeView): number => {
    let d = 0;
    let cur: OutlineNodeView | undefined = n;
    while (cur?.parentId) {
      d++;
      cur = nodes.find((x) => x.id === cur!.parentId);
    }
    return d;
  };
  return nodes
    .map(
      (n) =>
        `${'  '.repeat(depth(n))}- ${n.numbering ? n.numbering + ' ' : ''}${n.title} (${n.level}, ${n.targetWords} mots)${n.objective ? ` — ${n.objective}` : ''}`,
    )
    .join('\n');
}
