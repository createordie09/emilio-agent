import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  CircleDashed,
  Coins,
  ListChecks,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
  Wifi,
  WifiOff,
  Wallet,
  Zap,
} from 'lucide-react';
import type { MissionDetail, TaskSummary } from '@emilio/shared';
import {
  ActivityFeed,
  Button,
  IconBubble,
  KpiCard,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusBadge,
  Stepper,
  type ActivityItem,
} from '@/components/ui';
import { api } from '@/lib/api';
import { fmtUsd } from '@/lib/fr';
import { avatarRole, PHASES, relativeTime, STATUS_FR } from '@/lib/mission-labels';
import { useMission, useMissionEvents } from '@/lib/queries';
import { useToasts } from '@/stores/toasts';
import { useUi } from '@/stores/ui';
import { SourcesPanel } from '@/components/SourcesPanel';

const TASK_ICON: Record<TaskSummary['status'], { icon: typeof CheckCircle2; cls: string }> = {
  done: { icon: CheckCircle2, cls: 'text-success' },
  running: { icon: Loader2, cls: 'text-primary animate-[spin_1.2s_linear_infinite]' },
  ready: { icon: CircleDashed, cls: 'text-info' },
  pending: { icon: CircleDashed, cls: 'text-text-subtle' },
  blocked: { icon: TriangleAlert, cls: 'text-warning' },
  failed: { icon: TriangleAlert, cls: 'text-danger' },
  skipped: { icon: CircleDashed, cls: 'text-text-subtle' },
};

/** Phase en cours → index dans la frise ; phases entièrement faites = cochées. */
function phaseIndex(m: MissionDetail): number {
  if (m.status === 'completed') return PHASES.length;
  const done = (p: string) => {
    const t = m.tasks.filter((x) => x.phase === p);
    return t.length > 0 && t.every((x) => x.status === 'done');
  };
  const first = PHASES.findIndex((p) => m.tasks.some((t) => t.phase === p.id) && !done(p.id));
  return first < 0 ? 0 : first;
}

/** Dashboard minimal de mission (J2) : état, frise des phases, indicateurs, tâches, flux d'événements en direct. */
export function MissionPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: m } = useMission(id);
  const { data: events } = useMissionEvents(id ?? null);
  const devMode = useUi((s) => s.devMode);
  const push = useToasts((s) => s.push);

  if (!m)
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );

  const act = (f: () => Promise<{ ok: boolean; error?: { messageFr: string } }>) => async () => {
    const r = await f();
    if (!r.ok)
      push({ tone: 'danger', title: 'Action impossible', description: r.error?.messageFr });
  };
  const st = STATUS_FR[m.status];
  const canPause = m.status === 'running';
  const canResume = m.status.startsWith('paused');
  const canCancel = !['completed', 'cancelled', 'draft'].includes(m.status);
  const budgetRatio = m.budgetMaxUsd ? m.costSpentUsd / m.budgetMaxUsd : 0;
  const items: ActivityItem[] = [...(events ?? [])].reverse().map((e) => ({
    id: e.id,
    role: avatarRole(e.agentRole),
    title:
      e.level === 'warning'
        ? 'Attention'
        : e.level === 'error'
          ? 'Erreur'
          : e.level === 'success'
            ? 'Terminé'
            : 'Information',
    description: e.messageFr,
    time: relativeTime(e.createdAt),
  }));

  return (
    <>
      <PageHeader
        title={m.title}
        breadcrumb={['Mes missions', m.title]}
        onBack={() => nav('/missions')}
        actions={
          <>
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            {canPause && (
              <Button variant="secondary" size="sm" onClick={act(() => api.missions.pause(m.id))}>
                <Pause className="size-4" />
                Pause
              </Button>
            )}
            {canResume && (
              <Button size="sm" onClick={act(() => api.missions.resume(m.id))}>
                <Play className="size-4" />
                Reprendre
              </Button>
            )}
            {m.status === 'failed' && (
              <Button size="sm" onClick={act(() => api.missions.retry(m.id))}>
                <RotateCcw className="size-4" />
                Réessayer
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" size="sm" onClick={act(() => api.missions.cancel(m.id))}>
                <Square className="size-4" />
                Annuler
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6 px-8 pb-8">
        {m.error && (
          <p role="alert" className="t-small rounded-md bg-danger-soft p-3 text-danger">
            {m.error.messageFr}
          </p>
        )}
        {m.status === 'briefing' && (
          <p role="status" className="t-small rounded-md bg-primary-softer p-3 text-text-muted">
            Votre brief est enregistré et vos documents sont indexés. La génération du plan arrive
            au prochain jalon de l'application.
          </p>
        )}
        <Stepper
          steps={PHASES.map((p) => p.label)}
          current={phaseIndex(m)}
          className="overflow-x-auto pb-1"
        />

        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            icon={<IconBubble icon={ListChecks} size={44} />}
            value={`${m.tasksDone} / ${m.tasksTotal}`}
            label="Tâches terminées"
          />
          <KpiCard
            icon={<IconBubble icon={Coins} size={44} />}
            value={fmtUsd(m.costSpentUsd, 3)}
            label="Coût de la mission"
            active
          />
          <KpiCard
            icon={<IconBubble icon={Wallet} size={44} />}
            value={m.budgetMaxUsd ? fmtUsd(m.budgetMaxUsd) : '—'}
            label="Budget maximal"
          />
          <KpiCard
            icon={<IconBubble icon={Zap} size={44} />}
            value={m.currentPhase ?? '—'}
            label="Phase actuelle"
          />
        </div>
        {m.budgetMaxUsd ? (
          <ProgressBar
            value={budgetRatio * 100}
            tone={budgetRatio >= 0.8 ? 'warning' : 'primary'}
            label="Budget utilisé"
          />
        ) : null}

        <div className="grid grid-cols-5 gap-6">
          <section className="col-span-3 space-y-3">
            <h2 className="t-h2">Tâches</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {m.tasks.map((t) => {
                const I = TASK_ICON[t.status];
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-primary-softer"
                  >
                    <I.icon
                      className={`size-4 shrink-0 ${I.cls}`}
                      strokeWidth={1.75}
                      aria-label={t.status}
                    />
                    <span className="t-caption w-8 shrink-0 text-text-subtle">{t.phase}</span>
                    <span className="t-small min-w-0 flex-1 truncate">{t.label}</span>
                    {t.attempts > 0 && (
                      <StatusBadge tone="warning">{t.attempts} essai(s) raté(s)</StatusBadge>
                    )}
                    <span className="t-caption tabular w-16 text-right text-text-subtle">
                      {t.costUsd ? fmtUsd(t.costUsd, 3) : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="col-span-2 h-[420px] rounded-lg border border-border p-5">
            <ActivityFeed title="Activité en direct" items={items} />
          </div>
        </div>

        <SourcesPanel missionId={m.id} simulated={m.simulated} />

        {devMode && (
          <section className="space-y-3 rounded-lg border border-dashed border-border p-5">
            <h2 className="t-h3">Pannes simulées (mode développeur)</h2>
            <p className="t-small text-text-muted">
              Pour vérifier la pause et la reprise automatiques sans rien dépenser.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={act(() => api.missions.simulate('no_credit'))}
              >
                <Wallet className="size-4" />
                Crédit épuisé
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={act(() => api.missions.simulate('recharge'))}
              >
                Recharger le crédit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={act(() => api.missions.simulate('offline'))}
              >
                <WifiOff className="size-4" />
                Couper le réseau
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={act(() => api.missions.simulate('online'))}
              >
                <Wifi className="size-4" />
                Rétablir le réseau
              </Button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
