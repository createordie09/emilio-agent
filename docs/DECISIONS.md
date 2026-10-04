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

## ADR-026 — Cadrage P1 (J5, §9 P1, §10.3.1)

- L'Orchestrateur (mode cadrage) reçoit le brief condensé (`compactBrief`, sans données personnelles de l'auteur), le profil des données de terrain (calculé par du code) et rend : incohérences (avec correction proposée), 3 formulations de problématique **si elle est à proposer ou faible**, concepts à définir, pistes théoriques (jamais d'auteur cité), plan de requêtes FR/EN par concept, `manques`. Schéma zod = celui du §10.3.1. Prompt : `agents/orchestrator/cadrage.prompt.md` (version `plan-1`).
- Le résultat est stocké dans `missions.cadrage_json` (migration 0004) dès qu'il est obtenu : une planification interrompue, en échec ou régénérée ne refait **pas** P1.
- Les incohérences sont affichées sur l'écran de validation ; elles ne bloquent rien (l'utilisateur reste maître de son brief).

## ADR-027 — Recherche exploratoire (J5, §9 P2.1–2.2)

- `ResearchService.explore` : requêtes tirées du cadrage (une par concept à tour de rôle, FR puis EN, 8 au plus — `plan-config.json`), connecteurs en parallèle (panne isolée), déduplication, score (pertinence par embeddings + qualité §11.4), **30 / 45 / 60 candidats** selon la profondeur (rapide / normale / approfondie), métadonnées et résumés seulement (pas de texte intégral ni de fiche de lecture).
- **Vérification rapide** : existence des DOI (Crossref puis OpenAlex), sans arbitrage par un modèle ; une source sans identifiant reste « non vérifiée » (pas rejetée). Les sources **rejetées sont écartées** de la liste transmise à l'Architecte. Comme pour J4, une panne réseau ne rejette jamais une source.
- Les sources sont écrites dans `sources` (réutilisées ensuite par P3) ; la liste exploratoire de la mission est dans `plan_meta_json`.
- **Aucune source inventée** : l'Architecte ne voit que des alias `S1…Sn`. Tout alias inconnu est ignoré par le code (compté dans les remarques) ; les « sources pressenties » stockées sont toujours des identifiants de la base.
- Réseau absent (cas du cloud) : le plan est quand même proposé, avec l'avertissement « Aucune source candidate… ».

## ADR-028 — Plan proposé par l'Architecte (J5, §9 P2, §10.3.2, §15.3)

- **Sortie plate** (`noeuds[]` avec `ref` / `parent`) et non un arbre récursif : les schémas récursifs sont mal acceptés par les sorties structurées de plusieurs modèles. Le code reconstruit l'arbre. **Non vérifié en réel** (pas de clé dans le cloud) : si un modèle refuse ce schéma, la première génération réelle le dira (erreur claire, « Réessayer »).
- **Gabarits** : `resources/norms/structures/*.json` (mémoire de recherche, rapport de stage, rapport professionnel, thèse, article IMRaD, revue de littérature) — clé stable par nœud, niveau, type (introduction / conclusion / corps), poids de mots (`share`). Structure « standard » → **imposée** : le code restaure tout nœud du gabarit manquant, écarte les parties/chapitres ajoutés (sauf gabarit « thèse », ouvert) et le dit dans les points d'attention. Structure « personnalisée » ou « importée » → gabarit seulement indicatif (l'extraction des règles d'un guide d'établissement, `extract_guidelines`, n'est pas encore faite).
- **Mots** : cible = milieu de la longueur demandée × `wordsPerPage` (350) × `bodyShare` (0,85 : le reste = liminaires, bibliographie, annexes). Répartition **par du code** : poids du gabarit, sinon mots proposés par le modèle, normalisés pour que la somme soit exacte (arrondi à 10). Les propositions de mots du modèle ne sont jamais prises telles quelles. Valeurs **à ajuster** après les premiers tests réels (`plan-config.json`).
- Section < 400 mots signalée (hors sous-sections d'introduction/conclusion, rédigées d'un bloc) ; sections sans objectif, plan hors longueur (±10 %), budget dépassé, version > 5 : tous signalés à l'écran, jamais bloquants.
- **Numérotation** : parties en chiffres romains, chapitres en continu, sections « 2.3 », sous-sections « 2.3.1 » ; introduction et conclusion générales non numérotées ; sections sous une partie sans chapitre (rapport de stage) « 1.1 ».
- **Versions** : chaque proposition est conservée dans `plan_versions`. « Nouvelle version » : le commentaire, le plan **actuel avec les modifications de l'utilisateur** et la problématique retenue sont transmis à l'Architecte ; P1 et la recherche exploratoire sont réutilisés. Au-delà de 5 versions : conseil (pas de limite stricte, §9 P2).

## ADR-029 — Édition et validation du plan (J5, §6.5)

- Le plan de travail vit dans `outline_nodes` ; édition possible **seulement** en `awaiting_plan_validation` : renommer, objectif, questions clés, mots (feuilles seulement : un parent affiche la somme), nombre minimal de sources, ajouter / supprimer / déplacer. Le moteur recalcule numérotation et niveaux (un chapitre glissé dans un chapitre devient section, etc.), refuse les cycles, la profondeur > sous-section et la subdivision de l'introduction/conclusion.
- Interface : glisser-déposer natif HTML5 (haut / bas d'une carte = avant / après, centre = à l'intérieur) **et** boutons Monter / Descendre / Ajouter / Supprimer (accessibles au clavier). Les gestionnaires lisent une référence synchrone : `dragover` précède le rendu React (bug trouvé par le test E2E).
- **Validation** : si la problématique était « à proposer », le choix (ou un texte libre) est obligatoire ; il est alors écrit dans le brief. Le plan est figé dans `plan_json`, puis `running`.
- **Décision à confirmer** : les phases P4–P9 n'existent pas encore. La validation met donc en file la **recherche approfondie P3** (une tâche par section feuille du corps, via `ResearchService`, avec le minimum de sources de la section), puis la mission se termine avec le message « Étapes disponibles terminées (jusqu'à P3)… ». Config `stopAfterPhase` (jamais utilisée par les missions de démonstration).

## ADR-030 — Estimation du coût et de la durée (J5, §14.5)

- `llm/estimate.ts`, coefficients dans `resources/estimation.json` (**à calibrer** : valeurs de départ raisonnées, non mesurées) : recherche (appels par profondeur), fiches de lecture, analyse de données (seulement si données fournies), rédaction (mots × 1,3 jetons/mot, contexte en plus), ancrage (1 affirmation / 30 mots), résumés, jury (3 jurés + président × rondes × chapitres), révisions (part des sections), évaluation globale, bibliographie, soutenance (si PPTX).
- Trois scénarios : **bas** (1 ronde), **moyen** (2), **haut** (maximum permis partout) ; détail par phase. Prix **uniquement** ceux d'OpenRouter (`GET /models`, jamais d'ici) ; modèle sans prix → estimation signalée comme « minimum ». En **mode simulé** seulement, `simulatedPrice` (configuration, exemple) permet d'afficher des montants ; l'écran le dit.
- Durée : jetons de sortie ÷ vitesse (mesurée sur `llm_calls` après 5 appels réels par modèle, sinon 45 jetons/s par défaut) + surcoût par appel, divisée par le parallélisme effectif pour P3, P5, P6.
- `projectRemaining` (coût restant projeté après chaque phase, §14.5.6) est écrit et testé mais **pas encore affiché** : il sert au tableau de bord (J6+).

## ADR-031 — États et robustesse de la planification (J5, §8.6)

- `planning` s'exécute en arrière-plan (un seul travail par mission), journal en français. Tout échec (crédit, budget, réseau, clé, réponse inexploitable `E_SCHEMA`) → `failed` avec raison claire, **aucun plan à moitié écrit** (transaction) ; « Réessayer » relance la planification (transition `failed → planning` ajoutée, la table du §8.1 est inchangée pour le reste). Pas de pause automatique : la planification est courte, une reprise manuelle suffit.
- Annulation : le travail est interrompu et le statut reste « annulée ». Redémarrage de l'application : une mission restée en `planning` est relancée (les étapes déjà faites — cadrage, exploration — sont réutilisées).
- Mode développeur : « Mode simulé » (bascule `llmMode`) disponible au stade « brief » pour tester sans appel payant ; refusé hors mode développeur.
- Reporté : notification système « plan prêt » (§6.9) au jalon J9 avec les autres notifications.
- Version du moteur : 0.5.0. Schéma : migration 0004 (`cadrage_json`, `plan_meta_json`, colonnes de `outline_nodes`, `plan_versions`).

## ADR-032 — Analyse des données de terrain P4 (J6, §9 P4, §10.3.6, §17)

- **Module statistique maison** (`packages/engine/src/stats/`) plutôt que `simple-statistics` / `jstat` : cinq analyses suffisent (effectifs et pourcentages, descriptif, tableau croisé + khi-deux avec V de Cramér, corrélation de Pearson avec test t, moyennes par groupe). Les p-valeurs viennent des fonctions gamma / bêta incomplètes, **vérifiées contre les valeurs critiques des tables** (khi-deux 3,841 ddl 1 = 0,05 ; t 2,048 ddl 28 = 0,05…) et des exemples connus (2×2 : χ² = 0,7937, p = 0,373 ; Pearson n = 5 : r = 0,7746, p = 0,124). Aucune dépendance de plus.
- **Le modèle choisit, le code valide et calcule** : `plan_analyses` renvoie des analyses (type, variables, hypothèse) ; le code écarte toute variable inconnue ou de type incompatible (et le dit), ajoute des analyses de base (effectifs des variables catégorielles, descriptif des numériques) et exécute. Un test du khi-deux peu fiable (> 20 % de cases à effectif théorique < 5, ou n < 30) est signalé.
- **Tableaux** numérotés « Tableau N : … » avec « Source : enquête de terrain, <période du brief ou mois année> » ; phrases de faits à chiffres exacts calculées par le code (c'est tout ce que voit le modèle). Les **figures** sont stockées comme spécifications Vega-Lite (numérotées) mais **rendues en J8** (export).
- **Interprétation contrôlée** (§12.3) : toute phrase contenant un nombre absent des résultats calculés est **écartée** (le nombre de phrases écartées est affiché) ; une hypothèse « confirmée » dont tous les tests cités sont non significatifs (p ≥ 0,05) est **ramenée à « nuancée »** avec une note ; sans analyse citée → « nuancée ». Une entrée par hypothèse du brief, dans l'ordre.
- Un seul fichier de données est analysé (le plus grand) ; les autres sont signalés. Résultats stockés dans `field_analysis` (migration 0005).
- **Reporté, à décider avec vous** : le **codage thématique** des entretiens (`qualitative_coding`). Aucun chemin d'import ne l'alimente aujourd'hui (« Données de terrain » = CSV/XLSX uniquement). Proposition : importer les transcriptions comme un type de document dédié, avec l'anonymisation E1, E2… (§19) ; à planifier.

## ADR-033 — Rédaction P5 et contrôles d'intégrité (J6, §9 P5, §8.4, §12)

- **Alias** : le rédacteur ne voit que des alias de sources (`A1…`) et d'extraits (`E1…`) ; le code valide chaque marqueur `[@A1, p. 12]` et le **convertit en identifiant réel** à l'enregistrement (utilisé par P8 pour les citations, J8). Une source n'est proposée que si elle est vérifiée ou partiellement vérifiée et n'est pas un document interne ; une source sans extrait n'est pas citable.
- **Contexte (§8.4)** : contexte de mission compact (≤ 5 200 caractères ≈ 1 500 jetons), résumés des sections précédentes (même chapitre en entier, autres chapitres abrégés), fiches de lecture, extraits les plus pertinents (recherche hybride), résultats de P4 pour les sections de résultats. Budget d'extraits = min(12 000 jetons, 70 % de la fenêtre du modèle − 6 000 jetons d'amorce), réduit en retirant d'abord les extraits en trop des dernières sources.
- **Chaque phrase portant un marqueur valide est une affirmation** : le code ne se fie pas à la seule liste `claims` du modèle. L'extrait support est celui que le modèle déclare **s'il appartient à la source citée** (§12.2.2), sinon le meilleur extrait de cette source. Le Vérificateur d'ancrage juge par lots de 15 ; **un verdict absent = non étayé** (jamais « soutenu » par défaut).
- **Contrôles par le code** : source inconnue ou marqueur mal formé ; citation directe ≤ 40 mots **retrouvée littéralement** dans un extrait de la source citée (tolérance typographique) ; **chiffres** (§12.3) : un nombre doit figurer dans l'extrait cité dans la même phrase, ou dans les résultats P4 / le brief / le plan — sont tolérés les entiers ≤ 10 et l'année de publication de la source citée, et sont ignorés les renvois (Tableau 3, section 2.3.1, p. 12, H2) ; **similarité** : 8 mots consécutifs identiques à un extrait hors guillemets ; **longueur** ±10 %.
- **Boucle** : au plus 2 rondes de correction ciblée (le rédacteur ne reçoit que les phrases fautives et la raison) ; puis **suppression par le code** des phrases qui restent fautives (source, citation, chiffre, recopie, non étayé) — **la raison de chaque suppression est conservée et affichée**. Les « partiellement étayées » restent, signalées, et déclenchent une correction seulement si le taux d'ancrage est < 0,95. Le taux d'ancrage **initial** (avant correction) et **final** sont tous deux enregistrés et affichés, pour ne pas masquer le travail de correction.
- **Limite connue** : une affirmation factuelle écrite **sans marqueur** n'est pas détectée comme telle (seuls les chiffres et la similarité la contrôlent). Le prompt exige un marqueur ; le jury (J7) ciblera aussi ce point.
- **Sections de résultats** : reçoivent les faits calculés et un jeton `{{TABLEAU:A1}}` (le tableau est inséré par l'affichage/l'export, jamais recopié par le modèle ; jeton inconnu = ignoré et signalé). **Approche empirique sans données** : la section est remplacée, **sans appel au modèle**, par une trame d'analyse et des emplacements `[DONNÉES À INSÉRER : …]` (§7.3).
- **Introduction et conclusion générales** : rédigées en dernier, à partir des résumés et du statut calculé des hypothèses ; **aucune citation** (les références sont dans les chapitres), nombres limités à ceux des résumés / du brief / des résultats. **Pages liminaires** : résumé (et abstract anglais si demandé, avec le même contrôle des nombres) ; dédicace, remerciements et avertissement = modèles `[À COMPLÉTER : …]` jamais inventés (§7.2). Sigles et listes de tableaux/figures : J8.
- **Écriture atomique** : rien n'est écrit avant la fin d'une section (transaction : version, affirmations, statut) ; relancer une section déjà écrite ne fait rien (idempotence §8.3).
- **Parallélisme (§8.5)** : une section dépend de sa recherche, de l'analyse si elle présente des résultats, et de la section précédente du même chapitre (pour en recevoir le résumé) ; les chapitres avancent en parallèle, dans la limite du parallélisme de la mission. Introduction/conclusion dépendent de tout le corps, les liminaires des deux.
- **Fin de mission** : `stopAfterPhase = P5` ; la mission se termine avec « Étapes disponibles terminées (jusqu'à P5) » ; jury et révisions arrivent en J7. Typographie française (espaces insécables, guillemets) : appliquée à l'export (J8).
- Version du moteur : 0.6.0. Schéma : migration 0005 (`field_analysis`, `drafts.summary` / `checks_json`, `front_matter`). Réglages : `resources/writing-config.json`.

## ADR-034 — Course entre recherches de sections (J6)

- Deux sections qui retenaient la même source la téléchargeaient et l'indexaient **en même temps** (`UNIQUE constraint failed: chunks`), erreur intermittente rattrapée par le réessai de la tâche, révélée par le parallélisme réel (J5 → J6). Correction à la racine : l'acquisition du texte d'une source est **séquentielle par source** et ne refait rien si le texte est déjà indexé (`ResearchService.once`).

## ADR-035 — Jury simulé et boucle de révision P6 (J7, §13.1–13.4)

- **Grille C1–C9** dans `resources/jury-config.json` (critères, points, juré responsable, seuils par exigence, marge de verdict, gain minimal, écart maximal, plafonds). Trois jurés par chapitre (méthodologue, rapporteur de fond, relecteur de forme), chacun ne note **que ses critères** ; `null` = non applicable. **Le code recalcule** totaux et moyennes (critères notés × 20/total), jamais le modèle.
- **Verdict** : ≥ seuil = validé ; ≥ seuil − 3 = à réviser ; sinon à réécrire (arrondi à 2 décimales). Seuil du brief appliqué s'il est fourni. Un juré inexploitable (zod) est écarté avec avertissement ; tous inexploitables = échec explicite.
- **Écart > 4 points** entre jurés : justification croisée du président avant de trancher.
- **Boucle par chapitre** : évaluation → plan du président (remarques majeures puis mineures) → recherche complémentaire éventuelle (clé de section distincte `<nœud>:suppl:<ronde>`, fusionnée aux sources/fiches de la section) → révision des sections → réévaluation. Arrêt : seuil atteint, **plateau** (gain < 0,5), rondes maximales. **Dégradation** : retour aux versions précédentes (issue « annulée »), chapitre « accepté avec réserves » avec raisons.
- **Reprise** : l'état est lu en base (évaluations du président, `revision_log`, `review_outcomes`) ; une boucle interrompue ne refait pas l'évaluation déjà payée. Migration 0006.
- **Versions** : toutes conservées (`drafts.version` = max + 1, `current_version_id`) ; `used_in_text` n'est incrémenté qu'à la rédaction initiale. Les révisions repassent par **tous les contrôles de P5** (sources, citations littérales, nombres, similarité, ancrage).
- **Parallélisme** : trois jurés × chapitres dépassaient le parallélisme de la mission → **limiteur par mission dans `ModelCaller`**.

## ADR-036 — Harmonisation, évaluation globale et mise à jour finale P7 (J7, §13.5)

- **Harmonisation** : l'agent propose des modifications ciblées ; le code n'applique que celles dont la phrase d'origine existe **à l'identique** (sans marqueur), dont le remplacement fait ≤ 60 mots et ne contient ni marqueur, ni citation, ni nouveau nombre. Chaque modification appliquée devient une **nouvelle version** ; les autres sont écartées avec leur raison.
- **Évaluation globale** : sur un échantillon (3 sections les moins bien notées + 2 choisies par hachage déterministe) et les résumés ; seuil selon l'exigence (14/15/16). `rondesMaxGlobales = 0` désactive l'évaluation (l'harmonisation reste).
- **Mise à jour finale** : introduction, conclusion et résumé sont régénérés si le corps a changé.
- **Fin de mission** : `stopAfterPhase = P7`. Version du moteur 0.7.0, schéma 6.
- **Onglets Jury et Brouillons** (§6.7) : grille par juré, remarques avec gravité, plan du président, révisions avant/après (conservée / annulée), évolution des notes ; versions de chaque section avec **comparaison phrase par phrase** (plus longue sous-suite commune, côté interface).
- **Limites connues** : jamais testé avec un vrai modèle (pas de clé dans le cloud) ; nombre de jurés fixé à 3 ; remplacement de la grille par celle de l'établissement non implémenté ; une affirmation factuelle sans marqueur n'est toujours pas détectée.

## ADR-037 — Mise en forme et bibliographie P8 (J8, §9 P8, §15, §16)

- **Citations par un vrai moteur CSL** : `citeproc` (citeproc-js, maintenu, sans dépendance DOM) avec les fichiers de style du dépôt officiel `citation-style-language/styles` (CC BY-SA 3.0, dans `resources/csl/`) et les paramètres régionaux `fr-FR`. Styles : ISO 690 auteur-date (défaut « Afrique francophone »), APA 7, ISO 690 numérique, NLM (Vancouver), Chicago notes (français, avec « ibid. » natif). Le profil → style est dans `resources/export-profiles.json` ; le choix « notes / auteur-date » du brief l'emporte sur le mode du profil (les styles numériques restent numériques). **Choix à valider** : la norme « Afrique francophone » n'est pas une norme officielle (§15.2) ; elle utilise ISO 690 auteur-date.
- **Ordre du document** : les citations sont traitées dans l'ordre du texte ; les marqueurs voisins (`[@a][@b]`) forment une seule citation « (A, 2020 ; B, 2021) ». Le texte final d'une citation n'est lu qu'après toutes les autres (désambiguïsation des années, renvois courts). Un marqueur dont la source n'est pas citable est **retiré** du texte et signalé (contrôle final en échec).
- **Bibliographie** : uniquement les sources citées, triées par le style, regroupées par type si le profil l'exige (ouvrages, articles, mémoires et thèses, rapports, textes officiels, webographie).
- **Typographie française** appliquée par le code à tout le texte : espaces insécables (fines avant ; ! ? %), guillemets « », apostrophes ’. Siècles en petites capitales : aucun profil ne le demande, non fait.
- **Sigles** : extraits automatiquement ; un sigle n'est défini que si le texte le définit lui-même (« Programme alimentaire mondial (PAM) ») ; un sigle utilisé au moins deux fois sans définition est listé avec `[À COMPLÉTER : définition]` — jamais inventé.
- **Tableaux et figures** : numérotés **dans l'ordre du document** ; les renvois « Tableau N » du texte sont renumérotés en conséquence ; un tableau n'est inséré qu'une fois ; ceux que le texte n'a pas insérés vont en **annexe** « Tableaux complémentaires ». Les figures (histogrammes des spécifications Vega-Lite de P4) sont dessinées en SVG par le code puis rastérisées avec `@resvg/resvg-js` et la police Inter embarquée (OFL) : même rendu sur toutes les machines, sans Vega.
- **Reporté** : annexe « questionnaire / guide d'entretien » (aucun type de document ne les identifie à l'import) ; reprise des styles d'un gabarit Word fourni par l'utilisateur ; profil « Personnalisé » modifiable (§15.2.7).

## ADR-038 — Livrables P9 (J8, §16)

- **Word** (`docx`) : styles nommés (Titre 1–4, Légende, Citation), sommaire en **champ TOC** mis à jour à l'ouverture (Word propose la mise à jour — [À VÉRIFIER] confirmé : le champ est vide tant que l'utilisateur n'accepte pas), notes de bas de page natives en mode notes, sections distinctes (page de garde sans numéro, liminaires en chiffres romains, corps en chiffres arabes), sauts de page avant parties et chapitres, emplacements à compléter surlignés en jaune. Vérifié à la main par conversion LibreOffice (85 pages sur la mission simulée).
- **PDF** : HTML paginé (CSS d'impression A4) rendu par `printToPDF` d'Electron (`generateDocumentOutline` = signets : [À VÉRIFIER] confirmé dans les types d'Electron 44). Le moteur ne touche pas à Chromium : il **demande le rendu au processus principal** (message `host` / `hostReply`). **Sommaire calculé en deux passes** : première impression avec des jetons invisibles sur chaque titre, lecture du PDF (pdf.js) pour trouver la page de chaque titre, seconde impression avec les numéros. Limites : pagination continue depuis la page de garde (la numérotation romaine / arabe distincte est propre au Word) ; en mode notes, les notes sont regroupées en fin de chapitre (pas de notes de bas de page natives en CSS). Sans rendu disponible (tests, sans interface), le PDF est **signalé « non produit »** avec la raison, jamais en silence, et la mission se termine.
- **Diaporama** (`pptxgenjs`) : 15 diapositives par défaut (réglable), couleur d'accent configurable (`resources/export-config.json`), notes de l'orateur sur chacune. Le code impose la structure, le titre, le plan et les **vrais tableaux et figures** des diapositives de résultats ; le modèle écrit puces (≤ 5, ≤ 12 mots, tronquées par le code sinon) et notes. **Toute phrase contenant un nombre introuvable dans le travail est écartée** (§12.3). Remerciements : `[À COMPLÉTER]`.
- **Fiche de préparation** (Word) : 20 à 30 questions (remarques du jury simulé, faiblesses connues), éléments de réponse, **renvoi à la section** (pas à la page : la pagination du Word n'est connue qu'à son ouverture) ; renvoi inconnu effacé, chiffres contrôlés comme ci-dessus.
- **Rapport de mission** : page HTML autonome (paramètres, durée, coût par phase, sources trouvées / vérifiées / rejetées / citées avec raisons, notes du jury par ronde, points d'attention, méthodologie de recherche documentaire, livrables, charte d'utilisation et modèle de déclaration d'usage de l'IA §17.6). Pour cela : migration 0007 (`search_log` : requêtes et bases interrogées ; `deliverables` ; `export_state`) et rattachement des appels de modèle des tâches locales à leur tâche (`AsyncLocalStorage`) pour le coût par phase.
- **Ordre des tâches** : P8 → (Word, PDF, diaporama, fiche selon le brief, en parallèle) → contrôle final → rapport (qui reprend le contrôle final). Seuls les livrables demandés sont produits.

## ADR-039 — Contrôle final (J8, §16.5)

- Contrôles : aucun marqueur non résolu ; sources citées = bibliographie ; taux d'ancrage global ≥ 90 % ; longueur totale à ± 15 % de la cible ; numérotation continue des tableaux et figures ; renvois vers un élément absent ; sections non rédigées ; **liste exhaustive des `[À COMPLÉTER]` / `[DONNÉES À INSÉRER]`** ; relecture du Word (archive valide, texte extractible).
- Un contrôle en **échec** (marqueur, bibliographie, numérotation, Word illisible) n'empêche pas la fin de mission : il est affiché en rouge dans l'onglet Livrables, journalisé et repris dans le rapport. Décision : bloquer ne servirait à rien (relancer donne le même résultat) ; l'utilisateur doit savoir. Les avertissements (ancrage, longueur, emplacements) restent à lire.
- Mission terminée = toutes les phases P0 → P9 (`stopAfterPhase` n'est plus posé par la validation du plan). Version du moteur 0.8.0, schéma 7.
- **Limites** : jamais testé avec un vrai modèle ; mise en page Word vérifiée avec LibreOffice, pas avec Microsoft Word ; sommaire Word à mettre à jour à l'ouverture.

## ADR-040 — Interruptions, budget et erreurs (J9, §8.6, §20)

- **Audit §8.6 / §20** : pause, crédit épuisé (reprise automatique), réseau (backoff puis `paused_network`), reprise au démarrage, crash du moteur (3 redémarrages en 10 min), basculement de modèle, échec fatal avec « Réessayer » existaient depuis J2 et sont couverts par les tests. Ajouts J9 : codes manquants (`E_CONTEXT_OVERFLOW`, `E_SOURCES_INSUFFICIENT`, `E_EXPORT`, `E_ENGINE_CRASH`) et leurs messages.
- **Budget atteint** : deux actions (écran de la mission) — _relever le budget_ (nouveau plafond > dépensé, reprise immédiate) ou _finaliser avec l'état actuel_ : les tâches restantes de P3 à P7 sont abandonnées, P8–P9 s'exécutent sur ce qui existe ; les sections non rédigées deviennent `[À COMPLÉTER : section non rédigée]` et sont listées dans le contrôle final et les points d'attention ; le diaporama et la fiche (qui exigent le modèle) sont **signalés « non produits : budget atteint »**.
- **Prompt trop long** : une erreur 400 « context length » est reconnue (`E_CONTEXT_OVERFLOW`) ; un seul nouvel essai silencieux avec le plus long message raccourci (début et fin conservés, milieu retiré). Générique plutôt que propre à chaque agent : l'écrivain réduit déjà ses extraits en amont (§8.4).
- **Modèles de secours** : pour chaque rôle, les modèles des **autres préréglages** (jamais d'identifiant inventé) ; bascule signalée dans le journal (déjà en place, mais la configuration n'était jamais alimentée).
- **Redémarrage après plantage** : le processus principal passe `EMILIO_ENGINE_RESTARTED=1` au moteur relancé, qui écrit « Le moteur a redémarré, la mission reprend. » dans les missions reprises.
- **Reprise automatique** : préférence unique (au démarrage, crédit rechargé, réseau revenu) ; désactivée, les missions interrompues restent en pause avec un bouton Reprendre.
- **E_EXPORT** : toute panne de génération d'un livrable devient une erreur claire (« Mémoire (Word) : … ») ; les erreurs déjà typées (crédit, réseau, budget) passent telles quelles.

## ADR-041 — Notifications, anti-veille, mises à jour, packaging (J9, §6.9, §19)

- **Notifications système** (`Notification` d'Electron) : plan prêt, mission terminée, pauses (crédit, réseau, budget), erreur fatale ; un clic ouvre la mission. Logique pure et testée (`notifier.ts`) : pas de notification au premier événement d'une mission déjà connue, ni de répétition. Désactivables.
- **Garde anti-veille** : `powerSaveBlocker('prevent-app-suspension')` tant qu'au moins une mission est `running` (`power.ts`, testé) ; désactivable.
- **Mises à jour** : `electron-updater` sur les releases GitHub, **version installée uniquement** ; vérification discrète 15 s après le démarrage (désactivable), bouton « Rechercher une mise à jour » et « Redémarrer et installer » dans À propos. Aucune autre donnée n'est envoyée. **Signature** : vérifiée par `electron-updater` quand l'installateur est signé ; sans certificat (`CSC_LINK`), l'installateur n'est pas signé et Windows SmartScreen avertira — **à décider avec vous** (achat d'un certificat).
- **Installateur** : `electron-builder` (NSIS, x64, installation par utilisateur, choix du dossier, raccourcis, français), configuration dans `apps/desktop/electron-builder.yml` ; ressources (`resources/`) en `extraResources`, modules natifs et moteur d'embeddings hors de l'archive asar. Les dépendances du renderer et les paquets du dépôt passent en `devDependencies` (ils sont déjà dans les bundles) : l'installateur ne contient que ce que le moteur charge à l'exécution. Workflow `.github/workflows/release.yml` (étiquette `v*`, Windows) : modèle d'embeddings, reconstruction des modules natifs pour Electron, build, publication. **Vérifié ici** : l'empaquetage Linux (`--dir`) produit l'archive et les ressources attendues ; **non vérifié** : le build Windows réel et l'installateur (pas de Windows dans le cloud, ni les en-têtes Electron pour recompiler `better-sqlite3`).
- Icône provisoire générée depuis `build/icon.svg` (identité définitive : §23.8).

## ADR-042 — Export / import de mission, journaux, coûts (J9, §6.7, §18)

- **Archive de mission** (`.emilio`, zip, `fflate`) : une ligne JSON par enregistrement de toutes les tables de la mission (plan, sources, extraits, versions, jury, tâches, événements, appels de modèle, livrables…), plus les fichiers importés et les livrables ; **jamais** la clé, les préférences ni le cache des connecteurs. Import : refus d'une archive illisible, d'une version plus récente, ou d'une mission déjà présente ; chemins de fichiers réécrits ; index plein texte reconstruit par déclencheur et **vecteurs recalculés** avec l'embeddeur courant ; une mission non terminée devient « en pause ». Les identifiants sont conservés (pas de duplication : « dupliquer une mission annulée », §8.7, reste à faire).
- **Coûts** : migration 0008 (`llm_calls.agent_role`, `mission_id`) ; les appels des tâches locales sont rattachés à leur tâche par `AsyncLocalStorage` ; onglet Coûts par phase, agent et modèle, avec la projection du coût restant (estimation moyenne moins dépensé). Les appels hors tâche (cadrage, plan) sont regroupés.
- **Journal technique** : fichier rotatif (1 Mo × 3) dans le dossier de données (transitions, événements, une ligne par appel de modèle **sans contenu**) ; onglet Journal technique ; « Exporter les journaux » (zip : journaux + informations de version, **sans clé ni documents**). Le « journal détaillé » (prompts et réponses complets, §18) n'est **pas** fait : il stockerait du contenu utilisateur ; à décider.
- **Écran de fin de mission** (§6.8) : note finale du jury, pages estimées (≈ 350 mots), sources, durée, coût, points d'attention, livrables, charte.

## ADR-043 — Onboarding et confidentialité (J9, §17.5, §19)

- **Premier lancement** : 4 étapes (bienvenue, confidentialité, clé OpenRouter, charte) ; la charte doit être acceptée. Affichée aussi à la fin de mission (onglet Livrables).
- **Confidentialité OpenRouter** — [À VÉRIFIER] levé dans la documentation officielle (Provider Routing) : le champ `provider.data_collection` accepte `"allow"` (défaut) ou `"deny"`. Réglage **« Refuser les fournisseurs qui conservent mes données »**, **désactivé par défaut** (l'activer peut rendre certains modèles indisponibles), proposé à l'onboarding et dans les paramètres ; il est ajouté à chaque requête de génération sans écraser `require_parameters`.
- **Pas de télémétrie.** **Non fait** : l'anonymisation des données de terrain avant envoi (§19, option : remplacement des noms propres par E1, E2…), liée au codage qualitatif encore reporté.
- Version du moteur 0.9.0, schéma 8.

## ADR-044 — Calibration : banc d'essai et premiers constats (J10, §21.2, §21.4, §23.5)

- **Banc d'essai** `test-live/calibration.live.ts` : mission réelle courte, budget plafonné, métriques complètes écrites dans `docs/calibration/` (voir le README). Réglage développeur `sourcesMode: 'mock'` : vrai modèle, sources simulées (les API de sources sont injoignables depuis le cloud).
- **[À VÉRIFIER] §23.5 levé** : les six identifiants de modèles de `resources/presets.json` existent chez OpenRouter, avec sorties structurées. La sortie JSON stricte a été essayée sur les trois modèles du préréglage économique.
- **Plafond de jetons de sortie** : OpenRouter réserve le coût maximal d'une réponse quand `max_tokens` est absent ; un solde modeste est alors refusé (402) à tort. Désormais 16 000 jetons par appel (`maxOutputTokens`, réglable par mission), et une réponse vide coupée par la limite (`finish_reason: length`) est retentée une fois avec le double.
- **Modèles à raisonnement** : leurs jetons de réflexion sont facturés en sortie (150 à 290 jetons pour une réponse de 20 à 30 jetons). Aucun coefficient n'est modifié sans mesure : à calibrer sur mission réelle.
- **Non fait** : les trois missions réelles, l'ajustement de `estimation.json`, l'amélioration des prompts d'après leurs défauts, les préréglages. **Bloqué par le solde du compte OpenRouter** (épuisé).
