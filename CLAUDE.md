# CLAUDE.md — emilio agent

Application desktop Electron d'agents IA autonomes pour la recherche et la rédaction de mémoires académiques en français.
Source de vérité : `docs/CAHIER_DES_CHARGES.md` (cité « CdC »). Cite les numéros de section (§) dans les commits, plans et questions.

> Nom : le CdC parle de « Iroko Mémoire (nom provisoire) » ; le projet s'appelle ici « emilio agent ». Le nom d'affichage doit venir d'une constante de configuration unique (voir DECISIONS.md, ADR-001) pour pouvoir changer sans refonte.

## Règles de travail (CdC §0, §22)

- Lire le CdC avant toute modification structurante. DOIT / DEVRAIT / PEUT = sens RFC.
- Travail **jalon par jalon** (J1 → J10, §22). En fin de jalon : tests verts, courte démo, mise à jour de `docs/DECISIONS.md` (ADR courts), puis **attendre le feu vert** avant le jalon suivant.
- Point d'arrêt obligatoire en J1 : la page `/design` doit être validée (captures clair + sombre) avant les écrans suivants.
- Tout point **[À VÉRIFIER]** : consulter la documentation officielle avant d'implémenter. Ne jamais inventer d'endpoint, de paramètre ou d'identifiant de modèle.
- Décision non couverte par le CdC : option la plus simple et robuste, documentée dans `docs/DECISIONS.md`.

## Langue

- **Tout texte visible par l'utilisateur est en français** (UI, erreurs §20, notifications, événements `message_fr`, livrables). Ton clair, sans jargon (« modèle d'IA », « crédit » ; les « tokens » restent visibles dans l'onglet Coûts).
- Code, identifiants et commentaires techniques : anglais accepté. Seule production en anglais : l'abstract optionnel (§15.4).

## Stack (§4.1)

Electron + electron-builder · React + TypeScript (strict) + Vite · Tailwind + shadcn/ui (Radix) · Zustand + TanStack Query · moteur Node/TS dans un `utilityProcess` · SQLite `better-sqlite3` + `sqlite-vec` + FTS5 · zod pour toute sortie d'agent · client HTTP maison pour OpenRouter · Vitest (unitaires) + Playwright (E2E) · ESLint + Prettier. Monorepo **pnpm workspaces**.

## Arborescence cible (§4.4)

```
CLAUDE.md
docs/ (CAHIER_DES_CHARGES.md, DECISIONS.md, PROMPTS.md, ASSETS.md, references/)
apps/desktop/
  electron/ (main.ts, preload.ts, ipc/)
  renderer/src/ (pages/, components/, stores/, lib/, styles/tokens.css)
packages/
  engine/   # indépendant d'Electron (§4.6) : orchestrator, queue, agents/<role>/{prompt.md,schema.ts,index.ts},
            # llm, sources, kb, verification, jury, norms, export, storage, events
  shared/   # types et schémas zod communs
resources/ (models/, norms/, templates/)
```

## Architecture — invariants

- Renderer : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP stricte. Il ne touche **jamais** au réseau ni à la DB ; il passe par `window.iroko.*` (preload typé).
- Le moteur (`packages/engine`) **ne dépend pas d'Electron** ; il passe par des adaptateurs `StorageAdapter`, `VectorAdapter`, `QueueAdapter`, `EmbeddingAdapter`, `FileAdapter` (§4.6). Rien de Cloudflare en V1.
- Tout le réseau sort du moteur. File de tâches **persistée en SQLite** (jamais en mémoire seule), checkpoint après chaque tâche, effets d'une tâche dans une transaction, tâches idempotentes (§8).
- Migrations SQL numérotées, jamais modifiées une fois livrées (§5.15). IDs UUID v7, dates ISO 8601.
- Un seul point d'appel LLM : `callModel(role, messages, options)` (§14.1).

## Règles d'intégrité (§12, §17) — non négociables

- **Zéro source inventée** : seules les sources en base `verified` / `partially_verified` sont citables ; tout `[@id]` inconnu ou non vérifié est rejeté par le code (§12.1).
- **Zéro citation inventée** : les citations directes doivent exister littéralement dans l'extrait (§12.2) ; idem pour les citations des fiches de lecture.
- **Zéro donnée de terrain inventée** : les données empiriques viennent exclusivement de l'utilisateur ; sinon emplacements `[DONNÉES À INSÉRER]`. Tous les calculs statistiques sont faits **par du code**, jamais par le LLM (§17, §9 P4).
- Chiffres du texte traçables vers un extrait cité ou un résultat P4 (§12.3) ; contrôle de similarité n-grammes (§12.4).
- Dédicace / remerciements jamais inventés : modèles `[À COMPLÉTER : …]` (§7.2).
- Chaque prompt système contient le bloc commun « Règles d'intégrité » et un champ `manques`.
- Charte d'utilisation (l'utilisateur reste auteur responsable) affichée à l'onboarding et à la fin de mission.

## Configuration — rien en dur

- **Jamais** de clé API, d'identifiant de modèle, de prix, ni de couleur codés en dur. Modèles/préréglages dans un JSON de config (§14.3) ; prix et contextes via `GET /models` d'OpenRouter (cache 24 h) ; couleurs via tokens.
- Clé OpenRouter : chiffrée via `safeStorage`, jamais envoyée au renderer (masquée `sk-or-…xxxx`), jamais journalisée (§14.6, ENF-03).
- Paramètres d'exécution : `ExecConfig` §7.6, avec valeurs par défaut centralisées.

## Design system (§6.1) — contraignant

- Tokens dans `apps/desktop/renderer/src/styles/tokens.css` (variables CSS `:root` / `.dark`) exposés dans la config Tailwind. **Aucune valeur de couleur, rayon, ombre ou police en dur dans un composant.**
- **Violet = seule couleur d'accent** ; les autres couleurs ne servent qu'aux statuts. Barre latérale claire, conteneur blanc arrondi 24 px sur fond dégradé doux, cartes arrondies, ombres diffuses teintées violet, verre dépoli avec parcimonie (repli opaque + option « Réduire les effets »).
- Polices embarquées via `@fontsource/*` (Poppins titres, Inter UI, Source Serif 4 aperçus de documents). Fonctionne hors ligne.
- Icônes Lucide. Pas de bouton « Upgrade / Pro » (app gratuite). Ne pas reprendre textes, marques, logos, photos des références (`docs/references/`).
- Chaque composant : états default/hover/focus-visible/active/disabled/loading, clair + sombre. Respect de `prefers-reduced-motion`. WCAG AA.
- Page `/design` (mode développeur) présentant tous les tokens et composants.

## Commandes

(Valables une fois J1 en place ; ajuster ici si elles changent.)

```
pnpm install          # dépendances (monorepo) + reconstruction des modules natifs pour Electron
pnpm dev              # Electron + Vite en développement
pnpm build            # build de production (renderer + electron + engine) → apps/desktop/out
pnpm shots            # captures DA dans docs/screenshots (sous Xvfb : xvfb-run -a -s "-screen 0 1600x3400x24" pnpm shots)
pnpm typecheck        # tsc --noEmit sur tous les packages
pnpm lint             # ESLint + Prettier --check
pnpm test             # Vitest (unitaires + intégration, mode LLM simulé)
pnpm test:e2e         # Playwright + Electron
pnpm dist             # electron-builder (installateur Windows NSIS, J9)
```

## Notes d'environnement (voir docs/DECISIONS.md ADR-006)

- Cloud / CI sans en-têtes Electron : `better-sqlite3` est compilé pour Node, pas pour Electron. Les E2E lancent le moteur sous Node via `EMILIO_ENGINE_NODE` ; en local normal, `utilityProcess` (défaut) après `electron-builder install-app-deps`.
- E2E : `pnpm build` puis `cd apps/desktop && xvfb-run -a npx playwright test` (root ⇒ `--no-sandbox`, déjà passé par les helpers).
- Le preload sandboxé n'importe que `@emilio/shared/ipc` (pas de zod).

## Moteur (J2)

- Missions : `MissionRepo.transition` (table §8.1) → file `SqliteQueue` → `MissionRunner` (planificateur) → `ModelCaller` (seul point d'appel LLM). Mode simulé par mission (`config.llmMode`), jamais d'appel payant en test.
- Mission factice : mode développeur → « Mes missions » → bouton « Lancer une mission factice » ; boutons de panne simulée sur la page de la mission.

## Base de connaissances et assistant (J3)

- Import → `IngestService` (copie, extraction PDF/DOCX/TXT, profil CSV/XLSX, découpage, embeddings, FTS5 + sqlite-vec) ; recherche hybride `KbStore.search`. Modèle d'embeddings : `pnpm models:fetch` (sinon repli lexical `HashEmbedder`).
- Brouillons = missions `draft` (`DraftService`) ; brief zod dans `@emilio/shared` (`brief.ts`). Préréglages et profils de normes : `resources/*.json` (jamais d'identifiant de modèle dans le code).
- Seuls les documents de référence (`sources.type != 'document_interne'`) sont citables.
- Fixtures de test : `packages/engine/test/fixtures` (régénérables par `generate.mjs`).

## Sources documentaires (J4)

- Connecteurs `packages/engine/src/sources/*` (HTTP commun : cache, débit, réessais) → `ResearchService` (requêtes → recherche → dédoublonnage → classement → vérification §12.1 → fiches de lecture). Citations contrôlées littéralement par le code ; une panne réseau ne rejette jamais une source.
- Poids de qualité : `resources/quality-weights.json`. Prompts : `docs/PROMPTS.md`.
- Les API n'ont **pas** été validées en réel (réseau bloqué dans le cloud) : `EMILIO_CONTACT_EMAIL=… pnpm sources:check` sur une machine avec accès.

## Cadrage et plan (J5)

- `PlanningService` (`packages/engine/src/planning/`) : P1 (cadrage) → recherche exploratoire (`ResearchService.explore`) → P2 (Architecte) → `outline_nodes` ; édition (`OutlineRepo`), validation (fige `plan_json`, met P3 en file). Réglages : `resources/plan-config.json`, `resources/estimation.json`, gabarits `resources/norms/structures/*.json`. Estimation : `llm/estimate.ts`.
- Écran : `/missions/:id/plan` (`PlanPage`). Le plan n'est éditable qu'en `awaiting_plan_validation`. Mode simulé d'une mission (mode développeur) : « Mode simulé » au stade brief.
- Le code décide de la structure, des mots et de la numérotation ; l'agent propose seulement titres, objectifs, questions et sources pressenties (alias fournis).

## Analyse des données et rédaction (J6)

- P4 : `packages/engine/src/stats/` (calculs, vérifiés contre des valeurs de tables) + `analysis/` (le modèle choisit et interprète, le code valide, calcule et contrôle les nombres). P5 : `writing/` — `SectionWriter` (contexte §8.4 → rédacteur → contrôles `checks.ts` → vérificateur d'ancrage → correction ciblée → suppression des phrases fautives → résumé).
- Règles : seuls les alias `A…` / `E…` sont montrés au modèle ; marqueur inconnu = refusé ; citation = littérale ; nombre = justifié ; aucune donnée de terrain inventée (trame `[DONNÉES À INSÉRER]`) ; dédicace / remerciements = `[À COMPLÉTER]`. Réglages : `resources/writing-config.json`.
- Tâches : `p4.analyse`, `p5.redaction.<nœud>` (chaînées par chapitre), `p5.general.<nœud>`, `p5.liminaires`. La mission s'arrête après P5 (`stopAfterPhase`).

## Jury et révisions (J7)

- `packages/engine/src/jury/` : `JuryService` (P6 par chapitre : jurés → consolidation par le code → président → recherche complémentaire → révision → réévaluation ; P7 : harmonisation, évaluation globale, `refreshFinal`). Réglages : `resources/jury-config.json` (grille C1–C9, seuils, plafonds).
- Les jurés ne notent que leurs critères ; totaux et verdicts **toujours recalculés par le code**. Une révision qui dégrade est annulée ; toutes les versions sont conservées (`drafts.version`, `current_version_id`).
- Tâches : `p6.review.<chapitre>`, `p7.global`, `p7.finalize` ; la mission s'arrête après P7. `ModelCaller` limite les appels simultanés par mission.
- Écran : onglets Jury et Brouillons de la page mission (`JuryPanel`, `DraftsPanel`, diff dans `renderer/src/lib/diff.ts`).
- Tests : `test/pipeline.ts` (`runMission`, `withJury` — sans cette option, P6/P7 sont ignorées par les tests de rédaction).

## Livrables (J8)

- `packages/engine/src/export/` : `assemble.ts` (plan + versions courantes → `DocModel` : citations CSL via `bibliography.ts`, typographie, sigles, listes, tableaux/figures renumérotés, annexes) → `docx.ts`, `html.ts` (+ PDF), `pptx.ts`, `fiche.ts`, `report.ts`, `final-check.ts` ; `ExportService` orchestre. Réglages : `resources/export-profiles.json` (profil → style CSL), `resources/export-config.json`, styles dans `resources/csl/`, police des figures dans `resources/fonts/`.
- Tâches : `p8.format`, `p9.docx`, `p9.pdf`, `p9.slides`, `p9.fiche`, `p9.final`, `p9.report` (selon `brief.livrables`). Le moteur ne rend pas le PDF lui-même : `PdfAdapter` → message `host` vers le processus principal (`printToPDF`).
- Une source non citable ou un marqueur inconnu n'apparaît jamais dans un livrable ; sigles, dédicace, remerciements, page de garde incomplète : `[À COMPLÉTER]`.
- Écran : onglet Livrables (`DeliverablesPanel`). Dépendances natives (`@resvg/resvg-js`…) à déclarer aussi dans `apps/desktop/package.json` (sinon elles sont embarquées dans le bundle et ne se chargent pas).
- Tests : `test/export.test.ts` ; `runMission({ withExport: true })` (sans cette option P8/P9 sont ignorées).

## Robustesse et finition (J9)

- `packages/engine/src/ops/` : `OpsService` (préférences `AppPrefs`, coûts, journal technique, budget atteint → `raiseBudget` / `finalizeNow`, zip des journaux), `archive.ts` (export / import de mission `.emilio`), `logger.ts` (journal fichier rotatif), `costs.ts`. Les appels de modèle portent `agent_role` et `mission_id` (migration 0008).
- Processus principal (`apps/desktop/electron/`) : `notifier.ts` (notifications), `power.ts` (anti-veille), `updater.ts` (`electron-updater`, version installée seulement) — logique pure, testée dans `apps/desktop/test/ops.test.ts`. Dialogues « Enregistrer sous » / « Ouvrir » injectés dans les handlers.
- Interface : `Onboarding` (portail plein écran, charte obligatoire), `BudgetActions`, onglets `CostsPanel` / `TechLogPanel`, réglages « Missions et confidentialité ». E2E : `EMILIO_SKIP_ONBOARDING=1` par défaut (helpers), `launchApp({ onboarding: true })` pour le tester.
- Packaging : `pnpm --filter @emilio/desktop dist` (dossier, vérification) ; `dist:win` sous Windows ; `electron-builder.yml`, `.github/workflows/release.yml`. Dans le cloud, ajouter `-c.npmRebuild=false` (pas d'en-têtes Electron, ADR-006). Dépendances du renderer et paquets du dépôt en `devDependencies` du desktop.
- La mission n'a plus de `stopAfterPhase` : elle va de P0 à P9.

## Qualité

TypeScript `strict`, ESLint + Prettier, aucune sortie d'agent non validée par zod. Mode LLM simulé (mock) obligatoire dès J2 (§21.2) : aucun test ne doit faire d'appel payant.
