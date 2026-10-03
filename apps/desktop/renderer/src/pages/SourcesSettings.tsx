import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Loader2, MinusCircle, Trash2, XCircle } from 'lucide-react';
import type { ConnectorStatus, SourcesConfigInfo } from '@emilio/shared';
import { Button, Input, Skeleton, StatusBadge, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { useToasts } from '@/stores/toasts';

const DESC: Record<string, string> = {
  openalex:
    'Recherche principale : articles, ouvrages, thèses, avec liens vers les versions en accès ouvert.',
  crossref: 'Vérification des DOI et métadonnées de référence.',
  hal: 'Littérature francophone : thèses, mémoires, articles.',
  semantic_scholar:
    'Recherche complémentaire, résumés et citations. Clé facultative (gratuite) pour un meilleur quota.',
  unpaywall:
    "Trouve la version en accès ouvert d'un document à partir de son DOI. Nécessite votre adresse e-mail.",
  doaj: 'Revues en accès ouvert sélectionnées.',
  arxiv: 'Sciences exactes, informatique, économie.',
  europepmc: 'Santé publique et médecine.',
  core: "Textes intégraux en accès ouvert. Nécessite une clé d'API gratuite.",
};

/** Paramètres → Sources documentaires (CdC §11.2) : adresse de contact, activation, clés facultatives, test des connexions. */
export function SourcesSettings() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const { data, isLoading } = useQuery({
    queryKey: ['sources-config'],
    queryFn: async () => {
      const r = await api.sources.config();
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
  const [email, setEmail] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<Record<string, string>>({});
  const [status, setStatus] = React.useState<ConnectorStatus[] | null>(null);
  const apply = (v: SourcesConfigInfo) => qc.setQueryData(['sources-config'], v);
  const fail = (e: { messageFr?: string }) =>
    push({ tone: 'danger', title: 'Action impossible', description: e.messageFr });

  const save = useMutation({
    mutationFn: async (patch: { contactEmail?: string; enabled?: Record<string, boolean> }) => {
      const r = await api.sources.saveConfig(patch);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: apply,
    onError: fail,
  });
  const saveKey = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.sources.saveKey(id, keys[id] ?? '');
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (v, id) => {
      apply(v);
      setKeys((k) => ({ ...k, [id]: '' }));
      push({
        tone: 'success',
        title: 'Clé enregistrée',
        description: 'Elle est chiffrée sur votre ordinateur.',
      });
    },
    onError: fail,
  });
  const removeKey = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.sources.removeKey(id);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: apply,
    onError: fail,
  });
  const test = useMutation({
    mutationFn: async () => {
      const r = await api.sources.test();
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: setStatus,
    onError: fail,
  });

  if (isLoading || !data) return <Skeleton className="h-64" />;
  const mail = email ?? data.contactEmail;

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div>
          <h2 className="t-h3">Adresse de contact</h2>
          <p className="t-small mt-0.5 text-text-muted">
            Les services de recherche demandent une adresse e-mail pour vous identifier poliment
            (bonne pratique, meilleur débit) ; Unpaywall l'exige. Elle n'est envoyée qu'à eux.
          </p>
        </div>
        <div className="flex gap-3">
          <Input
            type="email"
            aria-label="Adresse e-mail de contact"
            placeholder="vous@exemple.org"
            value={mail}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            onClick={() => save.mutate({ contactEmail: mail })}
            loading={save.isPending}
            disabled={mail === data.contactEmail}
          >
            Enregistrer
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="t-h3">Services de recherche</h2>
            <p className="t-small mt-0.5 text-text-muted">
              Seuls des mots-clés de recherche sont envoyés à ces services, jamais vos documents.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => test.mutate()}
            loading={test.isPending}
          >
            Tester les connexions
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {data.connectors.map((c) => {
            const st = status?.find((s) => s.id === c.id);
            return (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex items-start gap-3">
                  <Switch
                    checked={c.enabled}
                    onCheckedChange={(v) => save.mutate({ enabled: { [c.id]: v } })}
                    label={`Activer ${c.label}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="t-h3">{c.label}</p>
                    <p className="t-small text-text-muted">{DESC[c.id]}</p>
                  </div>
                  {st && (
                    <span
                      className="flex shrink-0 items-center gap-1.5 t-small"
                      role="status"
                      aria-label={`État de ${c.label}`}
                    >
                      {test.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : st.ok === true ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : st.ok === false ? (
                        <XCircle className="size-4 text-danger" />
                      ) : (
                        <MinusCircle className="size-4 text-text-subtle" />
                      )}
                      <span className={st.ok === false ? 'text-danger' : 'text-text-muted'}>
                        {st.ok === true
                          ? `Disponible${st.latencyMs !== null ? ` (${st.latencyMs} ms)` : ''}`
                          : st.message}
                      </span>
                    </span>
                  )}
                </div>
                {['semantic_scholar', 'core'].includes(c.id) && (
                  <div className="ml-14 flex flex-wrap items-center gap-3">
                    {c.keyConfigured || c.keyMasked ? (
                      <>
                        <StatusBadge tone="success">
                          Clé enregistrée{c.keyMasked ? ` : ${c.keyMasked}` : ''}
                        </StatusBadge>
                        <Button variant="ghost" size="sm" onClick={() => removeKey.mutate(c.id)}>
                          <Trash2 className="size-4" />
                          Supprimer la clé
                        </Button>
                      </>
                    ) : (
                      <>
                        <Input
                          type="password"
                          autoComplete="off"
                          aria-label={`Clé d'API ${c.label}`}
                          placeholder={c.needsKey ? 'Clé obligatoire' : 'Clé facultative'}
                          className="max-w-72"
                          value={keys[c.id] ?? ''}
                          onChange={(e) => setKeys((k) => ({ ...k, [c.id]: e.target.value }))}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => saveKey.mutate(c.id)}
                          disabled={!keys[c.id]?.trim()}
                          loading={saveKey.isPending && saveKey.variables === c.id}
                        >
                          <KeyRound className="size-4" />
                          Enregistrer
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
