import type { AgentRole } from '@emilio/shared';

export const ROLE_LABEL_FR: Record<AgentRole, string> = {
  orchestrator: 'Orchestrateur (directeur de recherche)',
  outline_architect: 'Architecte du plan',
  researcher: 'Chercheur documentaire',
  document_analyst: 'Analyste de documents',
  source_verifier: 'Vérificateur de sources',
  data_analyst: 'Analyste de données',
  section_writer: 'Rédacteur de section',
  grounding_checker: "Vérificateur d'ancrage",
  summarizer: 'Résumeur',
  juror_methodologist: 'Juré méthodologiste',
  juror_specialist: 'Juré spécialiste',
  juror_form: 'Juré forme',
  jury_president: 'Président du jury',
  harmonizer: 'Harmonisateur',
  bibliographer: 'Bibliographe',
  defense_designer: 'Concepteur de soutenance',
};
export const roleLabelFr = (r: AgentRole): string => ROLE_LABEL_FR[r];
