import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, KeyRound, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { ModelInfo, SerializedError } from '@emilio/shared';
import {
  Button,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Modal,
  Skeleton,
} from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtInt, fmtPerMillion, fmtUsd } from '@/lib/fr';
import { useKeyInfo, useKeyStatus, useModels } from '@/lib/queries';
import { useToasts } from '@/stores/toasts';
import { useUi } from '@/stores/ui';

const Card = ({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <section
    className={cn('space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm', className)}
  >
    <div>
      <h2 className="t-h3">{title}</h2>
      {description && <p className="t-small mt-0.5 text-text-muted">{description}</p>}
    </div>
    {children}
  </section>
);

const errMsg = (e: unknown) =>
  e && typeof e === 'object' && 'messageFr' in e
    ? (e as SerializedError).messageFr
    : 'Une erreur inattendue est survenue.';

function KeySection() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const status = useKeyStatus();
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const info = useKeyInfo(false);
  const [lastError, setLastError] = React.useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    setLastError(null);
    const r = await api.key.test();
    setTesting(false);
    if (r.ok) {
      qc.setQueryData(['key-info'], r.value);
      push({
        tone: 'success',
        title: 'Clé valide',
        description: 'La connexion à OpenRouter fonctionne.',
      });
    } else {
      setLastError(r.error.messageFr);
      push({ tone: 'danger', title: 'Test de la clé impossible', description: r.error.messageFr });
    }
  };
  const save = async () => {
    setSaving(true);
    const r = await api.key.save(draft);
    setSaving(false);
    if (!r.ok)
      return push({ tone: 'danger', title: 'Clé non enregistrée', description: r.error.messageFr });
    setDraft('');
    await qc.invalidateQueries({ queryKey: ['key-status'] });
    push({
      tone: 'success',
      title: 'Clé enregistrée',
      description: 'Elle est chiffrée sur votre ordinateur.',
    });
    await test();
  };
  const remove = async () => {
    const r = await api.key.remove();
    setConfirmDelete(false);
    if (!r.ok)
      return push({
        tone: 'danger',
        title: 'Suppression impossible',
        description: r.error.messageFr,
      });
    qc.removeQueries({ queryKey: ['key-info'] });
    await qc.invalidateQueries({ queryKey: ['key-status'] });
    push({ tone: 'info', title: 'Clé supprimée' });
  };

  const credit = info.data?.accountCreditRemaining ?? info.data?.limitRemaining ?? null;
  const data = qc.getQueryData<NonNullable<typeof info.data>>(['key-info']) ?? info.data;
  const dcredit = data?.accountCreditRemaining ?? data?.limitRemaining ?? credit;

  return (
    <div className="space-y-5">
      <Card
        title="Clé OpenRouter"
        description="Vos agents utilisent votre propre clé (BYOK). Elle est chiffrée sur cet ordinateur et n'est jamais affichée en entier."
      >
        <div className="flex items-center gap-3">
          <StatusBadge tone={status.data?.configured ? 'success' : 'warning'}>
            {status.data?.configured
              ? `Clé enregistrée : ${status.data.masked}`
              : 'Aucune clé enregistrée'}
          </StatusBadge>
        </div>
        <div className="flex gap-3">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-…"
            aria-label="Clé OpenRouter"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button onClick={save} loading={saving} disabled={!draft.trim()}>
            <KeyRound className="size-4" />
            Enregistrer
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={test}
            loading={testing}
            disabled={!status.data?.configured}
          >
            <ShieldCheck className="size-4" />
            Tester la clé
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
            disabled={!status.data?.configured}
          >
            <Trash2 className="size-4" />
            Supprimer la clé
          </Button>
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="t-small ml-auto flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
          >
            Comment obtenir une clé ? <ExternalLink className="size-3.5" />
          </a>
        </div>
        {lastError && (
          <p role="alert" className="t-small rounded-md bg-danger-soft p-3 text-danger">
            {lastError}
          </p>
        )}
        {data && (
          <div className="space-y-3 rounded-md bg-primary-softer p-4">
            <div className="flex items-center gap-2 t-h3">
              <CheckCircle2 className="size-4 text-success" />
              Connexion établie
            </div>
            <dl className="grid grid-cols-3 gap-4 t-small">
              <div>
                <dt className="text-text-muted">Crédit restant</dt>
                <dd className="t-kpi">{fmtUsd(dcredit)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Dépenses cumulées</dt>
                <dd className="t-kpi">{fmtUsd(data.usage)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Plafond de la clé</dt>
                <dd className="t-kpi">{data.limit === null ? 'Aucun' : fmtUsd(data.limit)}</dd>
              </div>
            </dl>
          </div>
        )}
      </Card>
      <Card title="Confidentialité">
        <p className="t-small text-text-muted">
          Les extraits de vos documents sont envoyés aux modèles d'IA via OpenRouter pour être
          traités. Consultez la politique de confidentialité d'OpenRouter et, si besoin, choisissez
          des fournisseurs qui ne conservent pas les données.
        </p>
      </Card>
      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer la clé ?"
        description="Les agents ne pourront plus travailler tant qu'une nouvelle clé n'est pas enregistrée."
        confirmLabel="Supprimer"
        onConfirm={remove}
      />
    </div>
  );
}

const PAGE = 50;
type Sort = 'nom' | 'prix' | 'contexte';

function ModelsSection() {
  const { data, isLoading, error, refetch, isFetching } = useModels();
  const [q, setQ] = React.useState('');
  const [maxPrice, setMaxPrice] = React.useState('');
  const [minCtx, setMinCtx] = React.useState('0');
  const [structured, setStructured] = React.useState(false);
  const [sort, setSort] = React.useState<Sort>('nom');
  const [shown, setShown] = React.useState(PAGE);

  const list = React.useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const max = maxPrice === '' ? Infinity : Number(maxPrice) / 1_000_000;
    return data.models
      .filter(
        (m) =>
          (!needle ||
            m.id.toLowerCase().includes(needle) ||
            m.name.toLowerCase().includes(needle)) &&
          (m.promptPrice === null || m.promptPrice <= max) &&
          (m.contextLength ?? 0) >= Number(minCtx) &&
          (!structured || m.supportsStructuredOutputs) &&
          m.outputModalities.includes('text'),
      )
      .sort((a: ModelInfo, b: ModelInfo) =>
        sort === 'prix'
          ? (a.promptPrice ?? Infinity) - (b.promptPrice ?? Infinity)
          : sort === 'contexte'
            ? (b.contextLength ?? 0) - (a.contextLength ?? 0)
            : a.name.localeCompare(b.name, 'fr'),
      );
  }, [data, q, maxPrice, minCtx, structured, sort]);

  return (
    <Card
      title="Modèles disponibles"
      description={
        data
          ? `${fmtInt(data.models.length)} modèles · liste ${data.fromCache ? 'en cache' : 'mise à jour'} le ${new Date(data.fetchedAt).toLocaleString('fr-FR')}`
          : 'Liste fournie par OpenRouter (mise en cache 24 h).'
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
            aria-hidden
          />
          <Input
            className="rounded-full pl-9"
            placeholder="Rechercher un modèle"
            aria-label="Rechercher un modèle"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(PAGE);
            }}
          />
        </div>
        <Input
          className="w-40"
          type="number"
          min={0}
          step="0.1"
          placeholder="Prix max ($/M)"
          aria-label="Prix d'entrée maximal en dollars par million de jetons"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
        <Select
          aria-label="Contexte minimal"
          value={minCtx}
          onChange={(e) => setMinCtx(e.target.value)}
        >
          <option value="0">Tout contexte</option>
          <option value="32000">≥ 32 k</option>
          <option value="128000">≥ 128 k</option>
          <option value="500000">≥ 500 k</option>
        </Select>
        <Select
          aria-label="Trier par"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="nom">Tri : nom</option>
          <option value="prix">Tri : prix</option>
          <option value="contexte">Tri : contexte</option>
        </Select>
        <label className="t-small flex cursor-pointer items-center gap-2 text-text-muted">
          <Switch
            checked={structured}
            onCheckedChange={setStructured}
            label="Sorties structurées uniquement"
          />
          Sorties structurées
        </label>
        <Button variant="secondary" size="sm" loading={isFetching} onClick={() => refetch()}>
          Actualiser
        </Button>
      </div>
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="t-small rounded-md bg-danger-soft p-3 text-danger">
          {errMsg(error)}
        </p>
      )}
      {data && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full t-small">
            <thead className="bg-surface-muted text-left text-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Modèle</th>
                <th className="px-4 py-2.5 font-medium">Contexte</th>
                <th className="px-4 py-2.5 font-medium">Entrée / M</th>
                <th className="px-4 py-2.5 font-medium">Sortie / M</th>
                <th className="px-4 py-2.5 font-medium">JSON</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((m) => (
                <tr key={m.id} className="border-t border-border hover:bg-primary-softer">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{m.name}</p>
                    <p className="t-caption text-text-subtle">{m.id}</p>
                  </td>
                  <td className="tabular px-4 py-2.5">
                    {m.contextLength ? `${fmtInt(Math.round(m.contextLength / 1000))} k` : '—'}
                  </td>
                  <td className="tabular px-4 py-2.5">{fmtPerMillion(m.promptPrice)}</td>
                  <td className="tabular px-4 py-2.5">{fmtPerMillion(m.completionPrice)}</td>
                  <td className="px-4 py-2.5">
                    {m.supportsStructuredOutputs ? (
                      <StatusBadge tone="success">Structuré</StatusBadge>
                    ) : m.supportsJsonMode ? (
                      <StatusBadge tone="info">JSON</StatusBadge>
                    ) : (
                      <StatusBadge>Non</StatusBadge>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                    Aucun modèle ne correspond à ces critères.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && list.length > shown && (
        <div className="flex items-center justify-between">
          <p className="t-small text-text-muted">
            {fmtInt(shown)} sur {fmtInt(list.length)} affichés
          </p>
          <Button variant="secondary" size="sm" onClick={() => setShown((s) => s + PAGE)}>
            Afficher plus
          </Button>
        </div>
      )}
    </Card>
  );
}

function AppearanceSection() {
  const { theme, reduceEffects, devMode, update } = useUi();
  const themes = [
    ['clair', 'Clair'],
    ['sombre', 'Sombre'],
    ['systeme', 'Système'],
  ] as const;
  return (
    <div className="space-y-5">
      <Card title="Thème" description="Clair par défaut ; « Système » suit votre ordinateur.">
        <div
          role="radiogroup"
          aria-label="Thème"
          className="inline-flex gap-1 rounded-full bg-surface-muted p-1"
        >
          {themes.map(([v, label]) => (
            <button
              key={v}
              role="radio"
              aria-checked={theme === v}
              onClick={() => update({ theme: v })}
              className={cn(
                't-small cursor-pointer rounded-full px-5 py-1.5 font-medium transition-all duration-200',
                theme === v ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Animations et effets">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-h3">Réduire les animations et effets</p>
            <p className="t-small text-text-muted">
              Désactive les mouvements et le flou (verre dépoli).
            </p>
          </div>
          <Switch
            checked={reduceEffects}
            onCheckedChange={(c) => update({ reduceEffects: c })}
            label="Réduire les animations et effets"
          />
        </div>
      </Card>
      <Card title="Mode développeur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-h3">Afficher les outils de développement</p>
            <p className="t-small text-text-muted">
              Donne accès à la page de démonstration du design system.
            </p>
          </div>
          <Switch
            checked={devMode}
            onCheckedChange={(c) => update({ devMode: c })}
            label="Mode développeur"
          />
        </div>
      </Card>
    </div>
  );
}

function AboutSection() {
  const about = useQuery({
    queryKey: ['about'],
    queryFn: async () => ({ app: await api.app.info(), engine: await api.engine.ping() }),
  });
  return (
    <Card title="À propos">
      {about.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 t-small">
          <dt className="text-text-muted">Application</dt>
          <dd className="font-medium">
            {about.data?.app.name} {about.data?.app.version}
          </dd>
          <dt className="text-text-muted">Système</dt>
          <dd>
            {about.data?.app.platform} · Electron {about.data?.app.electron}
          </dd>
          <dt className="text-text-muted">Moteur</dt>
          <dd>
            {about.data?.engine.ok ? (
              <StatusBadge tone="success">
                En marche · v{about.data.engine.value.engineVersion} · base v
                {about.data.engine.value.schemaVersion}
              </StatusBadge>
            ) : (
              <StatusBadge tone="danger">Ne répond pas</StatusBadge>
            )}
          </dd>
        </dl>
      )}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Paramètres" breadcrumb={['Paramètres']} />
      <Tabs defaultValue="cle" orientation="vertical" className="flex gap-8 px-8 pb-8">
        <TabsList
          className="h-fit w-56 shrink-0 flex-col rounded-lg p-2"
          aria-label="Sections des paramètres"
        >
          {[
            ['cle', 'Clé et modèles'],
            ['apparence', 'Apparence'],
            ['apropos', 'À propos'],
          ].map(([v, l]) => (
            <TabsTrigger key={v} value={v!} className="w-full rounded-md text-left">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-w-0 flex-1">
          <TabsContent value="cle" className="space-y-5">
            <KeySection />
            <ModelsSection />
          </TabsContent>
          <TabsContent value="apparence">
            <AppearanceSection />
          </TabsContent>
          <TabsContent value="apropos">
            <AboutSection />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
