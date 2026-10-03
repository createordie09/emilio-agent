import { useToasts } from '@/stores/toasts';
import { Toast } from '@/components/ui';

export function ToastHost() {
  const items = useToasts((s) => s.items);
  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col gap-3"
      aria-live="polite"
    >
      {items.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          title={t.title}
          description={t.description}
          className="pointer-events-auto"
        />
      ))}
    </div>
  );
}
