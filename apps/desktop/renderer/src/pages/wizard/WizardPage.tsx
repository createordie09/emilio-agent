import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  WIZARD_STEPS,
  WORK_TYPE_LABEL_FR,
  needsFieldDataWarning,
  validateStep,
  type BriefDraft,
} from '@emilio/shared';
import { Button, InfoPanel, PageHeader, PropertyList, Skeleton, Stepper } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtUsd } from '@/lib/fr';
import { useToasts } from '@/stores/toasts';
import { StepDocuments } from './StepDocuments';
import { StepExecution } from './StepExecution';
import { StepSummary } from './StepSummary';
import { StepInstitution, StepNorms, StepSubject, StepType } from './steps';

const HELP = [
  "Le type de travail et le niveau d'exigence règlent la structure proposée, la longueur et la sévérité du jury simulé.",
  "Plus votre sujet est précis, meilleure sera la recherche documentaire. Vous pouvez laisser l'agent vous aider à formuler la problématique.",
  "Indiquez les exigences de votre établissement. Si vous avez son guide de rédaction, importez-le à l'étape 5 : l'agent en extraira les règles.",
  'Choisissez le profil de normes de votre établissement. Les valeurs proposées sont des usages courants, à ajuster selon votre guide.',
  "Vos documents enrichissent la base de connaissances. Les données de terrain sont analysées par du code, jamais inventées par l'IA.",
  'Un préréglage convient dans la plupart des cas. Le budget maximal protège votre crédit : la mission se met en pause avant de le dépasser.',
  "Relisez le récapitulatif. Après la création, vous pourrez encore ajuster le budget et suivre l'avancement.",
];

/** Assistant « Nouvelle mission » en 7 étapes (CdC §6.4) : enregistrement automatique, navigation libre entre étapes visitées. */
export function WizardPage() {
  const { draftId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [step, setStep] = React.useState(0);
  const [maxStep, setMaxStep] = React.useState(0);
  const [brief, setBrief] = React.useState<BriefDraft | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const { data: draft, error: loadError } = useQuery({
    queryKey: ['draft', draftId],
    // Pas de cache entre deux visites : on repart toujours de l'état enregistré (brouillon repris, autre fenêtre).
    gcTime: 0,
    queryFn: async () => {
      const r = await api.drafts.get(draftId);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
  React.useEffect(() => {
    if (draft && brief === null) setBrief(draft.brief);
  }, [draft, brief]);

  // Enregistrement automatique (debounce 600 ms).
  const dirty = React.useRef(false);
  React.useEffect(() => {
    if (!brief || !dirty.current) return;
    setSaving('saving');
    const t = setTimeout(async () => {
      const r = await api.drafts.save(draftId, brief);
      setSaving(r.ok ? 'saved' : 'error');
      if (!r.ok)
        push({
          tone: 'danger',
          title: 'Enregistrement impossible',
          description: r.error.messageFr,
        });
    }, 600);
    return () => clearTimeout(t);
  }, [brief, draftId, push]);

  const patch = React.useCallback((p: BriefDraft) => {
    dirty.current = true;
    setErrors([]);
    setBrief((b) => ({ ...(b ?? {}), ...p }));
  }, []);

  if (loadError)
    return (
      <div className="p-8">
        <p role="alert" className="t-body text-danger">
          Brouillon introuvable.
        </p>
      </div>
    );
  if (!brief || !draft)
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );

  const files = draft.files;
  const last = WIZARD_STEPS.length - 1;
  const go = (i: number) => {
    setErrors([]);
    setStep(i);
    setMaxStep((m) => Math.max(m, i));
  };
  const next = () => {
    const errs = validateStep(step, brief);
    if (errs.length) return setErrors(errs);
    go(step + 1);
  };
  const flush = async () => {
    dirty.current = false;
    const r = await api.drafts.save(draftId, brief);
    return r;
  };

  const finish = async () => {
    for (let i = 0; i < last; i++) {
      const errs = validateStep(i, brief);
      if (errs.length) {
        setStep(i);
        return setErrors(errs);
      }
    }
    setBusy(true);
    const s = await flush();
    if (!s.ok) {
      setBusy(false);
      return push({
        tone: 'danger',
        title: 'Enregistrement impossible',
        description: s.error.messageFr,
      });
    }
    const r = await api.drafts.finalize(draftId, { confirmNoFieldData: confirmed });
    setBusy(false);
    if (!r.ok)
      return push({
        tone: 'danger',
        title: 'Création impossible',
        description: r.error.detail ?? r.error.messageFr,
      });
    void qc.invalidateQueries({ queryKey: ['missions'] });
    void qc.invalidateQueries({ queryKey: ['drafts'] });
    push({ tone: 'success', title: 'Mission créée', description: 'Votre brief est enregistré.' });
    nav(`/missions/${r.value.id}`);
  };

  const discard = async () => {
    await api.drafts.remove(draftId);
    void qc.invalidateQueries({ queryKey: ['drafts'] });
    nav('/missions');
  };

  const props = { brief, patch, draftId, errors };
  const fieldFiles = files.filter((f) => f.kind === 'field_data' && f.status !== 'error').length;
  const blockFinish = needsFieldDataWarning(brief, fieldFiles) && !confirmed;

  return (
    <>
      <PageHeader
        title="Nouvelle mission"
        breadcrumb={['Mes missions', 'Nouvelle mission']}
        onBack={() => nav('/missions')}
        actions={
          <>
            <span className="t-caption text-text-subtle" aria-live="polite">
              {saving === 'saving'
                ? 'Enregistrement…'
                : saving === 'saved'
                  ? 'Brouillon enregistré'
                  : saving === 'error'
                    ? 'Échec de l’enregistrement'
                    : ''}
            </span>
            <Button variant="ghost" size="sm" onClick={discard}>
              <Trash2 className="size-4" />
              Abandonner
            </Button>
          </>
        }
      />
      <div className="flex gap-6 px-8 pb-8">
        <div className="min-w-0 flex-1 space-y-6">
          <Stepper
            steps={[...WIZARD_STEPS]}
            current={step}
            maxReachable={maxStep}
            onStepClick={go}
            className="overflow-x-auto pb-1"
          />
          <section
            className="mx-auto max-w-[760px] space-y-6 rounded-xl border border-border bg-surface p-8 shadow-md"
            aria-label={`Étape ${step + 1} : ${WIZARD_STEPS[step]}`}
          >
            <h2 className="t-h1">
              {step + 1}. {WIZARD_STEPS[step]}
            </h2>
            {errors.length > 0 && (
              <ul
                role="alert"
                className="space-y-1 rounded-md bg-danger-soft p-3 t-small text-danger"
              >
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {step === 0 && <StepType {...props} />}
            {step === 1 && <StepSubject {...props} />}
            {step === 2 && <StepInstitution {...props} />}
            {step === 3 && <StepNorms {...props} />}
            {step === 4 && <StepDocuments {...props} />}
            {step === 5 && <StepExecution {...props} />}
            {step === 6 && (
              <StepSummary
                {...props}
                files={files}
                confirmed={confirmed}
                onConfirm={setConfirmed}
              />
            )}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                variant="secondary"
                size="lg"
                disabled={step === 0}
                onClick={() => go(step - 1)}
              >
                Précédent
              </Button>
              {step < last ? (
                <Button size="lg" onClick={next}>
                  Continuer
                </Button>
              ) : (
                <Button size="lg" loading={busy} disabled={blockFinish} onClick={finish}>
                  Créer la mission
                </Button>
              )}
            </div>
          </section>
        </div>
        <aside
          className="hidden w-[300px] shrink-0 min-[1280px]:block"
          aria-label="Aide et récapitulatif"
        >
          <div className="sticky top-4 space-y-5 rounded-xl border border-border p-5">
            <InfoPanel title="Aide et récapitulatif">
              <p className="t-small rounded-md bg-primary-softer p-3 text-text-muted">
                {HELP[step]}
              </p>
              <PropertyList
                items={[
                  {
                    label: 'Type',
                    value: brief.workType ? WORK_TYPE_LABEL_FR[brief.workType] : '—',
                  },
                  { label: 'Discipline', value: brief.discipline || '—' },
                  {
                    label: 'Longueur',
                    value: brief.longueur
                      ? `${brief.longueur.min}–${brief.longueur.max} ${brief.longueur.unite}`
                      : '—',
                  },
                  { label: 'Documents', value: files.length },
                  {
                    label: 'Budget',
                    value: brief.execution?.budgetMaxUsd
                      ? fmtUsd(brief.execution.budgetMaxUsd, 0)
                      : '—',
                  },
                ]}
              />
            </InfoPanel>
          </div>
        </aside>
      </div>
    </>
  );
}
