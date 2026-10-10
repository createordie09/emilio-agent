import { z } from 'zod';

/** Brief de mission (CdC §7.1), validé par zod côté moteur et côté interface. */
export const WORK_TYPES = [
  'memoire_licence',
  'memoire_master',
  'these_chapitres',
  'rapport_stage',
  'rapport_formation_pro',
  'projet_pro',
  'article',
  'revue_litterature',
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABEL_FR: Record<WorkType, string> = {
  memoire_licence: 'Mémoire de licence',
  memoire_master: 'Mémoire de master',
  these_chapitres: 'Thèse de doctorat (chapitres)',
  rapport_stage: 'Rapport de stage',
  rapport_formation_pro: 'Rapport de fin de formation professionnelle',
  projet_pro: 'Projet professionnel',
  article: 'Article scientifique',
  revue_litterature: 'Revue de littérature seule',
};

export const LIMINAIRES = [
  'pageGarde',
  'sommaire',
  'dedicace',
  'remerciements',
  'sigles',
  'listeTableaux',
  'listeFigures',
  'resume',
  'abstract',
  'avertissement',
] as const;
export type Liminaire = (typeof LIMINAIRES)[number];

export const LIMINAIRE_LABEL_FR: Record<Liminaire, string> = {
  pageGarde: 'Page de garde',
  sommaire: 'Sommaire',
  dedicace: 'Dédicace',
  remerciements: 'Remerciements',
  sigles: 'Sigles et abréviations',
  listeTableaux: 'Liste des tableaux',
  listeFigures: 'Liste des figures',
  resume: 'Résumé',
  abstract: 'Abstract (anglais)',
  avertissement: 'Avertissement',
};

const str = z.string().trim();
const strList = z.array(str.min(1)).default([]);

export const BriefSchema = z.object({
  workType: z.enum(WORK_TYPES),
  exigence: z.enum(['standard', 'eleve', 'tres_eleve']).default('standard'),
  discipline: str.min(1, 'Indiquez la discipline.'),
  specialite: str.optional(),
  titre: str.min(3, 'Indiquez le thème ou le titre provisoire.'),
  problematique: str.optional(),
  problematiqueAProposer: z.boolean().default(false),
  questionsRecherche: strList,
  objectifGeneral: str.optional(),
  objectifsSpecifiques: strList,
  hypotheses: strList,
  terrain: z
    .object({
      pays: str.optional(),
      ville: str.optional(),
      structure: str.optional(),
      periode: str.optional(),
    })
    .optional(),
  approche: z
    .enum(['quantitative', 'qualitative', 'mixte', 'documentaire', 'a_proposer'])
    .default('a_proposer'),
  motsCles: z.array(str.min(1)).max(10, 'Dix mots-clés au maximum.').default([]),
  etablissement: z
    .object({ nom: str.optional(), faculte: str.optional(), anneeAcademique: str.optional() })
    .optional(),
  auteur: z
    .object({ nom: str.optional(), directeur: str.optional(), maitreStage: str.optional() })
    .optional(),
  longueur: z
    .object({
      unite: z.enum(['pages', 'mots']),
      min: z.number().int().positive(),
      max: z.number().int().positive(),
    })
    .refine((l) => l.max >= l.min, { message: 'Le maximum doit être supérieur au minimum.' }),
  structure: z.object({
    mode: z.enum(['standard', 'personnalisee', 'importee']).default('standard'),
  }),
  liminaires: z.record(z.enum(LIMINAIRES), z.boolean()),
  criteresJury: str.optional(),
  profilNormesId: str.optional(),
  styleCitation: z.enum(['auteur_date', 'notes']).optional(),
  mise_en_page: z
    .object({
      police: str.optional(),
      taille: z.number().positive().optional(),
      interligne: z.number().positive().optional(),
      margeCm: z.number().positive().optional(),
    })
    .optional(),
  livrables: z.object({
    docx: z.boolean(),
    pdf: z.boolean(),
    pptx: z.boolean(),
    nbDiapos: z.number().int().min(5).max(60).optional(),
    fichePreparation: z.boolean(),
    rapportMission: z.boolean(),
  }),
  collecte: z
    .object({
      echantillon: str.optional(),
      mode: str.optional(),
      periode: str.optional(),
      outil: str.optional(),
    })
    .optional(),
  instructionsLibres: str.optional(),
  /** Réglages d'exécution choisis à l'étape 6 (§6.4, §7.6) ; les modèles viennent d'un préréglage ou du choix manuel. */
  execution: z
    .object({
      preset: str.optional(),
      budgetMaxUsd: z.number().positive().optional(),
      parallelism: z.number().int().min(1).max(8).default(3),
      rondesMaxParChapitre: z.number().int().min(1).max(6).default(3),
      rondesMaxGlobales: z.number().int().min(0).max(4).default(2),
      seuilJury: z.number().min(0).max(20).optional(),
      profondeurRecherche: z.enum(['rapide', 'normale', 'approfondie']).default('normale'),
      minSourcesTotal: z.number().int().min(0).optional(),
      preferenceSources: z.enum(['toutes', 'afrique', 'recentes']).default('toutes'),
      models: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export type Brief = z.infer<typeof BriefSchema>;
/** Brouillon : tout est facultatif tant que l'assistant n'est pas terminé (enregistrement automatique). */
export type BriefDraft = Partial<Brief>;
export const BriefDraftSchema = BriefSchema.partial();

export const WIZARD_STEPS = [
  'Type de travail',
  'Sujet',
  'Établissement',
  'Normes et format',
  'Documents',
  'Exécution',
  'Récapitulatif',
] as const;

/** Valeurs par défaut d'un nouveau brief (modifiables dans l'assistant). */
export function defaultBrief(workType: WorkType = 'memoire_master'): BriefDraft {
  const pages =
    workType === 'memoire_licence' ? [35, 50] : workType === 'rapport_stage' ? [25, 40] : [60, 90];
  return {
    workType,
    exigence: 'standard',
    problematiqueAProposer: false,
    questionsRecherche: [],
    objectifsSpecifiques: [],
    hypotheses: [],
    approche: 'a_proposer',
    motsCles: [],
    longueur: { unite: 'pages', min: pages[0]!, max: pages[1]! },
    structure: { mode: 'standard' },
    liminaires: {
      pageGarde: true,
      sommaire: true,
      dedicace: true,
      remerciements: true,
      sigles: true,
      listeTableaux: true,
      listeFigures: true,
      resume: true,
      abstract: false,
      avertissement: false,
    },
    livrables: {
      docx: true,
      pdf: true,
      pptx: false,
      nbDiapos: 15,
      fichePreparation: false,
      rapportMission: true,
    },
    execution: {
      parallelism: 3,
      rondesMaxParChapitre: 3,
      rondesMaxGlobales: 2,
      profondeurRecherche: 'normale',
      preferenceSources: 'toutes',
    },
  };
}

/** Validation par étape de l'assistant (§6.4) : retourne les messages d'erreur en français. */
export function validateStep(step: number, b: BriefDraft): string[] {
  const errs: string[] = [];
  const need = (cond: unknown, msg: string) => cond || errs.push(msg);
  switch (step) {
    case 0:
      need(b.workType, 'Choisissez un type de travail.');
      need(b.discipline?.trim(), 'Indiquez la discipline.');
      break;
    case 1:
      need((b.titre ?? '').trim().length >= 3, 'Indiquez le thème ou le titre provisoire.');
      need(
        (b.problematique ?? '').trim() || b.problematiqueAProposer,
        'Indiquez la problématique, ou demandez à l’agent de vous aider à la formuler.',
      );
      need((b.motsCles?.length ?? 0) <= 10, 'Dix mots-clés au maximum.');
      break;
    case 2:
      need(
        b.longueur && b.longueur.min > 0 && b.longueur.max >= b.longueur.min,
        'Indiquez une longueur valide (le maximum doit dépasser le minimum).',
      );
      break;
    case 3:
      need(
        b.livrables && (b.livrables.docx || b.livrables.pdf || b.livrables.pptx),
        'Choisissez au moins un livrable (Word, PDF ou diaporama).',
      );
      break;
    case 5:
      need((b.execution?.budgetMaxUsd ?? 0) > 0, 'Indiquez un budget maximal en dollars.');
      break;
    default:
      break;
  }
  return errs;
}

/**
 * Avertissement bloquant §7.3 : approche empirique sans données de terrain.
 * À confirmer à l'étape 7 ; le chapitre « résultats » sera remplacé par des emplacements [DONNÉES À INSÉRER].
 */
export function needsFieldDataWarning(b: BriefDraft, fieldDataFiles: number): boolean {
  return (
    !!b.approche && !['documentaire', 'a_proposer'].includes(b.approche) && fieldDataFiles === 0
  );
}
