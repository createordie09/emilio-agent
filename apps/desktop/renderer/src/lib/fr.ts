import { APP_NAME } from '@emilio/shared';

/** Dictionnaire unique des textes d'interface (français). Tout texte visible passe par ici ou par un composant. */
export const fr = {
  app: APP_NAME,
  nav: {
    home: 'Accueil',
    newMission: 'Nouvelle mission',
    missions: 'Mes missions',
    library: 'Bibliothèque de sources',
    settings: 'Paramètres',
    design: 'Design system',
    recent: 'Missions récentes',
    noRecent: "Aucune mission pour l'instant",
    collapse: 'Réduire la barre latérale',
    expand: 'Développer la barre latérale',
  },
  credit: {
    title: 'Crédit OpenRouter',
    unknown: 'Crédit inconnu',
    noKey: "Aucune clé n'est enregistrée",
    topUp: 'Recharger',
    configure: 'Ajouter une clé',
    remaining: 'restant',
  },
  common: {
    cancel: 'Annuler',
    confirm: 'Valider',
    open: 'Ouvrir',
    seeAll: 'Voir tout',
    seeMore: 'Voir plus',
    search: 'Rechercher',
    loading: 'Chargement…',
    close: 'Fermer',
    back: 'Retour',
    soon: 'Bientôt disponible',
    soonText: "Cet écran sera construit dans un prochain jalon de l'application.",
  },
} as const;

/** Formats français. */
export const fmtUsd = (n: number | null | undefined, digits = 2) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(n);

export const fmtInt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

/** Prix par million de jetons (affichage lisible). */
export const fmtPerMillion = (perToken: number | null) =>
  perToken == null ? 'variable' : fmtUsd(perToken * 1_000_000, perToken * 1_000_000 < 1 ? 3 : 2);

/** Durée lisible (« 2 h 15 », « 45 min »). */
export const fmtDuration = (sec: number): string => {
  const min = Math.round(sec / 60);
  if (min < 1) return 'moins d’1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

/** Message d'erreur à afficher : pour une requête refusée par le moteur, le détail (en français) est plus utile que le message générique. */
export const errorText = (e: { code?: string; messageFr: string; detail?: string }): string =>
  e.code === 'E_BAD_REQUEST' && e.detail ? e.detail : e.messageFr;
