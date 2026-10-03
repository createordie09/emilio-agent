/** Nom d'affichage de l'application — unique point de définition (ADR-001). */
export const APP_NAME = 'emilio agent';
export const APP_ID = 'emilio-agent';

/** Rôles d'agents (CdC §10.2). */
export const AGENT_ROLES = [
  'orchestrator',
  'outline_architect',
  'researcher',
  'document_analyst',
  'source_verifier',
  'data_analyst',
  'section_writer',
  'grounding_checker',
  'summarizer',
  'juror_methodologist',
  'juror_specialist',
  'juror_form',
  'jury_president',
  'harmonizer',
  'bibliographer',
  'defense_designer',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Statuts de mission (CdC §5.2). */
export const MISSION_STATUSES = [
  'draft',
  'briefing',
  'planning',
  'awaiting_plan_validation',
  'running',
  'paused',
  'paused_no_credit',
  'paused_network',
  'paused_budget',
  'failed',
  'completed',
  'cancelled',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const THEMES = ['clair', 'sombre', 'systeme'] as const;
export type ThemePreference = (typeof THEMES)[number];
