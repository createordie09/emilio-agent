import { useNavigate } from 'react-router-dom';
import { FlaskConical, FolderKanban, Plus, Upload } from 'lucide-react';
import {
  ActionCard,
  Button,
  EmptyState,
  Illustration,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { errorText, fmtUsd } from '@/lib/fr';
import { STATUS_FR } from '@/lib/mission-labels';
import { useMissions } from '@/lib/queries';
import { useToasts } from '@/stores/toasts';
import { useUi } from '@/stores/ui';

/** Liste des missions (provisoire en J2 : la création réelle arrive avec le wizard, J3). */
export function MissionsPage() {
  const nav = useNavigate();
  const { data, isLoading } = useMissions();
  const devMode = useUi((s) => s.devMode);
  const push = useToasts((s) => s.push);

  const importMission = async () => {
    const r = await api.ops.importMission();
    if (!r.ok)
      return push({ tone: 'danger', title: 'Import impossible', description: errorText(r.error) });
    if (r.value) {
      push({ tone: 'success', title: 'Mission importée', description: r.value.title });
      nav(`/missions/${r.value.missionId}`);
    }
  };

  const createDemo = async () => {
    const r = await api.missions.createDemo();
    if (!r.ok)
      return push({
        tone: 'danger',
        title: 'Mission factice impossible',
        description: r.error.messageFr,
      });
    nav(`/missions/${r.value.id}`);
  };

  return (
    <>
      <PageHeader
        title="Mes missions"
        breadcrumb={['Mes missions']}
        toolbar={
          <>
            <Button size="sm" onClick={() => nav('/missions/nouvelle')}>
              <Plus className="size-4" />
              Nouvelle mission
            </Button>
            <Button variant="secondary" size="sm" onClick={importMission}>
              <Upload className="size-4" />
              Importer une mission
            </Button>
            {devMode && (
              <Button variant="ink" size="sm" onClick={createDemo}>
                <FlaskConical className="size-4" />
                Lancer une mission factice (mode simulé)
              </Button>
            )}
          </>
        }
      />
      <div className="px-8 pb-8">
        {isLoading && <Skeleton className="h-32" />}
        {data && data.length === 0 && (
          <EmptyState
            icon={FolderKanban}
            title="Aucune mission pour l'instant"
            text="Créez votre première mission avec l'assistant. Le mode développeur permet aussi d'essayer le moteur avec une mission factice, sans aucun coût."
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          {data?.map((m) => {
            const st = STATUS_FR[m.status];
            return (
              <ActionCard
                key={m.id}
                title={m.title}
                meta={`${m.currentPhase ?? '—'} · ${m.tasksDone}/${m.tasksTotal} tâches · ${fmtUsd(m.costSpentUsd, 3)}`}
                illustration={<Illustration icon={FolderKanban} size={64} />}
                onOpen={() => nav(`/missions/${m.id}`)}
              >
                <div className="flex items-center gap-3">
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  <ProgressBar
                    value={m.tasksDone}
                    max={Math.max(1, m.tasksTotal)}
                    className="flex-1"
                    label="Avancement"
                  />
                </div>
              </ActionCard>
            );
          })}
        </div>
      </div>
    </>
  );
}
