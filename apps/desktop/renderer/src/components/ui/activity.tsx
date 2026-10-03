import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { AgentAvatar } from './feedback';
import { Input } from './inputs';

export type ActivityItem = {
  id: string;
  role: string;
  title: string;
  description: string;
  time: string;
  agents?: string[];
};

/** ActivityFeed : recherche, entrées avec avatars empilés, horodatage relatif, bouton `ink` en bas (REF-E3). */
export function ActivityFeed({
  title,
  items,
  actionLabel,
  className,
}: {
  title: string;
  items: ActivityItem[];
  actionLabel?: string;
  className?: string;
}) {
  return (
    <section className={cn('flex h-full flex-col gap-4', className)}>
      <h2 className="t-h2">{title}</h2>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
          aria-hidden
        />
        <Input
          className="rounded-full pl-9"
          placeholder="Rechercher dans l'activité"
          aria-label="Rechercher dans l'activité"
        />
      </div>
      <ul className="flex-1 space-y-1 overflow-auto">
        {items.map((it, i) => (
          <li
            key={it.id}
            className="animate-slide-down flex items-start gap-3 rounded-md p-2.5 transition-colors hover:bg-primary-softer"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <AgentAvatar role={it.role} />
            <div className="min-w-0 flex-1">
              <p className="t-h3 truncate">{it.title}</p>
              <p className="t-small truncate text-text-muted">{it.description}</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="flex -space-x-2">
                  {(it.agents ?? []).map((a) => (
                    <AgentAvatar key={a} role={a} className="size-6 border-surface" />
                  ))}
                </span>
                <span className="t-caption tabular text-text-subtle">{it.time}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {actionLabel && (
        <Button variant="ink" size="lg" className="w-full">
          {actionLabel}
        </Button>
      )}
    </section>
  );
}
