import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Stepper (wizard / frise des phases) : courante violet plein, faites = coche success, futures muted. */
export function Stepper({
  steps,
  current,
  className,
  onStepClick,
  maxReachable,
}: {
  steps: string[];
  current: number;
  className?: string;
  /** Rend les étapes déjà visitées cliquables (navigation libre de l'assistant, CdC §6.4). */
  onStepClick?: (i: number) => void;
  maxReachable?: number;
}) {
  return (
    <ol className={cn('flex items-center', className)} aria-label="Étapes">
      {steps.map((label, i) => {
        const done = i < current;
        const cur = i === current;
        return (
          <li
            key={label}
            className="flex flex-1 items-center last:flex-none"
            aria-current={cur ? 'step' : undefined}
          >
            <div
              className={cn(
                'flex flex-col items-center gap-1.5',
                onStepClick && i <= (maxReachable ?? current) && 'cursor-pointer',
              )}
              role={onStepClick && i <= (maxReachable ?? current) ? 'button' : undefined}
              tabIndex={onStepClick && i <= (maxReachable ?? current) ? 0 : undefined}
              aria-label={
                onStepClick && i <= (maxReachable ?? current)
                  ? `Aller à l'étape ${i + 1} : ${label}`
                  : undefined
              }
              onClick={() => onStepClick && i <= (maxReachable ?? current) && onStepClick(i)}
              onKeyDown={(e) =>
                e.key === 'Enter' && onStepClick && i <= (maxReachable ?? current) && onStepClick(i)
              }
            >
              <span
                className={cn(
                  'grid size-8 place-items-center rounded-full t-caption transition-colors duration-200',
                  cur && 'bg-primary-strong text-on-primary shadow-glow',
                  done && 'bg-success text-on-primary',
                  !cur && !done && 'bg-surface-muted text-text-subtle',
                )}
              >
                {done ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
              </span>
              <span
                className={cn(
                  't-caption whitespace-nowrap',
                  cur ? 'text-text' : 'text-text-subtle',
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'mx-2 mb-5 h-0.5 flex-1 rounded-full',
                  done ? 'bg-success' : 'bg-border',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Tabs : onglets en pilules dans un conteneur surface-muted ; actif = fond blanc + ombre. */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...p }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex gap-1 rounded-full bg-surface-muted p-1', className)}
    {...p}
  />
));
TabsList.displayName = 'TabsList';
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...p }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      't-small cursor-pointer rounded-full px-4 py-1.5 font-medium text-text-muted transition-all duration-200 ease-soft',
      'hover:text-text data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm disabled:opacity-50',
      className,
    )}
    {...p}
  />
));
TabsTrigger.displayName = 'TabsTrigger';
