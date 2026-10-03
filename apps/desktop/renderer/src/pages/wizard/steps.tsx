import { Info } from 'lucide-react';
import {
  LIMINAIRES,
  LIMINAIRE_LABEL_FR,
  WORK_TYPES,
  WORK_TYPE_LABEL_FR,
  type Liminaire,
  type WorkType,
} from '@emilio/shared';
import {
  Checkbox,
  Field,
  Input,
  ListEditor,
  OptionCard,
  SegmentedControl,
  Select,
  Textarea,
} from '@/components/ui';
import { DISCIPLINES, sub, type StepProps } from './types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const WORK_DESC: Record<WorkType, string> = {
  memoire_licence: 'Recherche encadrée de fin de licence.',
  memoire_master: 'Mémoire de recherche ou professionnel de master.',
  these_chapitres: 'Un ou plusieurs chapitres de thèse.',
  rapport_stage: 'Présentation de la structure d’accueil et analyse critique.',
  rapport_formation_pro: 'Rapport de fin de formation professionnelle.',
  projet_pro: 'Projet professionnel avec plan d’action.',
  article: 'Article scientifique au format IMRaD.',
  revue_litterature: 'Synthèse documentaire structurée.',
};

/** Étape 1 — Type de travail (CdC §6.4). */
export function StepType({ brief, patch }: StepProps) {
  return (
    <div className="space-y-6">
      <Field label="Type de travail" required>
        <div role="radiogroup" aria-label="Type de travail" className="grid grid-cols-2 gap-3">
          {WORK_TYPES.map((t) => (
            <OptionCard
              key={t}
              selected={brief.workType === t}
              onSelect={() => patch({ workType: t })}
              title={WORK_TYPE_LABEL_FR[t]}
              description={WORK_DESC[t]}
            />
          ))}
        </div>
      </Field>
      <Field
        label="Niveau d'exigence"
        hint="Il règle la sévérité du jury simulé : plus il est élevé, plus la note exigée pour valider une section est haute."
      >
        <SegmentedControl
          label="Niveau d'exigence"
          value={brief.exigence}
          onChange={(v) => patch({ exigence: v })}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'eleve', label: 'Élevé' },
            { value: 'tres_eleve', label: 'Très élevé' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Discipline" required htmlFor="discipline">
          <Input
            id="discipline"
            list="disciplines"
            value={brief.discipline ?? ''}
            onChange={(e) => patch({ discipline: e.target.value })}
            placeholder="Ex. Sciences de gestion"
          />
          <datalist id="disciplines">
            {DISCIPLINES.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <Field label="Spécialité" htmlFor="specialite">
          <Input
            id="specialite"
            value={brief.specialite ?? ''}
            onChange={(e) => patch({ specialite: e.target.value })}
            placeholder="Ex. Finance et microfinance"
          />
        </Field>
      </div>
    </div>
  );
}

/** Étape 2 — Le sujet. */
export function StepSubject({ brief, patch }: StepProps) {
  const terrain = brief.terrain ?? {};
  return (
    <div className="space-y-6">
      <Field label="Thème ou titre provisoire" required htmlFor="titre">
        <Input
          id="titre"
          value={brief.titre ?? ''}
          onChange={(e) => patch({ titre: e.target.value })}
          placeholder="Ex. Microfinance et inclusion financière des ménages ruraux au Bénin"
        />
      </Field>
      <Field
        label="Problématique"
        required
        htmlFor="problematique"
        hint="La question centrale de votre travail."
      >
        <Textarea
          id="problematique"
          value={brief.problematique ?? ''}
          disabled={brief.problematiqueAProposer}
          onChange={(e) => patch({ problematique: e.target.value })}
          placeholder="Dans quelle mesure… ?"
        />
        <Checkbox
          checked={Boolean(brief.problematiqueAProposer)}
          onCheckedChange={(c) => patch({ problematiqueAProposer: c })}
          label="Je veux que l'agent m'aide à la formuler"
          description="Il vous proposera trois formulations à l'étape du plan."
        />
      </Field>
      <Field label="Questions de recherche">
        <ListEditor
          label="Question de recherche"
          items={brief.questionsRecherche ?? []}
          onChange={(v) => patch({ questionsRecherche: v })}
          placeholder="Ajoutez une question puis Entrée"
        />
      </Field>
      <Field label="Objectif général" htmlFor="objgen">
        <Input
          id="objgen"
          value={brief.objectifGeneral ?? ''}
          onChange={(e) => patch({ objectifGeneral: e.target.value })}
        />
      </Field>
      <Field label="Objectifs spécifiques">
        <ListEditor
          label="Objectif spécifique"
          items={brief.objectifsSpecifiques ?? []}
          onChange={(v) => patch({ objectifsSpecifiques: v })}
          placeholder="Ajoutez un objectif puis Entrée"
        />
      </Field>
      <Field label="Hypothèses (facultatif)">
        <ListEditor
          label="Hypothèse"
          items={brief.hypotheses ?? []}
          onChange={(v) => patch({ hypotheses: v })}
          placeholder="Ajoutez une hypothèse puis Entrée"
        />
      </Field>
      <fieldset className="space-y-3">
        <legend className="t-h3">Terrain d'étude</legend>
        <div className="grid grid-cols-2 gap-4">
          <Input
            aria-label="Pays"
            placeholder="Pays"
            value={terrain.pays ?? ''}
            onChange={(e) => patch(sub(brief, 'terrain', { pays: e.target.value }))}
          />
          <Input
            aria-label="Ville"
            placeholder="Ville"
            value={terrain.ville ?? ''}
            onChange={(e) => patch(sub(brief, 'terrain', { ville: e.target.value }))}
          />
          <Input
            aria-label="Structure ou entreprise"
            placeholder="Structure / entreprise"
            value={terrain.structure ?? ''}
            onChange={(e) => patch(sub(brief, 'terrain', { structure: e.target.value }))}
          />
          <Input
            aria-label="Période"
            placeholder="Période (ex. 2024-2025)"
            value={terrain.periode ?? ''}
            onChange={(e) => patch(sub(brief, 'terrain', { periode: e.target.value }))}
          />
        </div>
      </fieldset>
      <Field label="Approche méthodologique">
        <SegmentedControl
          label="Approche méthodologique"
          value={brief.approche}
          onChange={(v) => patch({ approche: v })}
          options={[
            { value: 'quantitative', label: 'Quantitative' },
            { value: 'qualitative', label: 'Qualitative' },
            { value: 'mixte', label: 'Mixte' },
            { value: 'documentaire', label: 'Documentaire' },
            { value: 'a_proposer', label: 'À proposer par l’agent' },
          ]}
        />
      </Field>
      <Field
        label="Mots-clés"
        hint="Cinq à dix mots-clés."
        error={(brief.motsCles?.length ?? 0) > 10 ? 'Dix mots-clés au maximum.' : undefined}
      >
        <ListEditor
          chips
          label="Mot-clé"
          max={10}
          items={brief.motsCles ?? []}
          onChange={(v) => patch({ motsCles: v })}
          placeholder="Ajoutez un mot-clé puis Entrée"
        />
      </Field>
    </div>
  );
}

/** Étape 3 — Exigences de l'établissement. */
export function StepInstitution({ brief, patch }: StepProps) {
  const et = brief.etablissement ?? {};
  const au = brief.auteur ?? {};
  const l = brief.longueur ?? { unite: 'pages' as const, min: 60, max: 90 };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Établissement" htmlFor="etab">
          <Input
            id="etab"
            value={et.nom ?? ''}
            onChange={(e) => patch(sub(brief, 'etablissement', { nom: e.target.value }))}
          />
        </Field>
        <Field label="Faculté ou école" htmlFor="fac">
          <Input
            id="fac"
            value={et.faculte ?? ''}
            onChange={(e) => patch(sub(brief, 'etablissement', { faculte: e.target.value }))}
          />
        </Field>
        <Field label="Année académique" htmlFor="annee">
          <Input
            id="annee"
            placeholder="2025-2026"
            value={et.anneeAcademique ?? ''}
            onChange={(e) =>
              patch(sub(brief, 'etablissement', { anneeAcademique: e.target.value }))
            }
          />
        </Field>
      </div>
      <Field
        label="Longueur visée"
        required
        hint="Hors pages liminaires, bibliographie et annexes. Une page compte environ 300 mots."
      >
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Unité"
            value={l.unite}
            onChange={(v) => patch({ longueur: { ...l, unite: v } })}
            options={[
              { value: 'pages', label: 'Pages' },
              { value: 'mots', label: 'Mots' },
            ]}
          />
          <Input
            aria-label="Minimum"
            type="number"
            min={1}
            className="w-28"
            value={l.min}
            onChange={(e) => patch({ longueur: { ...l, min: Number(e.target.value) } })}
          />
          <span className="t-small text-text-muted">à</span>
          <Input
            aria-label="Maximum"
            type="number"
            min={1}
            className="w-28"
            value={l.max}
            onChange={(e) => patch({ longueur: { ...l, max: Number(e.target.value) } })}
          />
        </div>
      </Field>
      <Field label="Structure du document">
        <div
          role="radiogroup"
          aria-label="Structure du document"
          className="grid grid-cols-3 gap-3"
        >
          <OptionCard
            selected={brief.structure?.mode === 'standard'}
            onSelect={() => patch({ structure: { mode: 'standard' } })}
            title="Standard"
            description="Structure usuelle en Afrique francophone."
          />
          <OptionCard
            selected={brief.structure?.mode === 'importee'}
            onSelect={() => patch({ structure: { mode: 'importee' } })}
            title="Importée"
            description="Depuis le guide de votre établissement (à importer à l'étape 5)."
          />
          <OptionCard
            selected={false}
            disabled
            onSelect={() => {}}
            title="Personnalisée"
            description="Éditeur d'arbre : bientôt disponible."
          />
        </div>
      </Field>
      <Field label="Pages liminaires">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {LIMINAIRES.map((k: Liminaire) => (
            <Checkbox
              key={k}
              label={LIMINAIRE_LABEL_FR[k]}
              checked={Boolean(brief.liminaires?.[k])}
              onCheckedChange={(c) =>
                patch({
                  liminaires: { ...(brief.liminaires as Record<Liminaire, boolean>), [k]: c },
                })
              }
            />
          ))}
        </div>
        <p className="t-small flex items-start gap-2 text-text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          La dédicace et les remerciements sont personnels : l'agent prépare un modèle à compléter,
          il ne les invente jamais.
        </p>
      </Field>
      <fieldset className="space-y-3">
        <legend className="t-h3">Page de garde</legend>
        <div className="grid grid-cols-3 gap-4">
          <Input
            aria-label="Nom de l'étudiant"
            placeholder="Nom de l'étudiant"
            value={au.nom ?? ''}
            onChange={(e) => patch(sub(brief, 'auteur', { nom: e.target.value }))}
          />
          <Input
            aria-label="Directeur de mémoire"
            placeholder="Directeur de mémoire"
            value={au.directeur ?? ''}
            onChange={(e) => patch(sub(brief, 'auteur', { directeur: e.target.value }))}
          />
          <Input
            aria-label="Maître de stage"
            placeholder="Maître de stage"
            value={au.maitreStage ?? ''}
            onChange={(e) => patch(sub(brief, 'auteur', { maitreStage: e.target.value }))}
          />
        </div>
      </fieldset>
      <Field
        label="Critères d'évaluation connus du jury"
        htmlFor="crit"
        hint="Facultatif. Vous pouvez aussi importer la grille à l'étape 5."
      >
        <Textarea
          id="crit"
          value={brief.criteresJury ?? ''}
          onChange={(e) => patch({ criteresJury: e.target.value })}
        />
      </Field>
    </div>
  );
}

/** Étape 4 — Normes et format. */
export function StepNorms({ brief, patch }: StepProps) {
  const { data: profiles = [] } = useQuery({
    queryKey: ['norms'],
    queryFn: async () => {
      const r = await api.catalog.normsProfiles();
      return r.ok ? r.value : [];
    },
  });
  const mp = brief.mise_en_page ?? {};
  const choose = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    patch({
      profilNormesId: id,
      styleCitation: p.citationMode,
      mise_en_page: {
        police: p.layout.font,
        taille: p.layout.fontSize,
        interligne: p.layout.lineSpacing,
        margeCm: p.layout.marginCm,
      },
    });
  };
  const sel = profiles.find((p) => p.id === brief.profilNormesId);
  const liv = brief.livrables ?? {
    docx: true,
    pdf: true,
    pptx: false,
    fichePreparation: false,
    rapportMission: true,
  };
  return (
    <div className="space-y-6">
      <Field
        label="Profil de normes"
        hint="Ces valeurs sont des usages courants, pas une norme officielle unique : à ajuster selon le guide de votre établissement."
      >
        <div role="radiogroup" aria-label="Profil de normes" className="grid grid-cols-2 gap-3">
          {profiles.map((p) => (
            <OptionCard
              key={p.id}
              selected={brief.profilNormesId === p.id}
              onSelect={() => choose(p.id)}
              title={p.name}
              description={p.description}
            />
          ))}
        </div>
      </Field>
      {sel && (
        <div className="space-y-2 rounded-lg bg-primary-softer p-4">
          <p className="t-caption text-text-muted">Aperçu</p>
          <p className="t-small">
            <span className="font-medium">Dans le texte : </span>
            <span className="font-serif">{sel.exampleCitation}</span>
          </p>
          <p className="t-small">
            <span className="font-medium">Dans la bibliographie : </span>
            <span className="font-serif">{sel.exampleReference}</span>
          </p>
        </div>
      )}
      <Field label="Style de citation dans le texte">
        <SegmentedControl
          label="Style de citation"
          value={brief.styleCitation}
          onChange={(v) => patch({ styleCitation: v })}
          options={[
            { value: 'auteur_date', label: 'Auteur-date' },
            { value: 'notes', label: 'Notes de bas de page' },
          ]}
        />
      </Field>
      <fieldset className="space-y-3">
        <legend className="t-h3">Mise en page</legend>
        <div className="grid grid-cols-4 gap-4">
          <Input
            aria-label="Police"
            placeholder="Police"
            value={mp.police ?? ''}
            onChange={(e) => patch(sub(brief, 'mise_en_page', { police: e.target.value }))}
          />
          <Input
            aria-label="Taille"
            type="number"
            placeholder="Taille"
            value={mp.taille ?? ''}
            onChange={(e) =>
              patch(sub(brief, 'mise_en_page', { taille: Number(e.target.value) || undefined }))
            }
          />
          <Input
            aria-label="Interligne"
            type="number"
            step="0.1"
            placeholder="Interligne"
            value={mp.interligne ?? ''}
            onChange={(e) =>
              patch(sub(brief, 'mise_en_page', { interligne: Number(e.target.value) || undefined }))
            }
          />
          <Input
            aria-label="Marges (cm)"
            type="number"
            step="0.1"
            placeholder="Marges (cm)"
            value={mp.margeCm ?? ''}
            onChange={(e) =>
              patch(sub(brief, 'mise_en_page', { margeCm: Number(e.target.value) || undefined }))
            }
          />
        </div>
      </fieldset>
      <Field label="Livrables" required>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Checkbox
            label="Document Word (DOCX)"
            checked={liv.docx}
            onCheckedChange={(c) => patch(sub(brief, 'livrables', { docx: c }))}
          />
          <Checkbox
            label="Document PDF"
            checked={liv.pdf}
            onCheckedChange={(c) => patch(sub(brief, 'livrables', { pdf: c }))}
          />
          <Checkbox
            label="Diaporama de soutenance (PPTX)"
            checked={liv.pptx}
            onCheckedChange={(c) => patch(sub(brief, 'livrables', { pptx: c }))}
          />
          <Checkbox
            label="Fiche de préparation à la soutenance"
            description="Questions probables du jury et éléments de réponse."
            checked={liv.fichePreparation}
            onCheckedChange={(c) => patch(sub(brief, 'livrables', { fichePreparation: c }))}
          />
          <Checkbox
            label="Rapport de mission"
            description="Sources, notes du jury et coûts."
            checked={liv.rapportMission}
            onCheckedChange={(c) => patch(sub(brief, 'livrables', { rapportMission: c }))}
          />
        </div>
        {liv.pptx && (
          <div className="flex items-center gap-3 pt-2">
            <span className="t-small text-text-muted">Nombre de diapositives</span>
            <Input
              aria-label="Nombre de diapositives"
              type="number"
              min={5}
              max={60}
              className="w-24"
              value={liv.nbDiapos ?? 15}
              onChange={(e) => patch(sub(brief, 'livrables', { nbDiapos: Number(e.target.value) }))}
            />
          </div>
        )}
      </Field>
    </div>
  );
}

export { Select };
