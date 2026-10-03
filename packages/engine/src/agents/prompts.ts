import { REGLES_INTEGRITE } from './common';

const files = import.meta.glob<string>('./*/*.prompt.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Version des prompts de recherche (stockée avec chaque appel, CdC §10.1). */
export const RESEARCH_PROMPT_VERSION = 'recherche-1';

/** Charge un prompt `agents/<dossier>/<nom>.prompt.md` et remplace les `{{variables}}` (le bloc d'intégrité est injecté d'office). */
export function renderPrompt(
  name: string,
  vars: Record<string, string | number | undefined>,
): string {
  const key = `./${name}.prompt.md`;
  const tpl = files[key];
  if (tpl === undefined) throw new Error(`Prompt introuvable : ${name}`);
  const all: Record<string, string | number | undefined> = {
    regles_integrite: REGLES_INTEGRITE,
    ...vars,
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(all[k] ?? ''));
}

/** Version des prompts de cadrage et de plan (P1, P2), stockée avec chaque appel. */
export const PLAN_PROMPT_VERSION = 'plan-1';
