import { z } from 'zod';
import type { AgentRole } from '@emilio/shared';
import { REGLES_INTEGRITE } from './common';

/** Définition d'un agent : prompt système, schéma de sortie zod, température (CdC §10.1). */
export type AgentDefinition<T extends z.ZodType = z.ZodType> = {
  role: AgentRole;
  promptVersion: string;
  temperature: number;
  schema: T;
  /** Nom du schéma JSON transmis à OpenRouter. */
  schemaName: string;
  systemPrompt: (ctx: { label: string }) => string;
};

/** Sortie générique des agents de démonstration de J2 (les vrais schémas arrivent avec leurs jalons). */
export const DemoOutputSchema = z.object({
  resume: z.string().min(1),
  manques: z.array(z.string()),
});
export type DemoOutput = z.infer<typeof DemoOutputSchema>;

const ROLE_LABEL_FR: Record<AgentRole, string> = {
  orchestrator: 'directeur de recherche',
  outline_architect: 'architecte du plan',
  researcher: 'chercheur documentaire',
  document_analyst: 'analyste de documents',
  source_verifier: 'vérificateur de sources',
  data_analyst: 'analyste de données',
  section_writer: 'rédacteur académique',
  grounding_checker: "vérificateur d'ancrage",
  summarizer: 'résumeur',
  juror_methodologist: 'juré méthodologiste',
  juror_specialist: 'juré spécialiste',
  juror_form: 'juré forme',
  jury_president: 'président du jury',
  harmonizer: 'harmonisateur',
  bibliographer: 'bibliographe',
  defense_designer: 'concepteur de soutenance',
};
export const roleLabelFr = (r: AgentRole): string => ROLE_LABEL_FR[r];

const DEFAULT_TEMPERATURE: Record<AgentRole, number> = {
  orchestrator: 0.3,
  outline_architect: 0.4,
  researcher: 0.2,
  document_analyst: 0.2,
  source_verifier: 0,
  data_analyst: 0.2,
  section_writer: 0.6,
  grounding_checker: 0,
  summarizer: 0.2,
  juror_methodologist: 0.3,
  juror_specialist: 0.3,
  juror_form: 0.2,
  jury_president: 0.2,
  harmonizer: 0.3,
  bibliographer: 0,
  defense_designer: 0.4,
};

export class AgentRegistry {
  private defs = new Map<AgentRole, AgentDefinition>();

  register(def: AgentDefinition): void {
    this.defs.set(def.role, def);
  }

  get(role: AgentRole): AgentDefinition {
    const d = this.defs.get(role);
    if (!d) throw new Error(`Agent non enregistré : ${role}`);
    return d;
  }

  has(role: AgentRole): boolean {
    return this.defs.has(role);
  }
}

/** Agents de démonstration (J2) : un par rôle, sortie générique. Remplacés jalon par jalon (J4–J9). */
export function demoRegistry(): AgentRegistry {
  const reg = new AgentRegistry();
  for (const role of Object.keys(ROLE_LABEL_FR) as AgentRole[]) {
    reg.register({
      role,
      promptVersion: 'demo-1',
      temperature: DEFAULT_TEMPERATURE[role],
      schema: DemoOutputSchema,
      schemaName: 'demo_output',
      systemPrompt: ({ label }) =>
        `Tu es ${roleLabelFr(role)} dans une équipe d'agents qui produit un travail académique en français. ` +
        `Tâche en cours : « ${label} ». Réponds par un court résumé du travail effectué.\n\n${REGLES_INTEGRITE}`,
    });
  }
  return reg;
}
