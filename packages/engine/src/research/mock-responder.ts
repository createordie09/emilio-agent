import type { LlmRequest } from '../llm/types';

const sys = (req: LlmRequest): string =>
  req.messages.find((m) => m.role === 'system')?.content ?? '';

/**
 * Répondeur déterministe du client simulé pour les agents de recherche (mode simulé, CdC §21.2).
 * Il lit le prompt rendu et produit des JSON conformes aux schémas ; `undefined` si l'appel n'est pas de ce domaine.
 */
export function researchMockRespond(req: LlmRequest): string | undefined {
  const label = req.meta?.label ?? '';
  if (!label.startsWith('recherche:')) return undefined;
  const prompt = sys(req);
  switch (label) {
    case 'recherche:requetes': {
      const title = /Section à documenter : «\s*(.+?)\s*»/.exec(prompt)?.[1] ?? 'recherche';
      const n = Number(/Fournis (\d+) requêtes/.exec(prompt)?.[1] ?? 4);
      const base = [
        { texte: title, langue: 'fr' },
        { texte: `${title} Afrique`, langue: 'fr' },
        { texte: title.replace(/[^\p{L}\p{N} ]/gu, ' '), langue: 'en' },
        { texte: `${title} financial inclusion`, langue: 'en' },
        { texte: 'microfinance inclusion financière', langue: 'fr' },
        { texte: 'mobile money financial inclusion Africa', langue: 'en' },
      ];
      return JSON.stringify({ requetes: base.slice(0, Math.max(1, n)), manques: [] });
    }
    case 'recherche:classement': {
      const evaluations = [...prompt.matchAll(/^- \[(C\d+)\] (.+)$/gm)].map((m) => {
        const relevant =
          /microfinance|inclusion|épargne|caution|mobile money|éducation financière|systèmes financiers/i.test(
            m[2]!,
          );
        return {
          id: m[1]!,
          score: relevant ? 8 : 2,
          garder: relevant,
          justification: relevant
            ? 'Traite directement du sujet.'
            : 'Sans rapport avec la section.',
        };
      });
      return JSON.stringify({ evaluations, manques: [] });
    }
    case 'recherche:fiche': {
      const m = /\[(E\d+)\](?: \(p\. [^)]*\))? ([\s\S]*?)(?:\n\n\[E\d+\]|$)/.exec(
        prompt.slice(prompt.indexOf('Extraits disponibles')),
      );
      const first = (m?.[2] ?? '').split(/(?<=[.!?])\s+/)[0]?.trim() ?? '';
      return JSON.stringify({
        these_principale: '[simulé] ' + (first || 'Aucun extrait.'),
        methode: '[simulé] Méthode décrite dans les extraits.',
        resultats_cles: first ? [first] : [],
        // Citation recopiée à l'identique depuis le premier extrait : elle doit passer le contrôle littéral.
        citations: first ? [{ extrait: m?.[1] ?? 'E1', texte: first }] : [],
        limites: [],
        pertinence: '[simulé] Source utile pour la section.',
        manques: [],
      });
    }
    case 'recherche:arbitrage':
      return JSON.stringify({
        meme_document: true,
        justification: '[simulé] Titres et auteurs cohérents.',
      });
    default:
      return undefined;
  }
}
