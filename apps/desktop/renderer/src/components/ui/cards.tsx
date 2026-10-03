import * as React from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Illustration } from './feedback';
import type { LucideIcon } from 'lucide-react';

/** WelcomeBanner : 160 px, dégradé violet, illustration débordante (CdC §6.1.7, REF-A2). */
export function WelcomeBanner({
  date,
  title,
  subtitle,
  illustration,
  className,
}: {
  date?: string;
  title: string;
  subtitle?: string;
  illustration?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative flex h-40 items-center overflow-visible rounded-xl px-8 text-white shadow-md',
        className,
      )}
      style={{ background: 'var(--primary-gradient)' }}
    >
      <span aria-hidden className="absolute right-40 top-5 size-3 rounded-full bg-white/30" />
      <span aria-hidden className="absolute right-24 bottom-6 size-2 rounded-full bg-white/40" />
      <span aria-hidden className="absolute right-60 bottom-10 size-1.5 rounded-full bg-white/30" />
      <div className="relative z-10 max-w-[60%]">
        {date && <p className="t-caption text-white/70">{date}</p>}
        <h2 className="t-display mt-1">{title}</h2>
        {subtitle && <p className="t-body mt-1 text-white/80">{subtitle}</p>}
      </div>
      <div className="absolute -top-6 right-10">{illustration ?? <Illustration size={128} />}</div>
    </section>
  );
}

/** KpiCard : icône/illustration, valeur kpi, libellé. Variante `active` : bordure 2 px primary. */
export function KpiCard({
  icon,
  value,
  label,
  active,
  className,
  ...p
}: {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label: string;
  active?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border-2 bg-surface p-5 text-center shadow-md',
        active ? 'border-primary' : 'border-border',
        className,
      )}
      {...p}
    >
      {icon}
      <p className="t-kpi">{value}</p>
      <p className="t-small text-text-muted">{label}</p>
    </div>
  );
}

/** ActionCard : fond primary-soft, titre violet, bouton pilule. Variante `selected`. */
export function ActionCard({
  title,
  meta,
  illustration,
  onOpen,
  actionLabel = 'Ouvrir',
  selected,
  children,
  className,
}: {
  title: string;
  meta?: string;
  illustration?: React.ReactNode;
  onOpen?: () => void;
  actionLabel?: string;
  selected?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'flex items-center justify-between gap-4 rounded-lg border-2 bg-primary-soft p-5',
        selected ? 'border-primary' : 'border-transparent',
        className,
      )}
    >
      <div className="min-w-0 space-y-3">
        <h3 className="t-h3 text-primary-strong dark:text-primary">{title}</h3>
        {meta && <p className="t-small text-text-muted">{meta}</p>}
        {children}
        <Button size="sm" onClick={onOpen}>
          {actionLabel}
        </Button>
      </div>
      {illustration}
    </article>
  );
}

/** QuickActionCard : icône colorée, titre, description 2 lignes ; survol = élévation + translation. */
export function QuickActionCard({
  icon: Icon,
  title,
  description,
  className,
  ...p
}: {
  icon: LucideIcon;
  title: string;
  description: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'group flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-5 text-left shadow-sm',
        'transition-all duration-150 ease-soft hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
        className,
      )}
      {...p}
    >
      <span className="grid size-9 place-items-center rounded-md bg-primary-soft text-primary">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <span>
        <span className="t-h3 block">{title}</span>
        <span className="t-small line-clamp-2 text-text-muted">{description}</span>
      </span>
    </button>
  );
}

/** FolderCard : onglet de dossier, titre, compteur, méta. Variante `selected` : dégradé violet (REF-C2 transposé). */
export function FolderCard({
  title,
  count,
  meta,
  selected,
  className,
  ...p
}: {
  title: string;
  count: string;
  meta?: string;
  selected?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        'relative flex h-40 flex-col justify-end overflow-hidden rounded-xl border p-5 transition-all duration-150 ease-soft cursor-pointer',
        'hover:-translate-y-0.5 hover:shadow-md',
        selected
          ? 'border-transparent text-white shadow-lg'
          : 'border-border bg-surface-muted text-text',
        className,
      )}
      style={
        selected
          ? {
              background:
                'linear-gradient(160deg, color-mix(in srgb, var(--primary) 55%, white) 0%, var(--primary) 100%)',
            }
          : undefined
      }
      {...p}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-4 right-4 top-4 h-14 rounded-t-lg rounded-b-sm',
          selected ? 'bg-white/30' : 'bg-surface shadow-sm',
        )}
      />
      <h3 className="t-h3 relative">{title}</h3>
      <p className={cn('t-small relative', selected ? 'text-white/85' : 'text-text-muted')}>
        {count}
      </p>
      {meta && (
        <p
          className={cn('t-caption relative mt-3', selected ? 'text-white/75' : 'text-text-subtle')}
        >
          {meta}
        </p>
      )}
    </div>
  );
}

/** NoticeList : titre + « Voir tout », éléments titre gras / texte / « Voir plus ». */
export function NoticeList({
  title,
  items,
  onSeeAll,
}: {
  title: string;
  onSeeAll?: () => void;
  items: { id: string; title: string; text: string }[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="t-h2">{title}</h2>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="t-small cursor-pointer font-medium text-primary hover:text-primary-hover"
          >
            Voir tout
          </button>
        )}
      </div>
      <ul className="space-y-4 rounded-lg bg-surface p-5 shadow-md">
        {items.map((n) => (
          <li key={n.id}>
            <p className="t-h3">{n.title}</p>
            <p className="t-small line-clamp-3 text-text-muted">{n.text}</p>
            <button className="t-small mt-1 cursor-pointer font-medium text-primary hover:text-primary-hover">
              Voir plus
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
