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

## ADR-016 — Validation de la DA (point d'arrêt §22)

- Direction artistique (design system §6.1, page `/design`, captures clair et sombre de `docs/screenshots/`) **validée par le porteur du projet** le 3 octobre 2026. Les écrans des jalons suivants peuvent être construits dessus.
- Le dashboard de mission de J2 reste provisoire et sera repris selon la §6.6.

---

# Jalon J3 — Assistant « Nouvelle mission », import et base de connaissances

## ADR-017 — Embeddings locaux et recherche vectorielle (J3, §4.1, §11.5) — [À VÉRIFIER] partiellement levé

- **Choix** : `multilingual-e5-small` (famille E5, multilingue dont le français), via Transformers.js (`@huggingface/transformers`) et ONNX, **dimension 384**, préfixes `passage: ` / `query: ` (exigés par E5), vecteurs normalisés. Le dossier du modèle est lu localement (`allowRemoteModels = false`) : aucun téléchargement à l'exécution.
- **Non vérifié ici** : Hugging Face est bloqué par la politique réseau de l'environnement cloud. La taille exacte du modèle quantifié, sa licence et les noms de fichiers du dépôt `Xenova/multilingual-e5-small` restent donc **à confirmer** : le script `pnpm models:fetch` lit la liste des fichiers via l'API du dépôt (il ne devine pas les noms), prend la variante quantifiée si elle existe, écrit `SHA256SUMS` et affiche les tailles. À lancer sur votre machine, puis à vérifier avant l'embarquement (cible ENF-05 : < 400 Mo au total).
- **Repli** : sans modèle installé, `HashEmbedder` (hachage de mots et de bigrammes, déterministe, sans accents) assure l'indexation et la recherche **lexicale** ; l'interface devra l'indiquer (`semantic = false`). Il sert aussi aux tests. Il ne remplace pas la recherche sémantique.
- **Index** : `sqlite-vec` 0.1.9, table `chunks_vec` = `vec0(mission_id text partition key, embedding float[384])` (partition par mission : la recherche k-NN ne mélange jamais deux missions). Distance L2 sur vecteurs normalisés → cosinus = 1 − d²/2. Changer de modèle d'embeddings = nouvelle migration + ré-indexation. Les extraits de bibliographie ne sont pas vectorisés (§11.5).
- **Recherche hybride** : score = 0,6 × similarité vectorielle + 0,4 × BM25 (FTS5), chacun normalisé sur les candidats. Reclassement par LLM : reporté (J4+).

## ADR-018 — Lecture des fichiers (J3, §4.1, §9 P0)

- PDF : `pdfjs-dist` (build « legacy », Node) — texte par page, lignes reconstituées par ordonnée. PDF sans texte (scanné) → statut « à vérifier » + message ; **OCR non disponible** (V1.1, §4.1). DOCX : `mammoth`. TXT/MD : direct. CSV : `papaparse` (séparateur deviné, BOM, repli Windows-1252). XLSX : **`exceljs` à la place de SheetJS (`xlsx`)** — écart au §4.1 : la version publiée sur npm (0.18.5) n'est plus maintenue et présente des vulnérabilités connues (pollution de prototype, ReDoS) corrigées seulement dans les versions distribuées hors npm ; on évite d'embarquer cette dépendance pour lire des fichiers fournis par l'utilisateur. Limite : XLSX uniquement (pas `.xls`).
- Profil des données de terrain : répondants, variables, types (entier, nombre, booléen, date, catégorielle, texte), manquants, modalités, statistiques descriptives **calculées par du code** (§17). Nombres à la française (« 1 234,5 »). Avertissements : échantillon < 30, colonnes vides ou > 50 % manquantes, doublons, feuilles ignorées.
- Dépendances lourdes (`pdfjs-dist`, `mammoth`, `exceljs`, `papaparse`, `@huggingface/transformers`) **externalisées** du bundle : `pdfjs-dist` empaqueté ne retrouvait pas son worker (bug détecté par le test E2E réel, corrigé).

## ADR-019 — Découpage (J3, §11.5)

- Paragraphes reconstruits (PDF : coupure sur ligne courte finissant par une ponctuation) ; en-têtes, pieds de page et numéros de page répétés retirés (lignes de bord présentes sur ≥ 50 % des pages, minimum 3) ; titres détectés (numérotés, MAJUSCULES, mots-clés) ; bibliographie détectée (« Bibliographie », « Références », « Webographie »…) jusqu'aux annexes → `is_bibliography`, exclue de la recherche et jamais mélangée à du texte courant.
- Extraits : cible 500 mots, **300 à 800** (un paragraphe plus long est coupé aux frontières de phrase), **chevauchement d'un paragraphe** (≤ 30 % de la taille max), pages `page_from`/`page_to` conservées pour les citations. Titre de section = celui du début de l'extrait.

## ADR-020 — Brouillons, import et validation du brief (J3, §6.4, §7, §9 P0)

- **Un brouillon est une mission** au statut `draft` (`brief_json` partiel, jamais invalide) : enregistrement automatique (600 ms), reprise depuis « Brouillons en cours », suppression avec ses fichiers, extraits et vecteurs. Les brouillons n'apparaissent pas dans « Mes missions ».
- **Ingestion à l'import** (et non au lancement) : P0 est exécutée pendant l'étape 5, avec progression en direct (événements `file.updated`) ; traitement séquentiel (CPU, ENF-06), idempotent (la source et les extraits d'un fichier sont purgés avant retraitement), repris au démarrage si interrompu. Les fichiers sont **copiés** dans `missions/<id>/uploads` (SHA-256 calculé au vol ; doublon refusé) ; le texte extrait est écrit dans `parsed/`.
- Types d'import ↔ `mission_files.kind` (§5.3) : « Travail déjà rédigé » → `other` + rôle `existing_work` dans `meta_json` (la colonne est contrainte par le schéma). **Seuls les documents de référence sont citables** : un document importé existe par définition (`verified`, §12.1.4), mais guide d'établissement et travail déjà rédigé reçoivent le type `document_interne` et le statut `unverified` — les jalons J4+ ne doivent proposer à la citation que `type != 'document_interne'`.
- Glisser-déposer : le renderer sandboxé n'a pas les chemins ; `webUtils.getPathForFile` est appelé dans le preload. Le bouton « Parcourir » utilise `dialog.showOpenDialog` côté main.
- Validation finale : brief complet (zod), fichiers traités, **confirmation bloquante** si approche empirique sans données de terrain (§7.3), un modèle pour chacun des 16 rôles, budget obligatoire → la mission passe `draft → briefing`. Les profils de normes intégrés sont insérés dans `norms_profiles` au démarrage (clé étrangère de `missions.norms_profile_id`) ; bug trouvé par l'E2E.
- **Estimation de coût et de durée** (§6.4 étape 7) : reportée à J5 avec le plan (§22) ; l'écran l'indique clairement. Le bouton s'appelle « Créer la mission » en attendant « Générer le plan ».
- Étape 6 : préréglages dans `resources/presets.json` (identifiants **vérifiés dans la liste réelle d'OpenRouter le 3 octobre 2026**, jurés d'une autre famille que le rédacteur §10.2, absence signalée si un modèle disparaît §14.3) ; mode « Personnalisé » = un identifiant par rôle avec suggestions issues de `GET /models`. Réglages avancés (§7.6) avec explication de leur effet.
- Étape 4 : 6 profils de normes dans `resources/norms-profiles.json` (valeurs = usages courants, à ajuster selon l'établissement, §15.2). Les fichiers CSL et la mise en forme finale restent en J8.
- Robustesse : fichiers de configuration absents → listes vides (le moteur démarre) ; corrompus → erreur explicite. Dossier `resources/` résolu parmi plusieurs candidats (variable, installateur, dépôt). Un défaut de ce type empêchait l'ouverture de la fenêtre ; corrigé.
- Version du moteur : 0.3.0. Schéma : migration 0002 (`chunks_vec`, unicité `(mission_id, sha256)`).

## ADR-021 — Connecteurs de sources (J4, §11.2)

- Dix connecteurs : OpenAlex, Crossref, HAL, Semantic Scholar, Unpaywall, DOAJ, arXiv, Europe PMC, CORE (clé obligatoire), Open Library (ISBN). Un module par service (`packages/engine/src/sources/`), interface commune `SourceConnector` (`search`, `lookupDoi`, `test`) ; aucune URL, clé ni identifiant en dur dans l'interface : adresses de base dans le module du connecteur, clés lues depuis la configuration.
- Activation par défaut : OpenAlex, Crossref, HAL, Semantic Scholar, Unpaywall, DOAJ ; arXiv et Europe PMC selon la discipline (`extraConnectorsForDiscipline`) ; CORE seulement avec clé.
- **État de la vérification des API (important)** : les formes de requête et de réponse ont été écrites d'après les documentations officielles, mais **le réseau de l'environnement cloud bloque ces domaines** (HTTP 403 du proxy, constaté par « Tester les connexions »). Les tests s'appuient donc sur des **réponses simulées dérivées de la documentation, non enregistrées sur le vrai service**. Aucun connecteur n'est validé en réel. Pour le faire : autoriser les domaines dans les paramètres réseau de l'environnement, ou sur votre machine lancer `EMILIO_CONTACT_EMAIL=vous@exemple.fr pnpm sources:check` (tests `test-live/`, exclus de la CI ; les réponses sont enregistrées dans `test-live/recorded/`, ignoré par git).
- Clés facultatives (Semantic Scholar, CORE) : chiffrées par `safeStorage`, jamais envoyées au renderer (masquées), jamais journalisées ; refus de stockage si le chiffrement n'est pas disponible (même règle que la clé OpenRouter).
- Adresse de contact : ajoutée au `User-Agent` (`mailto:`), utilisée par OpenAlex/Crossref (« polite pool ») et exigée par Unpaywall ; vide → connecteur Unpaywall désactivé, pas d'invention d'adresse.
- Messages d'erreur : codes dédiés `E_SOURCE_AUTH` / `E_SOURCE_REMOTE` (un refus d'un service bibliographique n'est plus présenté comme « clé OpenRouter invalide » — défaut trouvé sur la capture des réglages).

## ADR-022 — Client HTTP des sources (J4)

- `SourceHttp` : limitation de débit par connecteur (requêtes/seconde configurables), réessais sur 429/408/5xx avec `Retry-After` respecté et temporisation exponentielle bornée, 401/403 sans réessai, panne réseau → `E_NETWORK` après les réessais, 404 → `null` quand autorisé. Cache en base (`source_cache`, migration 0003) avec durée de vie par défaut de 7 jours (`cacheTtlMs`), pour ne pas solliciter deux fois les mêmes services.
- Tous les paramètres (débits, délais, durées de cache) sont dans `DEFAULT_HTTP_CONFIG`, surchargeables ; `fetch` et l'horloge sont injectés pour les tests.

## ADR-023 — Déduplication et score de qualité (J4, §11.3–11.4)

- Déduplication : DOI normalisé d'abord, puis titre normalisé + année (± 0). Fusion des champs manquants et conservation de toutes les origines.
- Score de qualité §11.4 : somme pondérée de critères mesurables (type de document, identifiant, récence, citations, texte intégral, revue ; bonus Afrique et import utilisateur ; pertinence 0,6 / qualité 0,4 pour le classement) ; **poids et seuils dans `resources/quality-weights.json`**, pas dans le code. Le score oriente le classement, il ne décide jamais seul de l'intégrité.
- Export CSL-JSON (`sources/csl.ts`) pour J8 ; matrice section ↔ sources (migration 0003, `section_sources`).

## ADR-024 — Vérification d'existence (J4, §12.1)

- DOI : Crossref puis OpenAlex ; titre (similarité ≥ 0,85), année ± 1, premier auteur. Livre : ISBN via Open Library. URL : contrôle d'accès. Cas ambigus : arbitrage LLM (`source_verifier/arbitration`), sortie validée par zod.
- Statuts : `verified`, `partially_verified`, `unverified`, `rejected`. **Une panne réseau ne rejette jamais une source** : elle reste `unverified` (test dédié). Seules les sources vérifiées ou partiellement vérifiées sont citables. Les preuves (méthode, date, valeurs annoncées/trouvées) sont stockées dans `evidence_json` et affichées.

## ADR-025 — Recherche documentaire par section (J4, §9 P3)

- `ResearchService.researchSection` : requêtes (Chercheur, FR/EN) → connecteurs en parallèle → dédoublonnage → classement (Chercheur) → vérification → score → sélection ; **boucle de couverture jusqu'à 3 itérations élargies** si trop peu de sources vérifiées. Ce que les services renvoient n'est jamais cité sans vérification.
- Texte intégral : accès ouvert via Unpaywall/OpenAlex/HAL/arXiv/CORE ; PDF téléchargé → ingéré dans la base de connaissances (J3) ; sinon statut « résumé seul » ou « indisponible » (jamais d'invention).
- **Fiches de lecture** (`document_analyst/reading-note`) : le modèle résume les extraits ; **le code** vérifie que chaque citation existe littéralement (`quoteExists`, normalisation tolérante des espaces, apostrophes, guillemets, tirets, césures) dans un extrait fourni et ≤ 40 mots ; sinon elle est supprimée et comptée (affichée à l'utilisateur).
- Mode simulé par mission (corpus fictif de DOI `10.5555/*`, PDF générés, source fantôme rejetée) : aucune requête réseau ni LLM payant en test ; bouton « Recherche de démonstration » (mode développeur).
- Version du moteur : 0.4.0. Prompts documentés dans `docs/PROMPTS.md` (version `recherche-1`).
