import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  FileText,
  GraduationCap,
  Library,
  Microscope,
  Sparkles,
  Briefcase,
  Trash2,
} from 'lucide-react';
import { WORK_TYPE_LABEL_FR, type WorkType } from '@emilio/shared';
import {
  ActionCard,
  Button,
  Composer,
  Illustration,
  QuickActionCard,
  SuggestionChip,
} from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useToasts } from '@/stores/toasts';

const TYPES: { type: WorkType; icon: typeof GraduationCap; text: string }[] = [
  {
    type: 'memoire_master',
    icon: GraduationCap,
    text: 'Un mémoire de recherche ou professionnel complet.',
  },
  {
    type: 'memoire_licence',
    icon: BookOpen,
    text: 'Un mémoire de fin de licence, structuré et sourcé.',
  },
  {
    type: 'rapport_stage',
    icon: Briefcase,
    text: 'Structure d’accueil, déroulement et analyse critique.',
  },
  { type: 'rapport_formation_pro', icon: FileText, text: 'Diagnostic, démarche et plan d’action.' },
  { type: 'these_chapitres', icon: Microscope, text: 'Un ou plusieurs chapitres de thèse.' },
  {
    type: 'revue_litterature',
    icon: Library,
    text: 'Une synthèse documentaire à partir de sources vérifiées.',
  },
];
const EXAMPLES = [
  'Impact du mobile money sur l’inclusion financière',
  'Gestion des ressources humaines dans les PME béninoises',
  'Éducation financière des jeunes entrepreneurs',
];

/** Point d'entrée de « Nouvelle mission » (CdC §6.1.9, REF-B2/E) : thème + type de travail, puis ouverture de l'assistant pré-rempli. */
export function NewMissionPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [titre, setTitre] = React.useState('');
  const [type, setType] = React.useState<WorkType>('memoire_master');
  const [busy, setBusy] = React.useState(false);
  const { data: drafts = [] } = useQuery({
    queryKey: ['drafts'],
    queryFn: async () => {
      const r = await api.drafts.list();
      return r.ok ? r.value : [];
    },
  });

  const start = async (t: WorkType = type, theme = titre) => {
    setBusy(true);
    const r = await api.drafts.create({ workType: t, titre: theme.trim() || undefined });
    setBusy(false);
    if (!r.ok)
      return push({ tone: 'danger', title: 'Création impossible', description: r.error.messageFr });
    void qc.invalidateQueries({ queryKey: ['drafts'] });
    nav(`/missions/nouvelle/${r.value.id}`);
  };
  const drop = async (id: string) => {
    await api.drafts.remove(id);
    void qc.invalidateQueries({ queryKey: ['drafts'] });
  };

  return (
    <div className="mx-auto flex max-w-[820px] flex-col items-center gap-8 px-8 py-12">
      <Illustration icon={Sparkles} size={72} />
      <h1 className="t-display text-center">
        Quel travail lançons-nous <span className="text-primary">aujourd'hui</span> ?
      </h1>
      <Composer
        className="w-full"
        placeholder="Décrivez le thème de votre mémoire…"
        value={titre}
        onChange={setTitre}
        onSubmit={() => void start()}
        loading={busy}
      />
      <div className="grid w-full grid-cols-3 gap-4" role="radiogroup" aria-label="Type de travail">
        {TYPES.map((t) => (
          <div
            key={t.type}
            className={cn(
              'rounded-lg',
              type === t.type && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
            )}
          >
            <QuickActionCard
              icon={t.icon}
              title={WORK_TYPE_LABEL_FR[t.type]}
              description={t.text}
              role="radio"
              aria-checked={type === t.type}
              onClick={() => setType(t.type)}
              className="w-full"
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <SuggestionChip key={e} onClick={() => setTitre(e)}>
            {e}
          </SuggestionChip>
        ))}
      </div>
      <Button size="lg" loading={busy} onClick={() => void start()}>
        Ouvrir l'assistant
      </Button>

      {drafts.length > 0 && (
        <section className="w-full space-y-3">
          <h2 className="t-h2">Brouillons en cours</h2>
          <div className="grid grid-cols-2 gap-4">
            {drafts.map((d) => (
              <ActionCard
                key={d.id}
                title={d.title}
                meta={d.workType ? WORK_TYPE_LABEL_FR[d.workType] : 'Brouillon'}
                actionLabel="Reprendre"
                onOpen={() => nav(`/missions/nouvelle/${d.id}`)}
              >
                <button
                  type="button"
                  onClick={() => void drop(d.id)}
                  className="t-small flex cursor-pointer items-center gap-1 text-text-muted hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                  Supprimer
                </button>
              </ActionCard>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
