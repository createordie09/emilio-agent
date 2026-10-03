import * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Folder,
  MoreHorizontal,
  PanelRightClose,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { fr } from '@/lib/fr';
import { Button } from './button';
import { ProgressBar } from './feedback';

export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false;
  const [m, setM] = React.useState(get);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** Logo provisoire (emplacement, CdC §6.1.6) : tuile violette + étincelle. */
export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-md text-white shadow-glow"
        style={{ background: 'var(--primary-gradient)' }}
        aria-hidden
      >
        <Sparkles className="size-[18px]" strokeWidth={1.75} />
      </span>
      {!collapsed && <span className="t-h2 whitespace-nowrap">{fr.app}</span>}
    </div>
  );
}

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

/** Sidebar : fond surface-muted, bouton principal, navigation, récents, pied (carte crédit + paramètres). */
export function Sidebar({
  nav,
  footerNav,
  recent,
  onNewMission,
  collapsed,
  onToggle,
  credit,
  className,
}: {
  nav: NavItem[];
  footerNav?: NavItem[];
  recent?: { id: string; title: string; to?: string }[];
  onNewMission?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
  credit?: React.ReactNode;
  className?: string;
}) {
  const link = (n: NavItem) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.end}
      title={collapsed ? n.label : undefined}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-md px-3 t-small font-medium transition-colors duration-150',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary-strong text-on-primary shadow-sm'
            : 'text-text-muted hover:bg-primary-softer hover:text-primary-strong',
        )
      }
    >
      <n.icon className="size-[18px] shrink-0" strokeWidth={1.75} />
      {!collapsed && <span className="truncate">{n.label}</span>}
    </NavLink>
  );
  return (
    <aside
      className={cn(
        'flex h-full flex-col gap-5 bg-surface-muted p-4 transition-[width] duration-200 ease-soft',
        collapsed ? 'w-[72px]' : 'w-[248px]',
        className,
      )}
    >
      <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        <Logo collapsed={collapsed} />
        {!collapsed && onToggle && (
          <Button variant="ghost" size="sm" icon onClick={onToggle} aria-label={fr.nav.collapse}>
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>
      {collapsed && onToggle && (
        <Button
          variant="ghost"
          size="sm"
          icon
          className="self-center"
          onClick={onToggle}
          aria-label={fr.nav.expand}
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      )}
      <button
        type="button"
        onClick={onNewMission}
        title={collapsed ? fr.nav.newMission : undefined}
        className={cn(
          'flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary-strong t-small font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover hover:shadow-glow active:scale-[0.98]',
        )}
      >
        <Plus className="size-4" strokeWidth={2.25} />
        {!collapsed && fr.nav.newMission}
      </button>
      <nav className="flex flex-col gap-1" aria-label="Navigation principale">
        {nav.map(link)}
      </nav>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="t-caption mb-2 px-3 text-text-subtle">{fr.nav.recent}</p>
          {recent && recent.length > 0 ? (
            <ul className="space-y-0.5">
              {recent.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <NavLink
                    to={r.to ?? '/missions'}
                    className="flex h-9 items-center gap-3 rounded-md px-3 t-small text-text-muted hover:bg-primary-softer hover:text-primary-strong"
                  >
                    <Clock className="size-4 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{r.title}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-small px-3 text-text-subtle">{fr.nav.noRecent}</p>
          )}
        </div>
      )}
      {collapsed && <div className="flex-1" />}
      {!collapsed && credit}
      <nav className="flex flex-col gap-1">{footerNav?.map(link)}</nav>
    </aside>
  );
}

/** Carte « Crédit OpenRouter » en verre (REF-E4, remplace « Upgrade »). */
export function CreditCard({
  amount,
  ratio,
  note,
  actionLabel,
  onAction,
}: {
  amount: string;
  ratio?: number;
  note?: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <div className="glass space-y-2.5 rounded-lg p-4 shadow-sm">
      <p className="t-caption text-text-muted">{fr.credit.title}</p>
      <p className="t-kpi">{amount}</p>
      {ratio !== undefined && <ProgressBar value={ratio * 100} label="Crédit restant" />}
      {note && <p className="t-caption text-text-subtle">{note}</p>}
      <button
        onClick={onAction}
        className="t-small cursor-pointer font-medium text-primary hover:text-primary-hover"
      >
        {actionLabel}
      </button>
    </div>
  );
}

/**
 * AppShell : fond dégradé + conteneur blanc arrondi 24 px ; grille sidebar | contenu | panneau droit
 * (repliable ; < 1280 px : tiroir). Barre latérale réduite < 1100 px.
 */
export function AppShell({
  sidebar,
  children,
  panel,
  panelOpen = true,
  onPanelToggle,
  className,
}: {
  sidebar: (collapsed: boolean, toggle: () => void) => React.ReactNode;
  children: React.ReactNode;
  panel?: React.ReactNode;
  panelOpen?: boolean;
  onPanelToggle?: () => void;
  className?: string;
}) {
  const narrow = useMediaQuery('(max-width: 1099px)');
  const compactPanel = useMediaQuery('(max-width: 1279px)');
  const [userCollapsed, setUserCollapsed] = React.useState(false);
  const collapsed = narrow || userCollapsed;
  return (
    <div className="h-full p-3 max-[0px]:p-0">
      <div
        className={cn(
          'relative flex h-full overflow-hidden rounded-2xl bg-surface shadow-lg',
          className,
        )}
      >
        <div className="shrink-0 border-r border-border">
          {sidebar(collapsed, () => setUserCollapsed((c) => !c))}
        </div>
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        {panel && panelOpen && (
          <div
            className={cn(
              'shrink-0 border-l border-border bg-surface',
              compactPanel ? 'absolute inset-y-0 right-0 z-30 w-[320px] shadow-lg' : 'w-[320px]',
            )}
          >
            <div className="flex h-full flex-col p-6">
              {onPanelToggle && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  className="mb-2 self-end"
                  onClick={onPanelToggle}
                  aria-label="Replier le panneau"
                >
                  <PanelRightClose className="size-4" />
                </Button>
              )}
              {panel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** PageHeader : retour, fil d'Ariane, actions, titre h1, rangée recherche / filtres / bouton principal (REF-C1). */
export function PageHeader({
  title,
  breadcrumb,
  actions,
  toolbar,
  onBack,
  className,
}: {
  title: string;
  breadcrumb?: string[];
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  onBack?: () => void;
  className?: string;
}) {
  return (
    <header className={cn('space-y-4 px-8 pt-6 pb-4', className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 t-small text-text-muted">
          {onBack && (
            <Button variant="ghost" size="sm" icon onClick={onBack} aria-label="Retour">
              <ArrowLeft className="size-4" />
            </Button>
          )}
          {breadcrumb?.map((b, i) => (
            <React.Fragment key={b}>
              {i > 0 && <ChevronRight className="size-3.5 text-text-subtle" aria-hidden />}
              <span
                className={cn(
                  'flex items-center gap-1.5 truncate',
                  i === breadcrumb.length - 1 && 'font-medium text-text',
                )}
              >
                {i === 0 && <Folder className="size-4" strokeWidth={1.75} aria-hidden />}
                {b}
              </span>
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <Button variant="ghost" size="sm" icon aria-label="Plus d'actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="t-h1">{title}</h1>
      </div>
      {toolbar && <div className="flex items-center gap-3">{toolbar}</div>}
    </header>
  );
}

/** InfoPanel : blocs-cartes avec jauge, propriétés, étiquettes (REF-C3). */
export function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-5">
      <h2 className="t-h2">{title}</h2>
      {children}
    </div>
  );
}
export function InfoCard({
  label,
  value,
  ratio,
  tone = 'primary',
}: {
  label: string;
  value: string;
  ratio: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="t-caption text-text-muted">{label}</p>
      <p className="t-kpi">{value}</p>
      <ProgressBar value={ratio * 100} tone={tone} label={label} />
    </div>
  );
}
export function PropertyList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <section className="space-y-2">
      <h3 className="t-h3">Propriétés</h3>
      <dl className="space-y-2">
        {items.map((p) => (
          <div key={p.label} className="flex items-center justify-between gap-3 t-small">
            <dt className="text-text-muted">{p.label}</dt>
            <dd className="tabular font-medium">{p.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
