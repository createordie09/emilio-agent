import type { Brief, BriefDraft, WorkType } from './brief';
import type { AgentRole } from './constants';
import type { MissionFileInfo } from './files';

export type DraftSummary = {
  id: string;
  title: string;
  workType: WorkType | null;
  updatedAt: string;
};

export type DraftDetail = {
  id: string;
  status: string;
  brief: BriefDraft;
  files: MissionFileInfo[];
  updatedAt: string;
};

export type AddFileResult = { filename: string; file?: MissionFileInfo; errorFr?: string };

export type PresetInfo = {
  id: string;
  label: string;
  description: string;
  models: Record<AgentRole, string>;
  /** Modèles du préréglage absents de la liste OpenRouter actuelle (§14.3 : à signaler et remplacer). */
  missing: string[];
};

export type NormsProfileInfo = {
  id: string;
  name: string;
  description: string;
  citationMode: 'auteur_date' | 'notes';
  layout: {
    font: string;
    fontSize: number;
    lineSpacing: number;
    marginCm: number;
    justify: boolean;
  };
  exampleCitation: string;
  exampleReference: string;
};

export type FinalizeOptions = { confirmNoFieldData?: boolean };

export type { Brief };
