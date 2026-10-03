import * as React from 'react';
import {
  BookOpen,
  Download,
  FileSearch,
  GraduationCap,
  Library,
  Plus,
  Rocket,
  Scale,
  Search,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  ActionCard,
  ActivityFeed,
  AgentAvatar,
  Button,
  Composer,
  Dropzone,
  EmptyState,
  FileRow,
  FolderCard,
  IconBubble,
  Illustration,
  InfoCard,
  InfoPanel,
  Input,
  KpiCard,
  Modal,
  NoticeList,
  PageHeader,
  ProgressBar,
  PropertyList,
  QuickActionCard,
  Select,
  Skeleton,
  StatusBadge,
  Stepper,
  SuggestionChip,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toast,
  WelcomeBanner,
  CreditCard,
  Sidebar,
} from '@/components/ui';
import { Home, Settings } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { cn } from '@/lib/cn';

const Section = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="space-y-4">
    <h2 className="t-h2 border-b border-border pb-2">{title}</h2>
    {children}
  </section>
);
const Row = ({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className="space-y-2">
    {label && <p className="t-caption text-text-subtle">{label}</p>}
    <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
  </div>
);

const COLORS: [string, string][] = [
  ['bg-app', '--bg-app'],
  ['surface', '--surface'],
  ['surface-muted', '--surface-muted'],
  ['border', '--border'],
  ['text', '--text'],
  ['text-muted', '--text-muted'],
  ['text-subtle', '--text-subtle'],
  ['primary', '--primary'],
  ['primary-hover', '--primary-hover'],
  ['primary-strong', '--primary-strong'],
  ['primary-soft', '--primary-soft'],
  ['primary-softer', '--primary-softer'],
  ['ink', '--ink'],
  ['success', '--success'],
  ['success-soft', '--success-soft'],
  ['warning', '--warning'],
  ['warning-soft', '--warning-soft'],
  ['danger', '--danger'],
  ['danger-soft', '--danger-soft'],
  ['info', '--info'],
  ['info-soft', '--info-soft'],
];
const TYPES = [
  ['t-display', 'display — Bonjour !'],
  ['t-h1', 'h1 — Titre de page'],
  ['t-h2', 'h2 — Titre de carte'],
  ['t-h3', 'h3 — Titre d’élément de liste'],
  ['t-body', 'body — Texte courant de l’interface'],
  ['t-small', 'small — Description, libellé secondaire'],
  ['t-caption', 'caption — Métadonnées, étiquettes'],
  ['t-kpi', 'kpi — 1 234,56 $'],
] as const;

export function DesignPage() {
  const { theme, reduceEffects, update } = useUi();
  const [step, setStep] = React.useState(2);
  const [modal, setModal] = React.useState(false);
  const [sw, setSw] = React.useState(true);
  const [text, setText] = React.useState('');
  const [sel, setSel] = React.useState(1);

  return (
    <>
      <PageHeader
        title="Design system"
        breadcrumb={['Développeur', 'Design system']}
        toolbar={
          <>
            <div
              role="radiogroup"
              aria-label="Thème"
              className="inline-flex gap-1 rounded-full bg-surface-muted p-1"
            >
              {(['clair', 'sombre'] as const).map((v) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={theme === v}
                  onClick={() => update({ theme: v })}
                  className={cn(
                    't-small cursor-pointer rounded-full px-5 py-1.5 font-medium transition-all',
                    theme === v ? 'bg-surface text-text shadow-sm' : 'text-text-muted',
                  )}
                >
                  {v === 'clair' ? 'Clair' : 'Sombre'}
                </button>
              ))}
            </div>
            <label className="t-small flex items-center gap-2 text-text-muted">
              <Switch
                checked={reduceEffects}
                onCheckedChange={(c) => update({ reduceEffects: c })}
                label="Réduire les effets"
              />
              Réduire les effets
            </label>
          </>
        }
      />
      <div className="space-y-12 px-8 pb-16">
        <Section id="couleurs" title="Couleurs (tokens)">
          <div className="grid grid-cols-7 gap-3">
            {COLORS.map(([name, v]) => (
              <div key={name} className="space-y-1.5">
                <div
                  className="h-12 rounded-md border border-border"
                  style={{ background: `var(${v})` }}
                />
                <p className="t-caption">{name}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div
              className="grid h-16 place-items-center rounded-lg t-caption text-white"
              style={{ background: 'var(--primary-gradient)' }}
            >
              primary-gradient
            </div>
            <div
              className="grid h-16 place-items-center rounded-lg border border-border t-caption"
              style={{ background: 'var(--bg-app-gradient)' }}
            >
              bg-app-gradient
            </div>
          </div>
        </Section>

        <Section id="typo" title="Typographie">
          <div className="space-y-2 rounded-lg border border-border p-5">
            {TYPES.map(([c, t]) => (
              <p key={c} className={c}>
                {t}
              </p>
            ))}
            <p className="font-serif text-[16px] leading-7">
              Aperçu de document (Source Serif 4) — « La problématique de ce mémoire porte sur… »
            </p>
          </div>
        </Section>

        <Section id="formes" title="Rayons et ombres">
          <Row className="gap-5">
            {(['sm', 'md', 'lg', 'xl', '2xl', 'full'] as const).map((r) => (
              <div
                key={r}
                className={cn(
                  'grid size-20 place-items-center border border-border bg-surface-muted t-caption',
                  `rounded-${r}`,
                )}
              >
                {r}
              </div>
            ))}
          </Row>
          <Row className="gap-6 rounded-lg bg-surface-muted p-6">
            {(['sm', 'md', 'lg', 'glow'] as const).map((s) => (
              <div
                key={s}
                className={cn(
                  'grid size-24 place-items-center rounded-lg bg-surface t-caption',
                  `shadow-${s}`,
                )}
              >
                shadow-{s}
              </div>
            ))}
            <div className="glass grid size-24 place-items-center rounded-lg t-caption">verre</div>
          </Row>
        </Section>

        <Section id="boutons" title="Boutons">
          {(['primary', 'secondary', 'ink', 'ghost', 'danger'] as const).map((v) => (
            <Row key={v} label={v}>
              <Button variant={v} size="sm">
                Petit
              </Button>
              <Button variant={v}>Moyen</Button>
              <Button variant={v} size="lg">
                <Plus className="size-4" />
                Grand
              </Button>
              <Button
                variant={v}
                className={
                  v === 'primary'
                    ? 'bg-primary-hover shadow-glow'
                    : v === 'secondary'
                      ? 'bg-primary-softer'
                      : v === 'ghost'
                        ? 'bg-primary-softer text-primary-strong'
                        : 'opacity-90'
                }
              >
                Survol
              </Button>
              <Button variant={v} className="outline-2 outline-offset-2 outline-primary">
                Focus
              </Button>
              <Button variant={v} className="scale-[0.98]">
                Actif
              </Button>
              <Button variant={v} disabled>
                Désactivé
              </Button>
              <Button variant={v} loading>
                Chargement
              </Button>
            </Row>
          ))}
          <Row label="Pied de modale / wizard (paire secondary + primary de même largeur)">
            <div className="grid w-96 grid-cols-2 gap-3">
              <Button variant="secondary" size="lg">
                Précédent
              </Button>
              <Button size="lg">Continuer</Button>
            </div>
          </Row>
        </Section>

        <Section id="champs" title="Champs et saisie">
          <div className="grid grid-cols-2 gap-6">
            <Row label="Input · Select · Switch">
              <Input placeholder="Champ de texte" className="max-w-64" />
              <Input placeholder="Désactivé" disabled className="max-w-64" />
              <Select aria-label="Exemple">
                <option>Option A</option>
                <option>Option B</option>
              </Select>
              <Switch checked={sw} onCheckedChange={setSw} label="Exemple" />
              <Switch checked={false} onCheckedChange={() => {}} label="Exemple désactivé" />
            </Row>
            <Row label="SuggestionChip">
              <SuggestionChip>Impact du mobile money sur l'inclusion financière</SuggestionChip>
              <SuggestionChip>Gestion des ressources humaines en PME</SuggestionChip>
            </Row>
          </div>
          <Composer
            value={text}
            onChange={setText}
            placeholder="Décrivez le thème de votre mémoire…"
          />
          <div className="grid grid-cols-2 gap-6">
            <Dropzone
              title="Déposez vos documents ici"
              help="PDF, DOCX, TXT, CSV ou XLSX. Vos fichiers restent sur votre ordinateur."
            />
            <div className="space-y-3">
              <Dropzone
                title="Dépôt en cours (état drag-over)"
                dragOver
                help="Relâchez pour importer."
                className="py-5"
              />
              <FileRow
                name="cours-methodologie.pdf"
                meta="PDF · 2,4 Mo · analyse en cours…"
                progress={64}
              />
              <FileRow name="enquete-terrain.xlsx" meta="XLSX · 310 Ko · terminé" progress={100} />
            </div>
          </div>
        </Section>

        <Section id="cartes" title="Cartes">
          <WelcomeBanner
            date="Samedi 3 octobre 2026"
            title="Bonjour !"
            subtitle="Voici l'avancement de vos missions."
          />
          <div className="grid grid-cols-3 gap-4 pt-4">
            <KpiCard
              icon={<IconBubble icon={BookOpen} size={48} />}
              value="42"
              label="Sources vérifiées"
            />
            <KpiCard
              icon={<IconBubble icon={Wallet} size={48} />}
              value="12,40 $"
              label="Crédit OpenRouter"
              active
            />
            <KpiCard
              icon={<IconBubble icon={Scale} size={48} />}
              value="14,5 / 20"
              label="Note du jury"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ActionCard
              title="Mémoire de master — Inclusion financière"
              meta="Phase P5 · Rédaction · 38 %"
              illustration={<Illustration icon={FileSearch} size={64} />}
            >
              <ProgressBar value={38} />
            </ActionCard>
            <ActionCard
              selected
              title="Rapport de stage — Banque régionale"
              meta="Phase P3 · Recherche"
              illustration={<Illustration icon={Library} size={64} />}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <QuickActionCard
              icon={GraduationCap}
              title="Mémoire de master"
              description="Un mémoire de recherche complet aux normes de votre établissement."
            />
            <QuickActionCard
              icon={BookOpen}
              title="Revue de littérature"
              description="Une synthèse documentaire structurée, avec sources vérifiées."
            />
            <QuickActionCard
              icon={Rocket}
              title="Rapport de stage"
              description="Présentation de la structure, déroulement et analyse critique."
              disabled
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {['Mémoire A', 'Mémoire B', 'Mémoire C'].map((t, i) => (
              <FolderCard
                key={t}
                title={t}
                count={`${12 + i * 7} sources`}
                meta={`${(1.2 + i).toFixed(1)} Mo · 3 oct. 2026`}
                selected={sel === i}
                onClick={() => setSel(i)}
                onKeyDown={(e) => e.key === 'Enter' && setSel(i)}
              />
            ))}
          </div>
        </Section>

        <Section id="statuts" title="Statuts, avatars, progression">
          <Row label="StatusBadge">
            <StatusBadge>Prévue</StatusBadge>
            <StatusBadge tone="info">Recherche</StatusBadge>
            <StatusBadge tone="primary">Rédaction</StatusBadge>
            <StatusBadge tone="warning">Révision du jury</StatusBadge>
            <StatusBadge tone="success">Validée</StatusBadge>
            <StatusBadge tone="danger">Erreur</StatusBadge>
          </Row>
          <Row label="AgentAvatar (actif = pulsation)">
            <AgentAvatar role="researcher" active />
            <AgentAvatar role="writer" />
            <AgentAvatar role="jury" />
            <AgentAvatar role="verifier" />
            <AgentAvatar role="analyst" />
          </Row>
          <div className="grid max-w-xl gap-3">
            <ProgressBar value={72} label="Progression" />
            <ProgressBar value={55} tone="warning" label="Budget" />
            <ProgressBar value={90} tone="success" label="Sources" animated />
          </div>
          <Row label="Skeleton">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-40" />
          </Row>
        </Section>

        <Section id="nav" title="Navigation">
          <Stepper
            steps={[
              'Type',
              'Sujet',
              'Établissement',
              'Normes',
              'Documents',
              'Paramètres',
              'Récapitulatif',
            ]}
            current={step}
          />
          <Row>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Précédent
            </Button>
            <Button size="sm" onClick={() => setStep((s) => Math.min(6, s + 1))}>
              Suivant
            </Button>
          </Row>
          <Tabs defaultValue="activite">
            <TabsList>
              {['Activité', 'Plan', 'Sources', 'Jury'].map((t) => (
                <TabsTrigger key={t} value={t.toLowerCase().replace('é', 'e')}>
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="activite" className="t-small pt-3 text-text-muted">
              Contenu de l'onglet Activité.
            </TabsContent>
          </Tabs>
          <div className="h-[420px] overflow-hidden rounded-xl border border-border">
            <Sidebar
              nav={[
                { to: '/', label: 'Accueil', icon: Home, end: true },
                { to: '/missions', label: 'Mes missions', icon: Library },
              ]}
              footerNav={[{ to: '/parametres', label: 'Paramètres', icon: Settings }]}
              recent={[
                { id: '1', title: 'Inclusion financière' },
                { id: '2', title: 'Rapport de stage' },
              ]}
              credit={
                <CreditCard amount="12,40 $" ratio={0.62} note="restant" actionLabel="Recharger" />
              }
            />
          </div>
        </Section>

        <Section id="panneaux" title="Panneaux">
          <div className="grid grid-cols-3 gap-6">
            <div className="rounded-xl border border-border p-6">
              <InfoPanel title="Indicateurs">
                <InfoCard label="Budget utilisé" value="4,12 $ / 15 $" ratio={0.27} />
                <InfoCard label="Crédit restant" value="12,40 $" ratio={0.62} tone="success" />
                <PropertyList
                  items={[
                    { label: 'Phase', value: 'P5' },
                    { label: 'Ronde', value: '1 / 3' },
                    { label: 'Sources', value: '42' },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="primary">Master</StatusBadge>
                  <StatusBadge tone="info">Mixte</StatusBadge>
                </div>
              </InfoPanel>
            </div>
            <div className="rounded-xl border border-border p-6">
              <ActivityFeed
                title="Activité"
                actionLabel="Voir le journal"
                items={[
                  {
                    id: '1',
                    role: 'researcher',
                    title: 'Chercheur (chap. 2)',
                    description: '14 nouvelles sources trouvées sur OpenAlex',
                    time: 'il y a 2 min',
                    agents: ['researcher', 'verifier'],
                  },
                  {
                    id: '2',
                    role: 'writer',
                    title: 'Rédacteur',
                    description: 'Section 2.3 rédigée (1 240 mots)',
                    time: 'il y a 9 min',
                    agents: ['writer'],
                  },
                  {
                    id: '3',
                    role: 'jury',
                    title: 'Jury',
                    description: 'Chapitre 2 noté 13,5/20 — à réviser',
                    time: 'il y a 21 min',
                    agents: ['jury', 'writer'],
                  },
                ]}
              />
            </div>
            <div className="rounded-xl border border-border p-6">
              <NoticeList
                title="Alertes et activité"
                onSeeAll={() => {}}
                items={[
                  {
                    id: '1',
                    title: 'Peu de sources pour la section 3.2',
                    text: 'Peu de sources africaines récentes ont été trouvées. Vous pouvez en importer.',
                  },
                  {
                    id: '2',
                    title: 'Budget à 80 %',
                    text: 'Le budget maximal sera bientôt atteint.',
                  },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section id="retours" title="Modale, toasts, état vide">
          <Row>
            <Button onClick={() => setModal(true)}>Ouvrir une modale</Button>
            <Modal
              open={modal}
              onOpenChange={setModal}
              title="Lancer la mission ?"
              description="Après validation, l'agent travaille en autonomie. Vous pourrez mettre en pause à tout moment."
              confirmLabel="Valider et lancer"
              onConfirm={() => setModal(false)}
            />
          </Row>
          <Row className="items-start">
            <Toast
              tone="success"
              title="Clé valide"
              description="La connexion à OpenRouter fonctionne."
            />
            <Toast
              tone="warning"
              title="Budget à 80 %"
              description="Pensez à recharger votre crédit."
            />
            <Toast
              tone="danger"
              title="Crédit épuisé"
              description="Rechargez puis cliquez sur Reprendre."
            />
          </Row>
          <div className="rounded-xl border border-border">
            <EmptyState
              icon={Sparkles}
              title="Aucune mission pour l'instant"
              text="Créez votre première mission pour démarrer."
              action={
                <Button>
                  <Plus className="size-4" />
                  Nouvelle mission
                </Button>
              }
            />
          </div>
          <Row label="Bulles d'icônes">
            <IconBubble icon={Search} />
            <IconBubble icon={Download} variant="glass" size={56} />
          </Row>
        </Section>
      </div>
    </>
  );
}
