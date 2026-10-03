import type { AgentRole, MissionStatus } from './constants';

export type TaskStatus =
  'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';
export type EventLevel = 'info' | 'success' | 'warning' | 'error';
export type Phase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9';

export type MissionSummary = {
  id: string;
  title: string;
  status: MissionStatus;
  currentPhase: Phase | null;
  costSpentUsd: number;
  budgetMaxUsd: number | null;
  /** Mission exécutée avec le client simulé (aucun appel payant). */
  simulated: boolean;
  tasksTotal: number;
  tasksDone: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  error: { code: string; messageFr: string } | null;
};

export type TaskSummary = {
  id: string;
  phase: Phase;
  agentRole: AgentRole | 'local';
  label: string;
  status: TaskStatus;
  attempts: number;
  costUsd: number;
  model: string | null;
};

export type MissionDetail = MissionSummary & { tasks: TaskSummary[] };

/** Événement du journal utilisateur (CdC §5.13), message en français. */
export type MissionEvent = {
  id: string;
  missionId: string | null;
  level: EventLevel;
  agentRole: AgentRole | 'local' | null;
  messageFr: string;
  createdAt: string;
};
