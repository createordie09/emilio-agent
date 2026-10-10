import * as React from 'react';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from './inputs';

/** Field : libellé, aide, erreur et contrôle (les contrôles gardent leurs états default/hover/focus/disabled). */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="t-h3 flex items-center gap-1">
        {label}
        {required && (
          <span className="text-primary" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && <p className="t-small text-text-muted">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-24 w-full resize-y rounded-md border border-border bg-surface-muted px-3.5 py-2.5 t-body text-text placeholder:text-text-subtle',
      'transition-colors duration-150 hover:border-primary-soft focus-visible:border-primary disabled:opacity-50',
      className,
    )}
    {...p}
  />
));
Textarea.displayName = 'Textarea';

/** Checkbox arrondie violette avec libellé cliquable. */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'mt-0.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm border transition-colors duration-150',
          checked
            ? 'border-primary-strong bg-primary-strong text-on-primary'
            : 'border-border bg-surface hover:border-primary',
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </button>
      <span>
        <span className="t-body block">{label}</span>
        {description && <span className="t-small block text-text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** OptionCard : choix unique présenté en carte (rôle radio) ; sélection = bordure violette. */
export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  badge,
  disabled,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-all duration-150 ease-soft',
        'disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'border-primary bg-primary-softer shadow-sm'
          : 'border-border bg-surface hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="t-h3">{title}</span>
        {badge}
      </span>
      {description && <span className="t-small text-text-muted">{description}</span>}
    </button>
  );
}

/** SegmentedControl : choix court en pilules (même habillage que les onglets). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-full bg-surface-muted p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            't-small cursor-pointer rounded-full px-4 py-1.5 font-medium transition-all duration-200',
            value === o.value
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** ListEditor : liste de textes courts (questions, hypothèses, mots-clés) avec ajout par Entrée. */
export function ListEditor({
  items,
  onChange,
  placeholder,
  max,
  label,
  chips,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
  label: string;
  chips?: boolean;
}) {
  const [draft, setDraft] = React.useState('');
  const full = max !== undefined && items.length >= max;
  const add = () => {
    const v = draft.trim();
    if (!v || full || items.includes(v)) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className={cn(chips ? 'flex flex-wrap gap-2' : 'space-y-2')}>
          {items.map((it, i) => (
            <li
              key={it}
              className={cn(
                'flex items-center gap-2 rounded-md border border-border bg-surface',
                chips
                  ? 'rounded-full bg-primary-soft px-3 py-1 t-small text-primary-strong dark:text-primary'
                  : 'px-3.5 py-2 t-body',
              )}
            >
              <span className="min-w-0 flex-1">{it}</span>
              <button
                type="button"
                aria-label={`Retirer « ${it} »`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-text-muted hover:bg-danger-soft hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          disabled={full}
          aria-label={label}
          placeholder={full ? `Maximum atteint (${max})` : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || full}
          aria-label={`Ajouter : ${label}`}
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md bg-primary-soft text-primary-strong transition-colors hover:bg-primary hover:text-on-primary disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
