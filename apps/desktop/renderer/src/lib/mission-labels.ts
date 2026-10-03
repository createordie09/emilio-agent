import type { AgentRole, MissionStatus, Phase } from '@emilio/shared';

export const STATUS_FR: Record<
  MissionStatus,
  { label: string; tone: 'neutral' | 'info' | 'primary' | 'warning' | 'success' | 'danger' }
> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  briefing: { label: 'Brief', tone: 'info' },
  planning: { label: 'Planification', tone: 'info' },
  awaiting_plan_validation: { label: 'Plan à valider', tone: 'warning' },
  running: { label: 'En cours', tone: 'primary' },
  paused: { label: 'En pause', tone: 'warning' },
  paused_no_credit: { label: 'Crédit épuisé', tone: 'danger' },
  paused_network: { label: 'Réseau coupé', tone: 'warning' },
  paused_budget: { label: 'Budget atteint', tone: 'warning' },
  failed: { label: 'En échec', tone: 'danger' },
  completed: { label: 'Terminée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};

export const PHASES: { id: Phase; label: string }[] = [
  { id: 'P0', label: 'Préparation' },
  { id: 'P1', label: 'Cadrage' },
  { id: 'P2', label: 'Plan' },
  { id: 'P3', label: 'Recherche' },
  { id: 'P4', label: 'Données' },
  { id: 'P5', label: 'Rédaction' },
  { id: 'P6', label: 'Jury' },
  { id: 'P7', label: 'Harmonisation' },
  { id: 'P8', label: 'Mise en forme' },
  { id: 'P9', label: 'Livrables' },
];

/** Icône d'avatar (clé de ROLE_ICONS) selon le rôle d'agent. */
export function avatarRole(role: AgentRole | 'local' | null): string {
  if (!role || role === 'local') return 'launch';
  if (role === 'researcher') return 'researcher';
  if (role === 'section_writer') return 'writer';
  if (role.startsWith('juror') || role === 'jury_president') return 'jury';
  if (role === 'source_verifier' || role === 'grounding_checker') return 'verifier';
  if (role === 'document_analyst' || role === 'data_analyst') return 'analyst';
  if (role === 'outline_architect') return 'architect';
  return 'launch';
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (Math.abs(s) < 60) return rtf.format(s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
