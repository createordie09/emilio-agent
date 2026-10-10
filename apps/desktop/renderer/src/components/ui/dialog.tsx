import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { Button } from './button';

/** Modal : rayon 24 px, ombre lg, voile + flou 4 px ; pied = paire secondary + primary de même largeur. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  cancelLabel = 'Annuler',
  confirmLabel = 'Valider',
  onConfirm,
  confirmLoading,
  container,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmLoading?: boolean;
  container?: HTMLElement | null;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[4px] animate-fade-up" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-lg animate-fade-up',
          )}
        >
          <DialogPrimitive.Title className="t-h2">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="t-small mt-1 text-text-muted">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          <div className="mt-4">{children}</div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button size="lg" onClick={onConfirm} loading={confirmLoading}>
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
