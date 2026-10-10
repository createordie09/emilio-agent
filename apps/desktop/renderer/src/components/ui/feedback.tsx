import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileSearch,
  GraduationCap,
  Info,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  PenLine,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/** StatusBadge : pilule avec point coloré (CdC §6.1.7, REF-C3 tags). */
const badge = cva('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 t-caption', {
  variants: {
    tone: {
      neutral: 'bg-surface-muted text-text-muted',
      primary: 'bg-primary-soft text-primary-strong dark:text-primary',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
const dot: Record<string, string> = {
  neutral: 'bg-text-subtle',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};
export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return (
    <span className={cn(badge({ tone }), className)} {...p}>
      <span className={cn('size-1.5 rounded-full', dot[tone ?? 'neutral'])} aria-hidden />
      {children}
    </span>
  );
}

/** ProgressBar / Gauge : 6 px, piste primary-soft (CdC §6.1.7). */
export function ProgressBar({
  value,
  max = 100,
  tone = 'primary',
  className,
  label,
  animated,
}: {
  value: number;
  max?: number;
  className?: string;
  label?: string;
  animated?: boolean;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-primary-soft', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 ease-soft',
          fill,
          animated &&
            'bg-[length:24px_24px] animate-[progress-stripes_1s_linear_infinite] bg-[linear-gradient(45deg,var(--stripe)_25%,transparent_25%,transparent_50%,var(--stripe)_50%,var(--stripe)_75%,transparent_75%)]',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Skeleton : blocs animés pour tout chargement > 300 ms. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-shimmer rounded-md', className)} />;
}

/** Illustration : emplacement neutre pour les futurs visuels 3D (CdC §6.1.1 règle 2, voir docs/ASSETS.md). */
export function Illustration({
  icon: Icon = GraduationCap,
  size = 96,
  className,
}: {
  icon?: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn('relative grid place-items-center rounded-[28%] shadow-glow', className)}
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(145deg, var(--illustration-from), var(--illustration-to))',
      }}
    >
      <span className="absolute inset-x-[10%] top-[6%] h-[38%] rounded-full bg-white/25 blur-[2px]" />
      <Icon
        className="relative text-white drop-shadow"
        style={{ width: size * 0.45, height: size * 0.45 }}
        strokeWidth={1.6}
      />
    </div>
  );
}

/** AgentAvatar : cercle 32 px, bordure primary, icône du rôle (CdC §6.1.7). */
export const ROLE_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  researcher: { icon: Search, label: 'Chercheur' },
  writer: { icon: PenLine, label: 'Rédacteur' },
  jury: { icon: Scale, label: 'Jury' },
  verifier: { icon: ShieldCheck, label: 'Vérificateur' },
  analyst: { icon: FileSearch, label: 'Analyste' },
  architect: { icon: BookOpen, label: 'Architecte du plan' },
  launch: { icon: Rocket, label: 'Orchestrateur' },
};
export function AgentAvatar({
  role,
  active,
  className,
}: {
  role: keyof typeof ROLE_ICONS | string;
  active?: boolean;
  className?: string;
}) {
  const r = ROLE_ICONS[role] ?? ROLE_ICONS.launch!;
  const Icon = r.icon;
  return (
    <span
      role="img"
      aria-label={r.label}
      title={r.label}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full border-2 border-primary bg-primary-soft text-primary-strong dark:text-primary',
        active && 'animate-pulse-soft',
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** Toast : carte en verre, icône de statut, titre + description. */
const TOAST_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
} as const;
const TOAST_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
} as const;
export function Toast({
  tone = 'info',
  title,
  description,
  className,
}: {
  tone?: keyof typeof TOAST_ICON;
  title: string;
  description?: string;
  className?: string;
}) {
  const Icon = TOAST_ICON[tone];
  return (
    <div
      role="status"
      className={cn(
        'glass flex w-80 items-start gap-3 rounded-lg p-4 shadow-lg animate-slide-down',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', TOAST_TONE[tone])} strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="t-h3">{title}</p>
        {description && <p className="t-small text-text-muted">{description}</p>}
      </div>
    </div>
  );
}

/** EmptyState : illustration, titre h2, texte, bouton principal. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  text?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
    >
      <Illustration icon={icon} size={96} />
      <h2 className="t-h2">{title}</h2>
      {text && <p className="t-body max-w-md text-text-muted">{text}</p>}
      {action}
    </div>
  );
}

/** IconBubble : bulle d'icône (primary-soft ou verre lumineuse, REF-D1). */
export function IconBubble({
  icon: Icon,
  variant = 'soft',
  size = 40,
  className,
}: {
  icon: LucideIcon;
  variant?: 'soft' | 'glass';
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-primary',
        variant === 'soft' ? 'bg-primary-soft' : 'glass shadow-glow',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.75} />
    </span>
  );
}
