import type { AgentRole } from '@emilio/shared';
import { AGENT_ROLES } from '@emilio/shared';
import type { MissionRepo } from '../storage/missions';
import type { NewTask, QueueAdapter } from '../queue/queue';
import type { MissionExecConfig } from '../llm/exec-config';
import type { EventJournal } from '../events/journal';

/** Étiquette (et non identifiant réel) du faux modèle utilisé en mode simulé. */
export const MOCK_MODEL_ID = 'simule/modele-de-demonstration';

export function demoTasks(chapters = 3): NewTask[] {
  const t: NewTask[] = [
    {
      key: 'p0.ingest',
      phase: 'P0',
      agentRole: 'local',
      label: 'Préparation des fichiers',
      input: { handler: 'demo.ingest' },
    },
    {
      key: 'p1.cadrage',
      phase: 'P1',
      agentRole: 'orchestrator',
      label: 'Cadrage de la mission',
      dependsOnKeys: ['p0.ingest'],
    },
    {
      key: 'p2.plan',
      phase: 'P2',
      agentRole: 'outline_architect',
      label: 'Proposition du plan',
      dependsOnKeys: ['p1.cadrage'],
    },
  ];
  for (let i = 1; i <= chapters; i++) {
    t.push({
      key: `p3.recherche.${i}`,
      phase: 'P3',
      agentRole: 'researcher',
      label: `Recherche — chapitre ${i}`,
      dependsOnKeys: ['p2.plan'],
    });
  }
  for (let i = 1; i <= chapters; i++) {
    t.push({
      key: `p5.redaction.${i}`,
      phase: 'P5',
      agentRole: 'section_writer',
      label: `Rédaction — chapitre ${i}`,
      dependsOnKeys: [`p3.recherche.${i}`],
    });
  }
  const writers = Array.from({ length: chapters }, (_, i) => `p5.redaction.${i + 1}`);
  const jurors: [string, AgentRole, string][] = [
    ['p6.jure.methodo', 'juror_methodologist', 'Jury — méthodologie'],
    ['p6.jure.specialiste', 'juror_specialist', 'Jury — spécialité'],
    ['p6.jure.forme', 'juror_form', 'Jury — forme'],
  ];
  for (const [key, role, label] of jurors)
    t.push({ key, phase: 'P6', agentRole: role, label, dependsOnKeys: writers });
  t.push({
    key: 'p6.president',
    phase: 'P6',
    agentRole: 'jury_president',
    label: 'Synthèse du jury',
    dependsOnKeys: jurors.map((j) => j[0]),
  });
  t.push({
    key: 'p7.harmonisation',
    phase: 'P7',
    agentRole: 'harmonizer',
    label: 'Harmonisation globale',
    dependsOnKeys: ['p6.president'],
  });
  t.push({
    key: 'p8.biblio',
    phase: 'P8',
    agentRole: 'bibliographer',
    label: 'Bibliographie',
    dependsOnKeys: ['p7.harmonisation'],
  });
  t.push({
    key: 'p9.soutenance',
    phase: 'P9',
    agentRole: 'defense_designer',
    label: 'Préparation de la soutenance',
    dependsOnKeys: ['p8.biblio'],
  });
  return t;
}

/**
 * Mission factice de bout en bout (CdC §22 J2) : traverse toute la machine à états
 * (draft → … → running) puis P0 → P9 avec le client simulé. Aucun appel payant.
 */
export function createDemoMission(
  d: { missions: MissionRepo; queue: QueueAdapter; journal: EventJournal },
  opts: { budgetUsd?: number; parallelism?: number; title?: string } = {},
): string {
  const models = Object.fromEntries(
    AGENT_ROLES.map((r) => [r, MOCK_MODEL_ID]),
  ) as MissionExecConfig['models'];
  const config: MissionExecConfig = {
    llmMode: 'mock',
    models,
    budgetMaxUsd: opts.budgetUsd ?? 5,
    parallelism: opts.parallelism ?? 3,
    estimateCallUsd: 0.002,
  };
  const id = d.missions.create({
    title: opts.title ?? 'Mission de démonstration (mode simulé)',
    config,
  });
  d.queue.enqueue(id, demoTasks());
  d.missions.transition(id, 'briefing', { reason: 'Brief enregistré.' });
  d.missions.transition(id, 'planning', { reason: 'Planification en cours.' });
  d.missions.transition(id, 'awaiting_plan_validation', {
    reason: 'Plan prêt : en attente de validation (validé automatiquement en démonstration).',
  });
  return id;
}
