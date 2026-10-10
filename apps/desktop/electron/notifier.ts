import type { MissionStatus, MissionSummary } from '@emilio/shared';

export type Notice = { title: string; body: string };

/**
 * Notifications système (CdC §6.9) : plan prêt, mission terminée, mission en pause (crédit, réseau, budget), erreur fatale.
 * Fonction pure : renvoie la notification à afficher quand le statut d'une mission change, sinon rien.
 */
export function noticeFor(prev: MissionStatus | undefined, m: MissionSummary): Notice | null {
  if (prev === m.status) return null;
  const t = m.title;
  switch (m.status) {
    case 'awaiting_plan_validation':
      return {
        title: 'Plan prêt',
        body: `Le plan de « ${t} » est prêt : relisez-le puis validez-le.`,
      };
    case 'completed':
      return {
        title: 'Mission terminée',
        body: `« ${t} » est terminé : vos livrables sont prêts.`,
      };
    case 'paused_no_credit':
      return {
        title: 'Mission en pause',
        body: `Crédit OpenRouter épuisé pour « ${t} ». Rechargez votre compte : la mission reprendra seule.`,
      };
    case 'paused_network':
      return {
        title: 'Mission en pause',
        body: `Connexion Internet perdue pour « ${t} ». Elle reprendra dès son retour.`,
      };
    case 'paused_budget':
      return {
        title: 'Budget atteint',
        body: `Le budget de « ${t} » est atteint : relevez-le ou finalisez avec l’état actuel.`,
      };
    case 'failed':
      return {
        title: 'Erreur',
        body: `« ${t} » s’est arrêté sur une erreur. Ouvrez la mission pour réessayer.`,
      };
    default:
      return null;
  }
}

/** Mémorise le dernier statut vu par mission : pas de notification au premier événement (état déjà connu au démarrage). */
export class StatusWatcher {
  private seen = new Map<string, MissionStatus>();
  update(m: MissionSummary): Notice | null {
    const prev = this.seen.get(m.id);
    this.seen.set(m.id, m.status);
    return prev === undefined ? null : noticeFor(prev, m);
  }
  seed(missions: MissionSummary[]): void {
    for (const m of missions) this.seen.set(m.id, m.status);
  }
}
