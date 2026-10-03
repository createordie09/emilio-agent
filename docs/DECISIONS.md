# Journal des décisions (ADR courts)

Format : contexte → décision → conséquences. Référence au cahier des charges (§) quand pertinent.

## ADR-001 — Nom de l'application : « emilio agent » (J1)

- **Contexte** : le CdC emploie « Iroko Mémoire (nom provisoire) » ; le porteur confirme que le vrai nom est « emilio agent ».
- **Décision** : constante unique `APP_NAME` dans `packages/shared/src/constants.ts` ; dépôt `emilio-agent` ; paquets `@emilio/*` ; base `emilio.db` ; API du preload `window.api` (au lieu de `window.iroko`) ; archive de mission `.emilio` (au lieu de `.iroko`, §3.1 EF-12) ; en-tête d'attribution OpenRouter `X-OpenRouter-Title: emilio agent`.
- **Conséquences** : le nom reste modifiable en un point ; les mentions « Iroko » du CdC sont lues comme « emilio agent ».

## ADR-002 — Versions et outillage (J1)

- **Décision** : pnpm 10 (workspaces), Node ≥ 22, Electron 44.5.1, electron-vite 5 + Vite 7, React 19, Tailwind CSS 4, TypeScript 5.9, Vitest 3, zod 4, better-sqlite3 13, sqlite-vec 0.1.9, Playwright.
- **Pourquoi pas « la toute dernière » partout** : electron-vite 5 ne déclare le support que de Vite ≤ 7 ; typescript-eslint n'accepte pas encore TypeScript ≥ 6.1 ; on retient donc des versions mutuellement compatibles et testées.
- **Conséquences** : montée de version à revoir à chaque jalon (voir `pnpm outdated`).

## ADR-003 — Tailwind 4 : tokens en CSS (J1, §6.1.3)

- **Contexte** : le CdC parle d'un `tailwind.config`, qui n'existe plus dans Tailwind 4 (configuration CSS via `@theme`).
- **Décision** : `renderer/src/styles/tokens.css` est l'unique source des valeurs (variables `:root` / `.dark`, bloc `@theme` pour rayons, ombres, polices ; `@theme inline` pour relier les couleurs aux variables). Un test (`design-guard.test.ts`) interdit toute couleur en dur hors de ce fichier et vérifie la parité clair/sombre.
- **Thème** : classe `dark` sur `<html>` ; « Système » suit `prefers-color-scheme` ; option « Réduire les animations et effets » = classe `reduce-effects` (supprime flou et mouvement).

## ADR-004 — Architecture des processus et IPC (J1, §4.2, §19)

- Renderer : `contextIsolation`, `sandbox`, pas de Node, CSP stricte (en-tête + balise meta). Le preload n'expose que des fonctions nommées (`window.api`), jamais `ipcRenderer`.
- Le preload sandboxé ne peut pas `require()` de modules tiers : les canaux IPC sont dans `@emilio/shared/ipc` (sans dépendance, hors zod).
- Main ↔ moteur : protocole requête/réponse typé (`EngineRequest` / `EngineResponse`, `Result<T>` sérialisable avec code d'erreur interne + message en français §20). `EngineHost` supervise le moteur (3 redémarrages max en 10 min, §8.6) et rejoue l'initialisation (clé en mémoire) à chaque démarrage.
- `packages/engine` ne dépend pas d'Electron (§4.6) ; `EngineService` est testable sans processus.

## ADR-005 — Clé OpenRouter (J1, §14.6, ENF-03)

- Chiffrée par `safeStorage` dans le main, stockée sous forme base64 dans `settings` (`openrouter_key_encrypted`) avec sa version masquée (`sk-or-v1…wxyz`). Le moteur ne reçoit le clair qu'en mémoire (`setApiKey`). Le renderer ne voit jamais que la version masquée.
- Sous Linux, si Electron n'a que le backend `basic_text` (non sûr), l'enregistrement est refusé avec un message en français : jamais de stockage en clair.
- Endpoints vérifiés dans la documentation OpenRouter : `GET /api/v1/key` (documenté : limite, restant, usage) et `GET /api/v1/credits` (réponse `total_credits` / `total_usage`, utilisé pour le crédit de compte ; non détaillé sur la page de référence consultée → tolérance : si refusé, le crédit de compte reste « inconnu »). `GET /api/v1/models` est public ; prix en chaîne, USD **par jeton**, valeur négative (`-1`) = tarification variable → `null`. Capacités : `supported_parameters` contient `structured_outputs` et/ou `response_format`.
- En-têtes d'identification : `X-OpenRouter-Title` (+ `X-Title`, compatible) ; `HTTP-Referer` est optionnel et configurable (aucune URL inventée).
- Le crédit affiché ne descend jamais sous 0 (OpenRouter tolère de petits dépassements).
- Liste des modèles mise en cache 24 h dans `settings` ; en cas de panne réseau, le cache périmé est servi (ENF-07).

## ADR-006 — Module natif et ABI Electron (J1)

- `better-sqlite3` est un module natif : il doit être compilé pour l'ABI d'Electron (utilityProcess). Aucun binaire précompilé n'existe pour Electron 44, et `@electron/rebuild` doit télécharger les en-têtes depuis electronjs.org.
- **Production / poste de développement** : `electron-builder install-app-deps` (ou `@electron/rebuild`) compile pour Electron — à intégrer au script d'installation et au packaging en **J9**.
- **Environnement d'essai cloud** (en-têtes bloqués par la politique réseau) : variable `EMILIO_ENGINE_NODE=<chemin de node>` → le moteur tourne comme `child_process.fork` sous Node système, avec le même protocole. Défaut : `utilityProcess`. Utilisé par les tests E2E et les captures.
- Variable `EMILIO_INSECURE_TEST_CIPHER=1` : chiffreur factice pour les tests E2E sans trousseau système ; ignoré si l'application est packagée.
- À prévoir (J2+/J9) : Node `fetch` n'utilise pas le proxy système ; si besoin pour des réseaux d'entreprise, passer par `net.fetch` d'Electron ou un agent proxy.

## ADR-007 — Schéma SQLite initial (J1, §5)

- Migration `0001_init.sql` : toutes les tables §5.1–5.14 (+ `schema_migrations`), FTS5 externe `chunks_fts` synchronisée par triggers (tokenizer `unicode61 remove_diacritics 2` : recherche insensible aux accents).
- **Reporté à J3** : la table vectorielle `chunks_vec` (sqlite-vec), car sa dimension dépend du modèle d'embeddings, encore **[À VÉRIFIER]** (§4.1, §23.3).
- IDs UUID v7 (`uuid`), dates ISO 8601, `PRAGMA foreign_keys=ON`, WAL.

## ADR-008 — Illustrations 3D (J1, §6.1.1)

- Emplacements neutres générés en code (`Illustration` : tuile violette brillante + icône Lucide). Aucun asset tiers. Voir `docs/ASSETS.md`.

## ADR-009 — Page `/design` (J1, §6.1.10)

- Route accessible seulement si « Mode développeur » est activé (Paramètres → Apparence) ; sinon redirection vers l'accueil. Montre tokens, typographie, rayons, ombres, tous les composants et leurs états (survol / focus / actif simulés par classes).
- Captures de validation : `docs/screenshots/` (clair et sombre), régénérées par `pnpm shots` (sous Xvfb en cloud).

---

# Jalon J2 — Moteur et mode simulé

## ADR-010 — Machine à états et file de tâches (J2, §8.1, §8.2)

- Table de transitions explicite (`orchestrator/transitions.ts`), appliquée par `MissionRepo.transition` : toute transition interdite lève une erreur ; chaque transition autorisée est journalisée dans `events` (message français). Un test vérifie les 144 couples (de, vers) contre la table.
- Ajouts à la table du §8.1, nécessaires au reste du CdC : `paused_budget → running` (budget relevé ; la « finalisation anticipée P8–P9 » du §8.6 est reportée à J9), `failed → running` (« Réessayer à partir de cette étape »), `paused_* → paused`.
- File = table SQLite `tasks`, derrière l'interface `QueueAdapter` (§4.6). `enqueue` est idempotent par **clé naturelle** (`_key` dans `input_json`). `claim` : priorité décroissante puis ancienneté, dans la limite du parallélisme, bail de 10 min. `complete` ne s'applique que si la tâche est encore `running` (un rejeu tardif ne duplique rien). Effets + événement d'une tâche = une transaction (§8.3).
- `fail` incrémente `attempts` (3 par défaut) ; `release` (pause, crédit, réseau, arrêt) **n'incrémente pas** `attempts`.

## ADR-011 — Reprise après crash (J2, §8.2, §8.6)

- Au démarrage du moteur, **toutes** les tâches `running` sont libérées (et non seulement celles au bail expiré, comme le suggère littéralement le §8.2) : le moteur vient d'être lancé, aucune tâche ne peut réellement tourner, et attendre 10 min l'expiration des baux bloquerait inutilement la mission. La récupération par bail expiré reste disponible pour la supervision en cours d'exécution.
- Les missions `running` reprennent automatiquement (option `autoResumeOnStart`, vrai par défaut) ou passent en `paused`.
- Checkpoint (snapshot : phase, tâches faites, coût) à la fin de chaque phase ; la reprise repart de la table `tasks`, source de vérité, pas du checkpoint. Le contexte d'une tâche est toujours relu depuis la base (§8.3).

## ADR-012 — Client LLM, coûts et sorties structurées (J2, §14.1) — points [À VÉRIFIER] levés

- Vérifié dans la documentation OpenRouter : `POST /api/v1/chat/completions` ; `usage.prompt_tokens`, `usage.completion_tokens`, `usage.cost` (**inclus par défaut**, le paramètre `usage: {include: true}` est obsolète) ; sorties structurées via `response_format: {type: "json_schema", json_schema: {name, strict, schema}}` ; routage `provider: {require_parameters: true}` pour n'atteindre que des fournisseurs qui les gèrent ; codes d'erreur standards (400/401/402/403/408/429/502/503).
- Coût de la mission = `usage.cost` ; repli sur la grille de prix du cache `GET /models` si absent (`ModelCaller.gridCost`). L'endpoint `/generation?id=` (coût exact a posteriori) n'est pas utilisé en J2.
- Réessais (backoff exponentiel + aléa, plafonné) sur 429 / 408 / 5xx / réseau ; **aucun** sur 400 / 401 / 402 / 403 / 404. Mapping : 401/403 → `E_KEY_INVALID`, 402 → `E_NO_CREDIT`, 429 → `E_RATE_LIMIT`, 404/503 → `E_MODEL_UNAVAILABLE`, 400 → `E_BAD_REQUEST`.
- `ModelCaller` (équivalent de `callModel`) : modèle par rôle **lu dans la configuration de la mission** (jamais de défaut codé en dur ; rôle sans modèle = erreur), bascule sur `fallbackModels` si `E_MODEL_UNAVAILABLE`, contrôle de budget avant appel, journal `llm_calls` (succès et erreurs), alertes 50 / 80 / 95 % une seule fois chacune.
- Sortie d'agent : JSON validé par zod (`z.toJSONSchema` pour le schéma transmis), **un** réessai avec le message de validation renvoyé au modèle (§8.3), puis `E_SCHEMA`.

## ADR-013 — Mode simulé (J2, §21.2)

- `MockLlmClient` : déterministe, sans réseau, coût fixe, latence réglable, pannes injectables (`failNext`, crédit épuisé, hors ligne). Le mode est **par mission** (`config.llmMode`) : une mission factice ne peut jamais dépenser de crédit réel.
- `MOCK_MODEL_ID` est une étiquette (`simule/…`), pas un identifiant OpenRouter.
- Outils réservés au mode développeur (vérifié côté main, pas seulement dans l'interface) : mission factice de bout en bout (P0 → P9, 16 tâches, 15 appels simulés) et boutons de panne simulée.
- Agents de J2 : un agent générique par rôle (`demoRegistry`, sortie `{resume, manques}`) avec le bloc commun « Règles d'intégrité » ; les vrais prompts et schémas arrivent avec leurs jalons.

## ADR-014 — Comportement face aux interruptions (J2, §8.6, §20)

| Cas                             | Comportement                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crédit épuisé (402)             | tâche libérée sans pénalité, `paused_no_credit`, reprise auto dès que la sonde crédit répond OK (toutes les 15 min ; immédiate au « rechargement » simulé) |
| Budget atteint                  | `paused_budget` ; reprise manuelle après relèvement                                                                                                        |
| Réseau                          | retries avec backoff 2 s → 5 min ; au bout de 10 min : `paused_network`, sonde toutes les 30 s                                                             |
| Clé invalide (401)              | `paused` + message vers les Paramètres                                                                                                                     |
| 429 répétés                     | parallélisme ramené à 1, remonté d'un cran après 5 succès consécutifs                                                                                      |
| Échec de tâche × `max_attempts` | mission `failed` + bouton « Réessayer » (tâches échouées relancées, bloquées réactivées)                                                                   |
| Pause utilisateur               | plus de nouvelle tâche ; tâches en cours terminées, interrompues après 60 s (libérées sans pénalité)                                                       |

- Les délais d'attente de backoff par tâche sont en mémoire (sans conséquence en cas de perte : une tâche libérée est simplement reprise au tick suivant).

## ADR-015 — Dashboard de J2 provisoire

- Écrans `Mes missions` et `Mission` volontairement minimaux : composants existants du design system, frise des phases, indicateurs, tâches, flux d'événements en direct (poussés du moteur vers le renderer, regroupés sur 150 ms). À reprendre selon la DA validée et selon §6.6 (onglets, panneau d'indicateurs) en J3+.
- Version du moteur : 0.2.0.
