import * as React from 'react';
import {
  ArrowUp,
  FileText,
  Mic,
  Paperclip,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { IconBubble, ProgressBar } from './feedback';

/** Input / champ de texte standard (rayon 12 px). */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-md border border-border bg-surface-muted px-3.5 t-body text-text placeholder:text-text-subtle',
      'transition-colors duration-150 hover:border-primary-soft focus-visible:border-primary disabled:opacity-50',
      className,
    )}
    {...p}
  />
));
Input.displayName = 'Input';

/** Composer : carte blanche, étincelle, actions fantômes, envoi violet (CdC §6.1.7, REF-B2/E2). */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  loading,
  className,
}: {
  value?: string;
  onChange?: (v: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-4 shadow-sm focus-within:border-primary',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 size-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
        <textarea
          rows={2}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          className="t-body w-full resize-none bg-transparent text-text outline-none placeholder:text-text-subtle"
          aria-label={placeholder}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" type="button">
            <Paperclip className="size-4" />
            Joindre
          </Button>
          <Button variant="ghost" size="sm" type="button">
            <Settings2 className="size-4" />
            Paramètres
          </Button>
          <Button variant="ghost" size="sm" type="button">
            <SlidersHorizontal className="size-4" />
            Options
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon
            type="button"
            disabled
            aria-label="Dictée vocale (indisponible)"
            title="Indisponible dans cette version"
          >
            <Mic className="size-4" />
          </Button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || loading}
            aria-label="Envoyer"
            className="grid size-9 cursor-pointer place-items-center rounded-md bg-primary-strong text-on-primary transition-all duration-150 hover:bg-primary-hover hover:shadow-glow active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowUp className="size-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** SuggestionChip : pilule bordure, survol primary-softer. */
export function SuggestionChip({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        't-small cursor-pointer rounded-full border border-border px-4 py-1.5 text-text-muted transition-colors duration-150 hover:bg-primary-softer hover:text-primary-strong disabled:opacity-50',
        className,
      )}
      {...p}
    />
  );
}

/** Dropzone : bordure pointillée, bulle verre lumineuse ; état drag-over. */
export function Dropzone({
  title,
  help,
  dragOver,
  onFiles,
  className,
}: {
  title: string;
  help?: string;
  dragOver?: boolean;
  onFiles?: (f: FileList) => void;
  className?: string;
}) {
  const [over, setOver] = React.useState(false);
  const active = dragOver ?? over;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles?.(e.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center gap-5 rounded-xl border-[1.5px] border-dashed px-8 py-10 text-center transition-colors duration-150',
        active ? 'border-primary bg-primary-softer' : 'border-border bg-surface-muted',
        className,
      )}
    >
      <h3 className="t-h3">{title}</h3>
      <IconBubble icon={UploadCloud} variant="glass" size={72} />
      {help && <p className="t-small max-w-sm text-text-muted">{help}</p>}
    </div>
  );
}

/** FileRow : vignette de type, nom, méta, bouton fermer rond, barre de progression 4 px. */
export function FileRow({
  name,
  meta,
  progress,
  onRemove,
  className,
}: {
  name: string;
  meta: string;
  progress?: number;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm',
        className,
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
        <FileText className="size-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="t-h3 truncate">{name}</p>
        <p className="t-caption text-text-subtle">{meta}</p>
        {progress !== undefined && (
          <ProgressBar value={progress} className="h-1" label={`Progression de ${name}`} />
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${name}`}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-surface-muted text-text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Switch (réglage on/off) : piste primary quand actif. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-soft disabled:opacity-50',
        checked ? 'bg-primary-strong' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-soft',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

/** Select natif habillé (rayon 12 px). */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-10 rounded-md border border-border bg-surface-muted px-3 t-body text-text transition-colors hover:border-primary-soft focus-visible:border-primary',
      className,
    )}
    {...p}
  />
));
Select.displayName = 'Select';
