import type { LlmRequest } from '../llm/types';

const sys = (req: LlmRequest): string =>
  req.messages.find((m) => m.role === 'system')?.content ?? '';

/** Répondeur déterministe pour le diaporama et la fiche de préparation (mode simulé, CdC §21.2). Aucun nombre : rien à justifier. */
export function exportMockRespond(req: LlmRequest): string | undefined {
  const label = req.meta?.label ?? '';
  const p = sys(req);
  if (label === 'export:slides') {
    const struct = [...p.matchAll(/^(\d+)\. \[(\w+)\] (.+)$/gm)];
    return JSON.stringify({
      diapositives: struct.map((m) => ({
        type: m[2],
        titre: m[3]!.split(' — ')[0],
        puces:
          m[2] === 'titre'
            ? []
            : [
                '[simulé] Premier point essentiel',
                '[simulé] Deuxième point essentiel',
                '[simulé] Troisième point essentiel',
              ],
        notes: `[simulé] Texte à dire pour la diapositive « ${m[3]!.split(' — ')[0]} » : présenter calmement les idées principales et faire le lien avec la suite.`,
      })),
      manques: [],
    });
  }
  if (label === 'export:questions') {
    const secs = [...p.matchAll(/^- (\d+(?:\.\d+)*) /gm)].map((m) => m[1]!);
    const origines = [
      'general',
      'methode',
      'theorie',
      'resultats',
      'faiblesse',
      'remarque_jury',
    ] as const;
    const n = 22;
    return JSON.stringify({
      questions: Array.from({ length: n }, (_, i) => ({
        question: `[simulé] Question probable du jury, numéro ${i + 1}, sur ${origines[i % origines.length]}.`,
        reponse:
          '[simulé] Éléments de réponse appuyés sur le travail : rappeler le choix fait, le justifier brièvement, puis reconnaître ses limites.',
        renvoi: secs.length ? secs[i % secs.length] : '',
        origine: origines[i % origines.length],
      })),
      manques: [],
    });
  }
  return undefined;
}
