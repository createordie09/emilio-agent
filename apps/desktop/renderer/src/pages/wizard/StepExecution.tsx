import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { AGENT_ROLES, type AgentRole } from '@emilio/shared';
import { Field, Input, OptionCard, SegmentedControl, Select, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { roleLabelFr } from '@/lib/role-labels';
import { useModels } from '@/lib/queries';
import { sub, type StepProps } from './types';

/** Étape 6 — Paramètres d'exécution (CdC §6.4, §7.6) ; chaque réglage explique son effet sur qualité, durée et coût. */
export function StepExecution({ brief, patch }: StepProps) {
  const ex = brief.execution ?? {
    parallelism: 3,
    rondesMaxParChapitre: 3,
    rondesMaxGlobales: 2,
    profondeurRecherche: 'normale' as const,
    preferenceSources: 'toutes' as const,
  };
  const { data: presets = [] } = useQuery({
    queryKey: ['presets'],
    queryFn: async () => {
      const r = await api.catalog.presets();
      return r.ok ? r.value : [];
    },
  });
  const models = useModels();
  const preset = presets.find((p) => p.id === ex.preset);
  const custom = ex.preset === 'personnalise';
  const current = (ex.models ?? preset?.models ?? {}) as Record<string, string>;
  const set = (p: Record<string, unknown>) => patch(sub(brief, 'execution', p));

  const choose = (id: string) => {
    const p = presets.find((x) => x.id === id);
    set({ preset: id, models: p?.models ?? ex.models });
  };

  return (
    <div className="space-y-6">
      <Field
        label="Modèles d'IA"
        required
        hint="Chaque rôle d'agent utilise un modèle. Un préréglage suffit dans la plupart des cas ; les jurés utilisent une autre famille de modèles que le rédacteur, pour éviter qu'un modèle note trop généreusement son propre style."
      >
        <div
          role="radiogroup"
          aria-label="Préréglage de modèles"
          className="grid grid-cols-2 gap-3"
        >
          {presets.map((p) => (
            <OptionCard
              key={p.id}
              selected={ex.preset === p.id}
              onSelect={() => choose(p.id)}
              title={p.label}
              description={p.description}
              badge={
                p.missing.length ? (
                  <StatusBadge tone="warning">{p.missing.length} modèle(s) absent(s)</StatusBadge>
                ) : undefined
              }
            />
          ))}
          <OptionCard
            selected={custom}
            onSelect={() => set({ preset: 'personnalise', models: ex.models ?? preset?.models })}
            title="Personnalisé"
            description="Choisissez un modèle pour chaque rôle."
          />
        </div>
        {preset && preset.missing.length > 0 && (
          <p role="alert" className="t-small flex items-start gap-2 rounded-md bg-warning-soft p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            Ces modèles ne figurent plus dans la liste d'OpenRouter : {preset.missing.join(', ')}.
            Choisissez « Personnalisé » pour les remplacer.
          </p>
        )}
      </Field>

      {custom && (
        <div className="rounded-lg border border-border">
          <datalist id="model-ids">
            {models.data?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          <table className="w-full t-small">
            <tbody>
              {AGENT_ROLES.map((r: AgentRole) => (
                <tr key={r} className="border-b border-border last:border-0">
                  <td className="w-52 px-4 py-2 font-medium">{roleLabelFr(r)}</td>
                  <td className="px-2 py-1.5">
                    <Input
                      list="model-ids"
                      aria-label={`Modèle : ${roleLabelFr(r)}`}
                      value={current[r] ?? ''}
                      onChange={(e) => set({ models: { ...current, [r]: e.target.value } })}
                      placeholder="fournisseur/modèle"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.error ? (
            <p className="t-small p-3 text-warning">
              Liste des modèles indisponible : saisissez les identifiants à la main.
            </p>
          ) : null}
        </div>
      )}

      <Field
        label="Budget maximal (en dollars)"
        required
        htmlFor="budget"
        hint="La mission se met en pause avant de dépasser ce plafond. Vous pourrez le relever ensuite."
      >
        <Input
          id="budget"
          type="number"
          min={1}
          step="1"
          className="w-40"
          value={ex.budgetMaxUsd ?? ''}
          onChange={(e) => set({ budgetMaxUsd: Number(e.target.value) || undefined })}
          placeholder="Ex. 15"
        />
      </Field>

      <details className="rounded-lg border border-border p-4">
        <summary className="t-h3 cursor-pointer">Réglages avancés</summary>
        <div className="mt-4 space-y-5">
          <Field
            label="Agents en parallèle"
            hint="Plus il y en a, plus la mission va vite, mais plus vous risquez des limites de débit chez le fournisseur. Défaut : 3."
          >
            <Input
              type="number"
              min={1}
              max={8}
              className="w-28"
              aria-label="Agents en parallèle"
              value={ex.parallelism}
              onChange={(e) =>
                set({ parallelism: Math.max(1, Math.min(8, Number(e.target.value) || 3)) })
              }
            />
          </Field>
          <Field
            label="Rondes de révision par chapitre"
            hint="La première révision corrige l'essentiel, la deuxième affine, la troisième sert de filet de sécurité. Au-delà, le gain est faible et le coût grimpe. Défaut : 3."
          >
            <Input
              type="number"
              min={1}
              max={6}
              className="w-28"
              aria-label="Rondes de révision par chapitre"
              value={ex.rondesMaxParChapitre}
              onChange={(e) =>
                set({ rondesMaxParChapitre: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })
              }
            />
          </Field>
          <Field
            label="Rondes de révision globales"
            hint="Vue d'ensemble (cohérence, transitions) : un ou deux passages suffisent. Défaut : 2."
          >
            <Input
              type="number"
              min={0}
              max={4}
              className="w-28"
              aria-label="Rondes de révision globales"
              value={ex.rondesMaxGlobales}
              onChange={(e) =>
                set({ rondesMaxGlobales: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })
              }
            />
          </Field>
          <Field
            label="Note minimale du jury (sur 20)"
            hint="Une section en dessous de ce seuil est révisée. Laissez vide pour utiliser celui du niveau d'exigence choisi (14, 15 ou 16)."
          >
            <Input
              type="number"
              min={0}
              max={20}
              step="0.5"
              className="w-28"
              aria-label="Note minimale du jury"
              value={ex.seuilJury ?? ''}
              onChange={(e) =>
                set({ seuilJury: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </Field>
          <Field
            label="Profondeur de recherche"
            hint="Approfondie : plus de sources consultées, plus long et plus coûteux."
          >
            <SegmentedControl
              label="Profondeur de recherche"
              value={ex.profondeurRecherche}
              onChange={(v) => set({ profondeurRecherche: v })}
              options={[
                { value: 'rapide', label: 'Rapide' },
                { value: 'normale', label: 'Normale' },
                { value: 'approfondie', label: 'Approfondie' },
              ]}
            />
          </Field>
          <Field
            label="Nombre minimal de sources"
            hint="Défaut selon le type de travail : licence 25, master 40, thèse 80."
          >
            <Input
              type="number"
              min={0}
              className="w-28"
              aria-label="Nombre minimal de sources"
              value={ex.minSourcesTotal ?? ''}
              onChange={(e) =>
                set({ minSourcesTotal: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Préférence de sources">
            <SegmentedControl
              label="Préférence de sources"
              value={ex.preferenceSources}
              onChange={(v) => set({ preferenceSources: v })}
              options={[
                { value: 'toutes', label: 'Toutes' },
                { value: 'afrique', label: 'Priorité africaines' },
                { value: 'recentes', label: 'Priorité récentes' },
              ]}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

export { Select };
