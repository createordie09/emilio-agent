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

## Qualité

TypeScript `strict`, ESLint + Prettier, aucune sortie d'agent non validée par zod. Mode LLM simulé (mock) obligatoire dès J2 (§21.2) : aucun test ne doit faire d'appel payant.
