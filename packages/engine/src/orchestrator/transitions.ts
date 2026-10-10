import { AppError, MISSION_STATUSES, type MissionStatus } from '@emilio/shared';

/** Table des transitions autorisées (CdC §8.1). Toute autre transition est refusée. */
export const TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  draft: ['briefing', 'cancelled'],
  briefing: ['planning', 'draft', 'cancelled'],
  planning: [
    'awaiting_plan_validation',
    'failed',
    'cancelled',
    'paused_no_credit',
    'paused_network',
  ],
  awaiting_plan_validation: ['planning', 'running', 'cancelled'],
  running: [
    'completed',
    'paused',
    'paused_no_credit',
    'paused_network',
    'paused_budget',
    'failed',
    'cancelled',
  ],
  paused: ['running', 'cancelled'],
  paused_no_credit: ['running', 'cancelled', 'paused'],
  paused_network: ['running', 'cancelled', 'paused'],
  // Budget atteint : reprendre (budget relevé) ou finaliser (§8.6) ; la finalisation repasse par running.
  paused_budget: ['running', 'cancelled'],
  failed: ['running', 'cancelled'], // « Réessayer à partir de cette étape »
  completed: [],
  cancelled: [],
};

export const canTransition = (from: MissionStatus, to: MissionStatus): boolean =>
  TRANSITIONS[from].includes(to);

export function assertTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('E_INTERNAL', `Transition interdite : ${from} → ${to}`);
  }
}

export const isTerminal = (s: MissionStatus): boolean => TRANSITIONS[s].length === 0;
export const isPaused = (s: MissionStatus): boolean => s.startsWith('paused');
export const ALL_STATUSES = MISSION_STATUSES;
