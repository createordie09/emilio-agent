# CAHIER DES CHARGES — « Iroko Mémoire » (nom provisoire)

**Application desktop d'agents IA autonomes pour la recherche et la rédaction de mémoires, thèses et rapports académiques**

Version : 1.1 — 3 octobre 2026 (ajout de la direction artistique, §6.1)
Porteur du projet : Marion De Souza (IROKO)
Destinataire principal : Claude Code (développement)

---

## 0. Comment utiliser ce document (à l'attention de Claude Code)

1. Lis ce document **en entier** avant d'écrire la moindre ligne de code.
2. Les sections sont numérotées. Cite les numéros de section dans tes commits, tes questions et tes plans (ex. « §9.4 »).
3. Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT**, **PEUT** ont le sens des RFC : DOIT = obligatoire, DEVRAIT = fortement recommandé, PEUT = optionnel.
4. Les blocs marqués **[À VÉRIFIER]** désignent des détails d'API externes (OpenRouter, OpenAlex, etc.) à confirmer dans leur documentation officielle avant implémentation. Ne les code pas « de mémoire ».
5. L'ordre de construction est donné en §22 (jalons). Respecte-le : chaque jalon DOIT être fonctionnel et testé avant de passer au suivant.
6. Toute décision technique non couverte ici : choisis l'option la plus simple et robuste, puis documente-la dans `docs/DECISIONS.md` (format ADR court).
7. Tout le texte visible par l'utilisateur est **en français**. Le code, les noms de variables et les commentaires techniques PEUVENT être en anglais.
8. **Direction artistique** : les références visuelles sont dans `docs/references/` (maquettes complètes dans `originaux/`, composants recadrés dans `extraits/`). Avant toute interface, ouvre et regarde ces images, puis lis la §6.1. Chaque composant de la §6.1.7 indique l'extrait dont il s'inspire. En cas de doute entre le texte et une image, le texte de la §6.1 prime (il contient les adaptations voulues : violet unique, barre latérale claire, pas de bouton « Pro »).

---

## 1. Présentation du projet

### 1.1 Vision

Iroko Mémoire est une application desktop gratuite, installable sur PC (Windows en priorité, puis macOS et Linux). Elle permet à un étudiant, un doctorant ou un apprenant en formation professionnelle de confier à une équipe d'agents IA la recherche documentaire, la structuration, la rédaction, l'auto-évaluation et la mise en forme d'un mémoire, d'une thèse ou d'un rapport.

L'utilisateur :
1. configure sa clé API OpenRouter et ses modèles ;
2. décrit son projet (thème, problématique, consignes, normes, données de terrain, documents) ;
3. valide le plan proposé par l'agent ;
4. laisse l'agent travailler en autonomie (jusqu'à une journée ou plus) ;
5. récupère des livrables aux normes (Word, PDF, diaporama de soutenance).

### 1.2 Cibles

| Cible | Exemples de livrables |
|---|---|
| Étudiants licence | Mémoire de licence, rapport de stage |
| Étudiants master | Mémoire de master recherche ou professionnel |
| Doctorants | Chapitres de thèse, revue de littérature, article |
| Apprenants en formation professionnelle | Rapport de fin de formation, projet professionnel, étude de cas |

Contexte prioritaire : **Afrique francophone** (normes et usages des universités et grandes écoles francophones africaines, espace CAMES), sans exclure les autres pays francophones.

### 1.3 Principes directeurs

1. **Autonomie après validation du plan** : une fois le plan validé, l'agent travaille sans intervention humaine jusqu'à la fin, sauf blocage réel (crédit épuisé, erreur fatale).
2. **Zéro source inventée** : toute référence citée DOIT exister et être vérifiée (§12).
3. **Zéro donnée de terrain inventée** : les données empiriques proviennent exclusivement de l'utilisateur (§17).
4. **BYOK (Bring Your Own Key)** : l'utilisateur fournit sa clé OpenRouter. L'application ne fournit aucun crédit et n'a aucun serveur payant.
5. **Local d'abord** : les données du projet restent sur la machine de l'utilisateur. Seuls sortent les appels aux modèles (OpenRouter) et aux sources documentaires.
6. **Reprise garantie** : une mission interrompue (crédit épuisé, PC éteint, plantage) DOIT pouvoir reprendre exactement là où elle s'est arrêtée.
7. **Transparence** : l'utilisateur voit en temps réel ce que fait chaque agent, ce que ça coûte et pourquoi.
8. **Paramétrable** : les seuils, rondes de révision, budgets et modèles sont réglables, avec des valeurs par défaut judicieuses.
9. **Français uniquement** pour l'interface et la rédaction (exception : l'abstract en anglais, optionnel, §15.4).

### 1.4 Périmètre V1

Inclus :
- Application desktop Electron (Windows prioritaire, packaging macOS/Linux prévu).
- Moteur d'orchestration multi-agents local avec persistance et reprise.
- Connecteurs de sources ouvertes (§11.2) + import de PDF utilisateur.
- Vérification des sources et ancrage des citations.
- Jury simulé et boucle de révision.
- Livrables DOCX, PDF, PPTX (diaporama), rapport de mission.
- Profils de normes (bibliographie + mise en page) dont des profils adaptés à l'Afrique francophone.

Hors périmètre V1 (prévu V2) :
- Mode cloud Cloudflare (mission qui continue PC éteint) — l'architecture DOIT le rendre possible (§4.6).
- Collaboration multi-utilisateurs.
- Autres langues que le français.
- Accès aux bases payantes (Cairn, JSTOR, ScienceDirect) autrement que par les PDF que l'utilisateur importe lui-même.

---

## 2. Glossaire

| Terme | Définition |
|---|---|
| **Mission** | Un projet de rédaction complet (un mémoire = une mission). |
| **Brief** | L'ensemble des informations fournies par l'utilisateur avant le lancement. |
| **Plan** | La structure détaillée du document (parties, chapitres, sections), avec objectifs et sources pressenties par section. |
| **Phase** | Grande étape de la mission (P0 à P9, §9). |
| **Tâche** | Unité de travail atomique confiée à un agent (ex. « rechercher des sources pour la section 2.3 »). |
| **Agent** | Un rôle IA avec un prompt système, un modèle et des outils (§10). |
| **Orchestrateur** | L'agent chef qui planifie, distribue et décide. |
| **Checkpoint** | Sauvegarde de l'état de la mission permettant la reprise. |
| **Base de connaissances (KB)** | L'ensemble des sources collectées, découpées en extraits (chunks) indexés. |
| **Extrait (chunk)** | Un passage de source (300 à 800 mots) avec ses métadonnées. |
| **Ancrage** | Le lien vérifié entre une affirmation du texte et l'extrait de source qui la soutient. |
| **Ronde de révision** | Un cycle évaluation par le jury → corrections → réévaluation. |
| **Profil de normes** | Un ensemble de règles de bibliographie et de mise en page. |

---

## 3. Exigences générales

### 3.1 Fonctionnelles (résumé)

- EF-01 : Configurer et tester une clé OpenRouter.
- EF-02 : Lister les modèles OpenRouter disponibles avec leurs prix, et en affecter un à chaque rôle d'agent.
- EF-03 : Créer une mission via un assistant en étapes (wizard).
- EF-04 : Importer des PDF, DOCX, TXT, CSV, XLSX (documents et données de terrain).
- EF-05 : Générer un plan détaillé et le soumettre à validation (édition possible).
- EF-06 : Exécuter la mission en autonomie avec suivi en direct.
- EF-07 : Mettre en pause, reprendre, annuler une mission.
- EF-08 : Reprendre automatiquement après crédit épuisé, perte de réseau ou redémarrage.
- EF-09 : Afficher l'estimation de coût avant lancement et le coût réel en direct.
- EF-10 : Produire les livrables choisis.
- EF-11 : Consulter les sources, les notes du jury et l'historique des versions.
- EF-12 : Exporter / importer une mission (fichier `.iroko`, archive zip).

### 3.2 Non fonctionnelles

- ENF-01 : L'interface DOIT rester fluide pendant l'exécution (le moteur tourne hors du processus de rendu).
- ENF-02 : Aucune perte de travail en cas de crash : checkpoint après chaque tâche terminée.
- ENF-03 : La clé API DOIT être chiffrée au repos (Electron `safeStorage`).
- ENF-04 : L'application DOIT fonctionner sans compte, sans inscription.
- ENF-05 : Taille d'installation raisonnable (cible < 400 Mo, modèle d'embeddings inclus).
- ENF-06 : Fonctionne sur un PC modeste (8 Go de RAM, 4 cœurs).
- ENF-07 : Tolérance aux connexions Internet instables (fréquent en contexte africain) : réessais, files d'attente, reprise.
- ENF-08 : Journaux détaillés exportables pour le débogage.

---

## 4. Architecture technique

### 4.1 Stack

| Couche | Choix | Justification |
|---|---|---|
| Shell desktop | **Electron** (dernière version stable) + **electron-builder** | Écosystème mûr, packaging Windows simple, cohérent avec les projets existants de Marion |
| UI | **React + TypeScript + Vite** | Standard, rapide |
| Style | **Tailwind CSS** + composants **shadcn/ui** | Interface propre type dashboard |
| État UI | **Zustand** + **TanStack Query** | Simple |
| Moteur | **Node.js + TypeScript** dans un **utilityProcess** Electron | Isolé de l'UI, survit aux rechargements de fenêtre |
| Base de données | **SQLite** via **better-sqlite3** | Local, transactionnel, robuste |
| Recherche vectorielle | **sqlite-vec** (extension SQLite) | Tout dans un seul fichier de base |
| Embeddings | **Transformers.js** avec un modèle multilingue local (ex. `multilingual-e5-small` ou équivalent) **[À VÉRIFIER : choix du modèle et taille]** | Gratuit, hors ligne, pas de coût API |
| Recherche plein texte | **SQLite FTS5** | Recherche hybride (lexicale + vectorielle) |
| Lecture PDF | **pdfjs-dist** (texte) ; OCR optionnel V1.1 via **tesseract.js** (langue `fra`) | Beaucoup de PDF africains sont scannés |
| Lecture DOCX | **mammoth** | |
| Lecture tableurs | **SheetJS (xlsx)** + **papaparse** | Données de terrain |
| Génération DOCX | **docx** (npm) | Contrôle fin des styles, TOC, notes de bas de page |
| Génération PDF | Rendu HTML/CSS paginé puis `webContents.printToPDF` d'Electron | Pas de dépendance externe |
| Génération PPTX | **pptxgenjs** | |
| Graphiques (données de terrain) | **Vega-Lite** rendu en SVG/PNG côté moteur | Figures pour le chapitre résultats |
| Validation de schémas | **zod** | Toutes les sorties d'agents sont du JSON validé |
| Appels LLM | Client HTTP maison vers l'API OpenRouter (compatible OpenAI) | Contrôle total des réessais et des coûts |
| Tests | **Vitest** (unitaire), **Playwright** (E2E Electron) | |
| Qualité | ESLint + Prettier, TypeScript `strict` | |

### 4.2 Processus

```
┌──────────────────────────────────────────────────────────┐
│  Processus principal Electron (main)                     │
│  - fenêtres, menus, mises à jour, safeStorage            │
│  - lance et supervise le processus moteur                │
│  - relaie les messages IPC UI <-> moteur                 │
└───────────────┬───────────────────────┬──────────────────┘
                │ IPC (preload, typé)   │ MessagePort
┌───────────────▼─────────┐   ┌─────────▼───────────────────┐
│ Renderer (React)        │   │ Moteur (utilityProcess)     │
│ - écrans, dashboard     │   │ - orchestrateur             │
│ - n'accède JAMAIS       │   │ - file de tâches            │
│   directement au réseau │   │ - agents, outils            │
│   ni à la DB            │   │ - connecteurs de sources    │
└─────────────────────────┘   │ - SQLite + sqlite-vec       │
                              │ - embeddings locaux         │
                              │ - générateurs de livrables  │
                              └─────────────────────────────┘
```

Règles :
- Le renderer NE DOIT PAS avoir `nodeIntegration`. `contextIsolation: true`. Il communique via une API exposée par `preload.ts` (`window.iroko.*`), typée.
- Le moteur DOIT être redémarrable par le processus principal s'il plante ; au redémarrage, il relit l'état depuis SQLite et reprend les missions marquées `running`.
- Le moteur émet des événements (`mission.progress`, `task.started`, `task.completed`, `cost.updated`, `log`) que le main relaie au renderer.

### 4.3 Empêcher la mise en veille

Pendant une mission en cours, l'application DEVRAIT utiliser `powerSaveBlocker.start('prevent-app-suspension')`. Un réglage permet de le désactiver. Si le PC s'éteint quand même, la reprise (§8.6) prend le relais.

### 4.4 Arborescence du dépôt

```
iroko-memoire/
├── CLAUDE.md                     # conventions pour Claude Code
├── docs/
│   ├── CAHIER_DES_CHARGES.md     # ce document
│   ├── DECISIONS.md              # journal des décisions (ADR)
│   └── PROMPTS.md                # documentation des prompts d'agents
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main.ts
│       │   ├── preload.ts
│       │   └── ipc/              # handlers IPC typés
│       └── renderer/
│           ├── src/
│           │   ├── pages/        # écrans (§6)
│           │   ├── components/
│           │   ├── stores/
│           │   └── lib/
│           └── index.html
├── packages/
│   ├── engine/                   # moteur indépendant d'Electron (§4.6)
│   │   ├── src/
│   │   │   ├── orchestrator/     # machine à états, planification
│   │   │   ├── queue/            # file de tâches persistante
│   │   │   ├── agents/           # un dossier par agent (§10)
│   │   │   │   └── <agent>/
│   │   │   │       ├── prompt.md
│   │   │   │       ├── schema.ts # zod de la sortie
│   │   │   │       └── index.ts
│   │   │   ├── llm/              # client OpenRouter, coûts, réessais
│   │   │   ├── sources/          # connecteurs (§11)
│   │   │   ├── kb/               # ingestion, chunking, embeddings, recherche
│   │   │   ├── verification/     # §12
│   │   │   ├── jury/             # §13
│   │   │   ├── norms/            # profils de normes (§15)
│   │   │   ├── export/           # docx, pdf, pptx (§16)
│   │   │   ├── storage/          # SQLite, migrations, repos
│   │   │   └── events/
│   │   └── test/
│   └── shared/                   # types partagés, schémas zod communs
├── resources/
│   ├── models/                   # modèle d'embeddings embarqué
│   ├── norms/                    # profils de normes JSON
│   └── templates/                # gabarits DOCX/PPTX
└── package.json                  # monorepo (pnpm workspaces)
```

### 4.5 Stockage sur disque

Dossier de données utilisateur (`app.getPath('userData')`) :
```
userData/
├── iroko.db                 # SQLite principal (toutes les missions)
├── missions/<missionId>/
│   ├── uploads/             # fichiers importés (copies)
│   ├── sources/             # PDF téléchargés (accès ouvert)
│   ├── figures/             # graphiques générés
│   ├── drafts/              # versions des chapitres (Markdown)
│   └── outputs/             # livrables finaux
└── logs/
```

### 4.6 Préparation au mode cloud Cloudflare (V2)

Le package `engine` NE DOIT PAS dépendre d'Electron. Il expose des interfaces abstraites :
- `StorageAdapter` (impl. V1 : SQLite local ; V2 : Cloudflare D1 + R2),
- `VectorAdapter` (V1 : sqlite-vec ; V2 : Cloudflare Vectorize),
- `QueueAdapter` (V1 : table SQLite ; V2 : Cloudflare Queues / Durable Objects),
- `EmbeddingAdapter` (V1 : Transformers.js local ; V2 : Workers AI),
- `FileAdapter` (V1 : système de fichiers ; V2 : R2).

Ainsi, en V2, le même moteur pourra tourner dans un Worker Cloudflare avec Durable Objects pour la mission longue, et l'app desktop deviendra un client qui s'y connecte. **En V1, ne rien implémenter côté Cloudflare** ; seulement respecter ces interfaces.

---

## 5. Modèle de données (SQLite)

Toutes les tables ont `created_at` et `updated_at` (ISO 8601). Les identifiants sont des UUID v7 (ordonnés dans le temps). Les champs `*_json` contiennent du JSON validé par zod.

### 5.1 `settings`
| Colonne | Type | Description |
|---|---|---|
| key | TEXT PK | ex. `openrouter_key_encrypted`, `default_models`, `ui_theme` |
| value_json | TEXT | |

### 5.2 `missions`
| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| title | TEXT | Titre du mémoire |
| status | TEXT | `draft`, `briefing`, `planning`, `awaiting_plan_validation`, `running`, `paused`, `paused_no_credit`, `paused_network`, `paused_budget`, `failed`, `completed`, `cancelled` |
| current_phase | TEXT | `P0`…`P9` |
| brief_json | TEXT | Brief complet (§7) |
| config_json | TEXT | Paramètres d'exécution (§7.6) |
| plan_json | TEXT | Plan validé (§9.3) |
| norms_profile_id | TEXT | |
| cost_estimate_json | TEXT | Fourchette estimée |
| cost_spent_usd | REAL | Cumul réel |
| started_at, finished_at | TEXT | |
| last_checkpoint_id | TEXT | |
| error_json | TEXT | Dernière erreur |

### 5.3 `mission_files`
Fichiers importés : `id`, `mission_id`, `kind` (`user_document`, `field_data`, `institution_guidelines`, `template`, `other`), `filename`, `path`, `mime`, `size`, `sha256`, `parsed_status`, `parsed_text_path`, `meta_json`.

### 5.4 `tasks`
| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| mission_id | TEXT | |
| phase | TEXT | |
| agent_role | TEXT | §10 |
| parent_task_id | TEXT | |
| depends_on_json | TEXT | Liste d'ids de tâches |
| status | TEXT | `pending`, `ready`, `running`, `done`, `failed`, `skipped`, `blocked` |
| priority | INTEGER | |
| input_json | TEXT | |
| output_json | TEXT | |
| attempts | INTEGER | |
| max_attempts | INTEGER | défaut 3 |
| lease_until | TEXT | Verrou temporaire (récupération des tâches orphelines) |
| cost_usd | REAL | |
| tokens_in, tokens_out | INTEGER | |
| model | TEXT | |
| error_json | TEXT | |
| started_at, finished_at | TEXT | |

### 5.5 `llm_calls`
Journal de chaque appel : `id`, `task_id`, `model`, `request_hash`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `latency_ms`, `status_code`, `error`, `openrouter_generation_id`. Le contenu complet des prompts et réponses est stocké dans un fichier compressé si l'option « journal détaillé » est activée.

### 5.6 `sources`
| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| mission_id | TEXT | |
| origin | TEXT | `openalex`, `semantic_scholar`, `crossref`, `hal`, `arxiv`, `core`, `doaj`, `pubmed`, `user_upload`, `web`, `github_dataset`, … |
| type | TEXT | `article`, `ouvrage`, `chapitre`, `these`, `memoire`, `rapport`, `texte_officiel`, `site_web`, `donnees` |
| title, authors_json, year, publisher, journal, volume, issue, pages | | Métadonnées bibliographiques |
| doi, isbn, url, oa_pdf_url | TEXT | |
| language | TEXT | |
| abstract | TEXT | |
| fulltext_status | TEXT | `none`, `abstract_only`, `fulltext` |
| verification_status | TEXT | `unverified`, `verified`, `partially_verified`, `rejected` |
| verification_json | TEXT | Preuves (§12) |
| relevance_score | REAL | 0–1 |
| quality_score | REAL | 0–1 |
| used_in_text | INTEGER | Nombre d'ancrages |
| csl_json | TEXT | Notice au format CSL-JSON (pour le formatage bibliographique) |

### 5.7 `chunks`
`id`, `source_id`, `mission_id`, `ordinal`, `text`, `page_from`, `page_to`, `section_title`, `token_count`, + table virtuelle FTS5 `chunks_fts` et table vectorielle `chunks_vec` (sqlite-vec).

### 5.8 `outline_nodes`
Le plan : `id`, `mission_id`, `parent_id`, `ordinal`, `level` (partie / chapitre / section / sous-section), `numbering` (ex. « 2.3.1 »), `title`, `objective`, `key_questions_json`, `target_words`, `required_sources_min`, `status` (`planned`, `researching`, `drafting`, `in_review`, `validated`), `current_version_id`.

### 5.9 `drafts`
Versions de texte : `id`, `outline_node_id`, `version`, `markdown`, `word_count`, `author_agent`, `round`, `parent_version_id`, `change_summary`.

### 5.10 `claims`
Ancrages : `id`, `draft_id`, `sentence_index`, `claim_text`, `chunk_id`, `source_id`, `support_level` (`supported`, `partially`, `unsupported`), `checked_by`, `checked_at`.

### 5.11 `jury_reviews`
`id`, `mission_id`, `scope` (`section`, `chapter`, `global`), `target_id`, `round`, `juror_role`, `scores_json` (grille §13.2), `total_score`, `verdict` (`valide`, `a_reviser`, `a_reecrire`), `comments_json` (liste de remarques structurées), `model`.

### 5.12 `checkpoints`
`id`, `mission_id`, `phase`, `snapshot_json` (état de l'orchestrateur : phase, rondes en cours, compteurs), `created_at`.

### 5.13 `events`
Journal chronologique affiché dans le dashboard : `id`, `mission_id`, `level` (`info`, `success`, `warning`, `error`), `agent_role`, `message_fr`, `data_json`, `created_at`.

### 5.14 `norms_profiles`
`id`, `name`, `builtin` (bool), `profile_json` (§15).

### 5.15 Migrations
Utiliser un système de migrations versionnées (fichiers SQL numérotés). Ne jamais modifier une migration déjà livrée.

---

## 6. Interface utilisateur

### 6.1 Direction artistique (DA) et design system

Cette section est **contraignante** : l'interface DOIT rester dans l'univers visuel des références fournies. Toute nouvelle vue DOIT être construite avec les tokens et composants définis ici, jamais avec des valeurs codées en dur.

#### 6.1.1 Les références

Les références sont dans `docs/references/` :
- `originaux/` : les 5 maquettes complètes (vue d'ensemble de l'ambiance) ;
- `extraits/` : 17 extraits recadrés (×2) de composants précis, nommés par code.

| Code | Fichier original | Ce qu'on en retient |
|---|---|---|
| **REF-A** | `REF-A_dashboard-violet.jpeg` | Couleur d'accent violette, bannière de bienvenue avec illustration 3D, cartes KPI, cartes d'action avec bouton pilule, panneau de notices à droite |
| **REF-B** | `REF-B_accueil-assistant.jpeg` | Barre latérale claire avec élément actif violet plein, accueil centré « Bonjour… », zone de saisie (composer) avec pièce jointe et envoi, puces de suggestions |
| **REF-C** | `REF-C_projets-panneau-info.jpeg` | Fil d'Ariane, grille de cartes « dossiers », carte sélectionnée mise en avant, panneau d'informations à droite (jauges, propriétés, étiquettes) |
| **REF-D** | `REF-D_import-fichiers.jpeg` | Zone de dépôt en pointillés, icône sur bulle en verre dépoli lumineuse, ligne de fichier avec barre de progression, boutons pilules Annuler / Valider |
| **REF-E** | `REF-E_accueil-historique.jpeg` | Fond dégradé doux, cartes d'actions rapides, composer avec options, panneau historique à droite, carte utilisateur en verre dépoli en bas de la barre latérale |

Extraits et usage dans l'application :

| Extrait | Composant de référence | Où l'utiliser (§6) |
|---|---|---|
| `A2_banniere-bienvenue.png` | Bannière d'accueil violette + illustration 3D | Accueil (§6.3), écran de fin de mission (§6.8) |
| `A3_cartes-kpi.png` | Cartes indicateurs (icône 3D, valeur, libellé), carte active à bordure violette | Accueil (missions en cours, crédit, coût total), dashboard de mission (§6.6) |
| `A4_cartes-actions.png` | Cartes teintées violet clair avec bouton pilule « Voir » | Cartes de missions en cours (§6.3) |
| `A5_panneau-notices.png` | Panneau latéral « Voir tout » + liste d'avis | Panneau « Activité récente / Alertes » de l'accueil |
| `A1_sidebar-violet.png` | Barre latérale violette pleine | **Non retenu** pour la barre principale (voir 6.1.2) ; style réutilisable pour l'écran d'onboarding (§6.2) |
| `B1_sidebar-nouvelle-mission.png` | Barre latérale claire, bouton principal violet plein en haut, liste de récents | Barre latérale principale |
| `B2_accueil-composer-suggestions.png` | Accueil centré, titre avec mot en violet, composer, suggestions en puces | Écran « Nouvelle mission » (point d'entrée du wizard, §6.4) |
| `C1_entete-fil-ariane.png` | En-tête avec retour, fil d'Ariane, actions, titre, recherche, filtre, bouton noir | En-tête de toutes les pages de liste et du dashboard de mission |
| `C2_grille-cartes-dossiers.png` | Grille de cartes « dossier » avec compteurs, carte sélectionnée | « Mes missions », « Bibliothèque de sources », gabarits de normes |
| `C3_panneau-info-droite.png` | Panneau d'infos : jauges, propriétés, étiquettes | Colonne d'indicateurs du dashboard de mission ; détail d'une mission sélectionnée |
| `D1_zone-depot.png` | Zone de dépôt + bulle d'icône lumineuse | Wizard étape 5 (documents et données) |
| `D2_fichier-progression.png` | Ligne de fichier + barre de progression + fermer | Liste des fichiers importés et de leur traitement (P0) |
| `D3_boutons.png` | Paire de boutons pilules secondaire / principal | Pied de chaque étape du wizard et de toutes les modales |
| `E1_cartes-actions-rapides.png` | Cartes d'actions rapides (icône, titre, description) | Choix rapide du type de travail sur l'écran « Nouvelle mission » |
| `E2_composer.png` | Composer avec boutons Joindre / Paramètres / Options | Champ « Thème de votre mémoire » sur l'écran « Nouvelle mission » ; champ d'instructions de l'écran de validation du plan |
| `E3_panneau-historique.png` | Panneau à droite : recherche, entrées avec titre, description, avatars, heure | Flux d'activité des agents dans le dashboard de mission |
| `E4_carte-utilisateur.png` | Carte en verre dépoli en bas de la barre latérale | Carte « Crédit OpenRouter » en bas de la barre latérale (remplace « Upgrade ») |

**Règles d'usage des références** :
1. Ce sont des **inspirations de style**, pas des écrans à copier. Les contenus, textes, noms de marques (« Kintsugi », « SETO », « Iconly », etc.), logos, photos et le personnage 3D NE DOIVENT PAS être repris.
2. Les illustrations 3D DOIVENT être des assets originaux ou sous licence libre compatible (ex. packs d'illustrations 3D à licence commerciale) — **[À VÉRIFIER : licence de chaque asset utilisé, listée dans `docs/ASSETS.md`]**. Thèmes : toque de diplômé, livres, loupe, documents, médaille, fusée. En attendant, utiliser des emplacements neutres.
3. L'application est **gratuite** : aucun élément « Passer Pro / Upgrade » ne doit apparaître.

#### 6.1.2 Synthèse de l'univers

- **Ambiance** : claire, aérée, douce, rassurante, haut de gamme. Beaucoup d'espace blanc, cartes arrondies flottant sur un fond légèrement teinté.
- **Une seule couleur d'accent : le violet.** Les autres couleurs servent uniquement aux statuts.
- **Barre latérale claire** (REF-B / REF-C / REF-E, majoritaire dans les références) avec élément actif en violet plein. Le violet plein est réservé aux grands aplats ponctuels : bannière d'accueil, bouton principal, élément actif.
- **Profondeur** : ombres très diffuses, touches de verre dépoli (glassmorphism léger) sur les bulles d'icônes et la carte de crédit, illustrations 3D douces.
- **Formes** : grands rayons d'arrondi, boutons en pilule.
- **Mise en page** type « 3 zones » : barre latérale (fixe) + contenu central + panneau contextuel à droite (repliable), comme REF-C et REF-E.
- **Cadre de fenêtre** : le contenu de l'application est posé dans un grand conteneur blanc arrondi (rayon 24 px) sur un fond dégradé très doux (REF-B, REF-E), avec une marge de 12 px autour en mode fenêtré. En plein écran, la marge PEUT tomber à 0.

#### 6.1.3 Tokens de couleur

Valeurs relevées sur les références puis harmonisées. Elles DOIVENT être définies comme variables CSS (`:root` et `.dark`) et exposées dans `tailwind.config` (aucune couleur en dur dans les composants).

| Token | Clair | Sombre | Usage |
|---|---|---|---|
| `--bg-app` | `#F4F1FB` | `#0F0D17` | Fond derrière le conteneur principal |
| `--bg-app-gradient` | `linear-gradient(160deg,#EEE8FC 0%,#F6F4FB 55%,#FBEDE8 100%)` | `linear-gradient(160deg,#16122A 0%,#0F0D17 60%,#1A1214 100%)` | Fond dégradé doux (REF-E, accent pêche très léger) |
| `--surface` | `#FFFFFF` | `#17141F` | Conteneur principal, cartes |
| `--surface-muted` | `#F8F7FC` | `#1D1A27` | Barre latérale, zones secondaires, champs |
| `--surface-glass` | `rgba(255,255,255,0.55)` + `backdrop-filter: blur(16px)` | `rgba(30,26,40,0.55)` + blur | Bulles d'icônes, carte crédit |
| `--border` | `#ECE9F4` | `#2A2635` | Bordures fines 1 px |
| `--text` | `#1C1A27` | `#F2F0F8` | Texte principal |
| `--text-muted` | `#7D7A8C` | `#9C98AD` | Descriptions, libellés |
| `--text-subtle` | `#A9A6B6` | `#6E6A80` | Métadonnées (heures, tailles) |
| `--primary` | `#8B5CF6` | `#9D74F8` | Accent violet (bouton principal, actif, liens « Voir tout ») |
| `--primary-hover` | `#7C4DEB` | `#AE8AFA` | Survol |
| `--primary-strong` | `#7046E0` | `#8B5CF6` | Bannières, aplats |
| `--primary-soft` | `#EFE8FE` | `#2A2140` | Fonds teintés (cartes d'action REF-A4, puces) |
| `--primary-softer` | `#F7F3FF` | `#211B31` | Survol des lignes, élément sélectionné discret |
| `--primary-gradient` | `linear-gradient(135deg,#9B6CF2 0%,#7B4FE6 100%)` | idem | Bannière d'accueil (REF-A2) |
| `--ink` | `#16141F` | `#F2F0F8` | Boutons noirs secondaires forts (REF-C « New draft », REF-E « Create new chat ») |
| `--success` | `#16A36A` / soft `#E6F7EF` | `#34D399` / soft `#10291F` | Section validée, source vérifiée |
| `--warning` | `#E08A0B` / soft `#FFF4E0` | `#FBBF24` / soft `#2B2010` | À réviser, budget 80 % |
| `--danger` | `#E5484D` / soft `#FDECEC` | `#F87171` / soft `#2E1416` | Erreur, source rejetée, crédit épuisé |
| `--info` | `#3B82F6` / soft `#EAF2FF` | `#60A5FA` / soft `#121F33` | Recherche en cours, informations |

Couleurs des **statuts de section** (§6.6) : prévue = `--text-subtle` ; recherche = `--info` ; rédaction = `--primary` ; révision jury = `--warning` ; validée = `--success` ; acceptée avec réserves = `--warning` hachuré ; erreur = `--danger`.

Contraste : tout texte DOIT respecter WCAG AA (4,5:1 ; 3:1 pour le texte ≥ 18 px). Le texte blanc sur `--primary` est autorisé en gras ≥ 14 px ; sinon utiliser `--primary-strong`.

#### 6.1.4 Typographie

- **Titres** : *Poppins* (600 / 700) — proche des références REF-A et REF-B.
- **Texte d'interface** : *Inter* (400 / 500 / 600).
- **Aperçu de document** (brouillons, plan, lecture) : *Source Serif 4* (ou police du profil de normes si disponible), pour se rapprocher du rendu final.
- Polices **embarquées localement** (paquets `@fontsource/*`), jamais chargées depuis Internet (l'application doit fonctionner hors ligne).

| Style | Police | Taille / interligne | Graisse | Usage |
|---|---|---|---|---|
| `display` | Poppins | 32 / 40 | 700 | « Bonjour Marion ! » (REF-B2) |
| `h1` | Poppins | 24 / 32 | 600 | Titre de page (REF-C1) |
| `h2` | Poppins | 18 / 26 | 600 | Titre de carte, de panneau (« Activité », « Voir tout ») |
| `h3` | Inter | 15 / 22 | 600 | Titre d'élément de liste |
| `body` | Inter | 14 / 22 | 400 | Texte courant |
| `small` | Inter | 13 / 18 | 400 | Descriptions |
| `caption` | Inter | 12 / 16 | 500 | Métadonnées, étiquettes |
| `kpi` | Poppins | 22 / 28 | 600 | Valeurs des cartes KPI (REF-A3) |

Chiffres : `font-variant-numeric: tabular-nums` pour les coûts, compteurs et durées.

#### 6.1.5 Espacements, rayons, ombres, verre

- **Grille d'espacement** : multiples de 4 px (4, 8, 12, 16, 20, 24, 32, 40, 48).
- Padding des cartes : 20 px ; des panneaux : 24 px ; écart entre cartes : 16 px ; écart entre sections : 32 px.
- **Rayons** :

| Token | Valeur | Usage |
|---|---|---|
| `--radius-sm` | 8 px | Puces, étiquettes, champs internes |
| `--radius-md` | 12 px | Champs, éléments de liste, élément actif de la barre latérale |
| `--radius-lg` | 16 px | Cartes |
| `--radius-xl` | 20 px | Cartes mises en avant, bannière, zone de dépôt |
| `--radius-2xl` | 24 px | Conteneur principal de l'app, modales |
| `--radius-full` | 9999 px | Boutons pilules, avatars, bulles d'icônes |

- **Ombres** (très diffuses, teintées violet) :
  - `--shadow-sm` : `0 1px 2px rgba(28,26,39,0.04), 0 1px 3px rgba(28,26,39,0.04)`
  - `--shadow-md` : `0 8px 24px -6px rgba(76,52,140,0.10)` (cartes)
  - `--shadow-lg` : `0 20px 48px -12px rgba(76,52,140,0.18)` (modales, carte sélectionnée)
  - `--shadow-glow` : `0 10px 30px -4px rgba(139,92,246,0.35)` (bulle d'icône lumineuse REF-D1, bouton principal au survol)
- **Verre dépoli** : `background: var(--surface-glass); backdrop-filter: blur(16px) saturate(140%); border: 1px solid rgba(255,255,255,0.6)`. À utiliser **avec parcimonie** : bulles d'icônes, carte de crédit, en-tête collant au défilement. Prévoir un repli opaque si `backdrop-filter` n'est pas supporté ou si l'option « Réduire les effets » est activée.

#### 6.1.6 Iconographie et illustrations

- Icônes : **Lucide**, trait 1,75 px, tailles 16 / 20 / 24 px, couleur `--text-muted` par défaut, `--primary` à l'état actif.
- Bulles d'icônes (REF-D1, REF-A3) : cercle ou carré arrondi, fond `--primary-soft` ou verre, icône `--primary`.
- Illustrations 3D (REF-A2, REF-A3) : uniquement sur l'accueil, les écrans vides, l'onboarding et l'écran de fin. Jamais dans les écrans de travail denses (dashboard de mission, tableaux).
- Logo de l'application : emplacement en haut de la barre latérale (comme REF-B1), en attendant l'identité définitive (§23).

#### 6.1.7 Bibliothèque de composants

Basée sur **shadcn/ui** (Radix) restylé avec les tokens. Chaque composant DOIT exister en version claire et sombre, avec états `default`, `hover`, `focus-visible` (anneau `--primary` 2 px décalé de 2 px), `active`, `disabled`, `loading`.

| Composant | Spécification | Référence |
|---|---|---|
| **AppShell** | Fond dégradé + conteneur blanc arrondi 24 px ; grille `sidebar 248 px | contenu fluide | panneau droit 320 px (repliable, masqué < 1280 px)` | REF-C, REF-E |
| **Sidebar** | Fond `--surface-muted`, logo en haut, bouton principal « + Nouvelle mission » pleine largeur (violet plein, rayon 12 px), puis navigation (icône + libellé, actif = fond `--primary` + texte blanc, ou fond `--primary-soft` + texte `--primary` pour les sous-éléments), section « Missions récentes » (5 dernières, icône horloge), et en bas : carte « Crédit OpenRouter » en verre (montant, mini-jauge, lien « Recharger ») + accès Paramètres. Repliable en mode icônes (72 px). | REF-B1, REF-E4 |
| **PageHeader** | Bouton retour, fil d'Ariane (icône dossier + libellés), actions à droite (icône + libellé, menu « … »), titre `h1`, ligne recherche + filtres + bouton principal | REF-C1 |
| **WelcomeBanner** | Hauteur 160 px, `--primary-gradient`, rayon 20 px, date en `caption` blanc 70 %, titre `display` blanc, sous-titre, illustration 3D débordant légèrement en haut à droite, petites pastilles décoratives | REF-A2 |
| **KpiCard** | Carte blanche, rayon 16 px, illustration/icône 3D centrée, valeur `kpi`, libellé `small` muted. Variante `active` : bordure 2 px `--primary` | REF-A3 |
| **ActionCard** | Fond `--primary-soft`, titre violet `h3`, illustration à droite, bouton pilule « Ouvrir ». Variante `selected` : bordure 2 px `--primary` | REF-A4 |
| **QuickActionCard** | Carte blanche ou verre, icône colorée en haut à gauche, titre `h3`, description `small` 2 lignes, survol = élévation `--shadow-md` + légère translation -2 px | REF-E1 |
| **FolderCard** | Carte avec forme d'onglet de dossier en haut, titre, compteur (« 12 sources »), méta (taille / date). Variante `selected` : dégradé violet clair → `--primary` avec texte blanc (transposition violette du bleu de REF-C2) | REF-C2 |
| **Composer** | Carte blanche rayon 16 px, ombre `--shadow-sm`, icône étincelle + placeholder, rangée d'actions (Joindre, Paramètres, Options) en boutons fantômes, micro (optionnel, désactivé en V1) et bouton d'envoi carré arrondi violet | REF-B2, REF-E2 |
| **SuggestionChip** | Pilule bordure `--border`, texte `small` muted, survol fond `--primary-softer` | REF-B2 |
| **Dropzone** | Bordure pointillée 1,5 px `--border`, rayon 20 px, titre centré, bulle d'icône en verre avec `--shadow-glow`, texte d'aide muted ; état `drag-over` : bordure `--primary`, fond `--primary-softer` | REF-D1 |
| **FileRow** | Carte, vignette d'icône type de fichier dans un carré arrondi, nom, méta « PDF · 2,4 Mo · analyse… », bouton fermer rond, barre de progression 4 px (`--primary` sur `--primary-soft`) | REF-D2 |
| **Button** | Variantes : `primary` (violet plein, pilule), `secondary` (blanc, bordure, pilule), `ink` (noir `--ink`, rayon 10 px, compact), `ghost`, `danger`. Tailles 32 / 40 / 48 px. Le pied des modales et du wizard utilise la paire `secondary` + `primary` de même largeur | REF-D3, REF-C1, REF-E3 |
| **InfoPanel** | Panneau droit : titre + bouton replier « » », blocs-cartes avec valeur + jauge colorée, section « Propriétés » (libellé / valeur alignés), étiquettes colorées, liens bas de panneau | REF-C3 |
| **ActivityFeed** | Panneau avec recherche, entrées : case/icône de rôle d'agent, titre `h3`, description 1 ligne tronquée, avatars d'agents empilés (icônes de rôle, pas de photos), horodatage relatif ; bouton bas `ink` | REF-E3 |
| **NoticeList** | Titre de panneau + lien « Voir tout » violet, éléments avec titre gras, texte 2–3 lignes, lien « Voir plus » | REF-A5 |
| **AgentAvatar** | Cercle 32 px, bordure 2 px `--primary`, icône du rôle (loupe = chercheur, plume = rédacteur, balance = jury, bouclier = vérificateur…) sur fond `--primary-soft` | REF-A5 (avatars) |
| **StatusBadge** | Pilule `caption`, fond `*-soft`, texte de la couleur de statut, point coloré à gauche | REF-C3 (tags) |
| **Stepper** (wizard) | Étapes en pastilles numérotées reliées par une ligne ; étape courante violet plein, faites = coche `--success`, futures = muted | Dérivé de la DA |
| **ProgressBar / Gauge** | Hauteur 6 px, rayon plein, piste `--primary-soft`, remplissage `--primary` (ou couleur de statut) | REF-C3, REF-D2 |
| **Tabs** | Onglets en pilules dans un conteneur `--surface-muted` ; actif = fond blanc + `--shadow-sm` | Dérivé |
| **Modal / Dialog** | Rayon 24 px, `--shadow-lg`, voile `rgba(16,14,24,0.35)` + flou 4 px | Dérivé |
| **Toast** | Carte verre en bas à droite, icône de statut, titre + description | Dérivé |
| **EmptyState** | Illustration 3D centrée, titre `h2`, texte muted, bouton principal | Dérivé |
| **Skeleton** | Blocs `--surface-muted` animés (shimmer doux) pour tout chargement > 300 ms | Dérivé |

#### 6.1.8 Mouvement

- Durées : 150 ms (survol), 200 ms (ouverture de panneau, onglets), 300 ms (modales). Courbe `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Apparition des cartes : fondu + translation 8 px, en cascade de 40 ms.
- Nouvelles entrées du flux d'activité : glissement depuis le haut.
- Barres de progression animées en continu ; la bulle de l'agent actif pulse doucement.
- Respect de `prefers-reduced-motion` et d'une option « Réduire les animations et effets » dans les Paramètres (désactive aussi le flou).

#### 6.1.9 Application de la DA aux écrans

| Écran (§) | Composition |
|---|---|
| Onboarding (§6.2) | Plein écran, panneau gauche violet plein (style REF-A1) avec illustration 3D et étapes ; panneau droit blanc avec le formulaire ; boutons REF-D3 |
| Accueil (§6.3) | `WelcomeBanner` (« Bonjour, [prénom] ! » si renseigné, sinon « Bonjour ! », date du jour) → rangée de 3 `KpiCard` (Missions en cours, Crédit OpenRouter, Coût total dépensé) → « Missions en cours » en `ActionCard` (titre, phase, barre de progression, bouton « Ouvrir ») → panneau droit `NoticeList` « Alertes et activité récente » |
| Nouvelle mission — entrée (§6.4) | Style REF-B2 / REF-E : logo étincelle centré, `display` « Quel travail lançons-nous aujourd'hui ? » avec « aujourd'hui » en violet, `Composer` pour le thème, 3 à 6 `QuickActionCard` pour le type de travail (Mémoire de master, Mémoire de licence, Rapport de stage, Rapport de formation, Thèse, Revue de littérature), `SuggestionChip` d'exemples de thèmes. Valider ouvre le wizard pré-rempli |
| Wizard (§6.4) | `PageHeader` + `Stepper` + formulaire dans une carte centrale (largeur max 760 px) + panneau droit « Aide et récapitulatif » ; pied : paire de boutons REF-D3 (« Précédent » / « Continuer ») ; étape 5 = `Dropzone` + `FileRow` |
| Validation du plan (§6.5) | `PageHeader` (« Valider le plan ») ; colonne gauche : arbre du plan en cartes compactes glissables ; centre : détail de la section en aperçu serif ; bas : `Composer` « Instructions supplémentaires » ; boutons « Demander une nouvelle version » (`secondary`) et « Valider et lancer la mission » (`primary`, grand) |
| Dashboard de mission (§6.6) | `PageHeader` avec fil d'Ariane (Mes missions › titre), statut `StatusBadge`, boutons Pause / Reprendre / Annuler ; frise des phases P0–P9 en `Stepper` horizontal ; rangée de `KpiCard` (Sources vérifiées, Mots rédigés / cible, Note du jury, Coût / budget) ; centre : `Tabs` (Activité, Plan, Sources, Jury, Brouillons, Coûts, Journal) ; onglet Activité = agents actifs en cartes + `ActivityFeed` ; panneau droit = `InfoPanel` (jauges budget et crédit, propriétés de mission, ronde de révision, évolution des notes en mini-graphique) |
| Mes missions / Bibliothèque de sources | `PageHeader` + grille de `FolderCard` (une carte par mission ou par groupe de sources) ; clic = sélection + `InfoPanel` à droite ; double-clic = ouverture |
| Fin de mission (§6.8) | `WelcomeBanner` de célébration (« Votre mémoire est prêt »), `KpiCard` récapitulatifs, liste des livrables en `FileRow` avec boutons « Ouvrir » / « Afficher dans le dossier », `NoticeList` des points d'attention |
| Paramètres | Navigation verticale en `Tabs` à gauche (Clé et modèles, Normes, Exécution, Apparence, Données et journaux, À propos) ; formulaires en cartes |

#### 6.1.10 Règles transverses

- Tous les textes en français, ton clair et rassurant, sans jargon (« modèle d'IA » plutôt que « LLM », « crédit » plutôt que « tokens » dans les écrans principaux ; les tokens restent visibles dans l'onglet Coûts).
- Largeur minimale de fenêtre : 1024 px. Points de rupture : < 1280 px panneau droit en tiroir ; < 1100 px barre latérale en mode icônes.
- Thème : clair par défaut, sombre, ou « Système ».
- Les graphiques (évolution des notes, coûts) utilisent `--primary` pour la série principale et les couleurs de statut pour le reste, sans autre teinte.
- Un fichier `apps/desktop/renderer/src/styles/tokens.css` + une page de démonstration interne `/design` (accessible en mode développeur) DOIVENT présenter tous les tokens et composants, pour validation visuelle par Marion **avant** la construction des écrans.

### 6.2 Premier lancement (onboarding)

Écran 1 — Bienvenue : présentation en 3 points + lien vers la charte d'utilisation (§17).
Écran 2 — Clé OpenRouter :
- Champ clé (masqué), bouton « Tester la clé ».
- Le test appelle l'endpoint d'information de clé d'OpenRouter **[À VÉRIFIER : endpoint exact, ex. `GET /api/v1/key` ou `/api/v1/credits`]** et affiche le crédit restant si disponible.
- Lien « Comment obtenir une clé OpenRouter ? » (mini-guide en 4 étapes, dans l'app).
Écran 3 — Choix des modèles : préréglages (§14.3) « Économique », « Équilibré », « Excellence », ou « Personnalisé ».
Écran 4 — Profil de normes par défaut (§15).

### 6.3 Accueil

- Missions en cours (carte avec progression, phase, coût, temps écoulé, bouton Ouvrir).
- Bouton principal « Nouvelle mission ».
- Missions terminées récentes.
- Indicateur de crédit OpenRouter (rafraîchi toutes les 10 min et après chaque phase).

### 6.4 Assistant « Nouvelle mission » (wizard en 7 étapes)

Une barre d'étapes en haut. Chaque étape est enregistrée automatiquement (brouillon de mission). Navigation libre entre les étapes déjà visitées.

**Étape 1 — Type de travail**
- Type : Mémoire de licence / Mémoire de master / Thèse de doctorat (chapitres) / Rapport de stage / Rapport de fin de formation professionnelle / Projet professionnel / Article scientifique / Revue de littérature seule.
- Niveau d'exigence : Standard / Élevé / Très élevé (influence les seuils du jury).
- Discipline (liste + champ libre) : ex. Sciences de gestion, Droit, Économie, Sociologie, Santé publique, Informatique, Agronomie, Sciences de l'éducation, Communication…
- Spécialité (texte libre).

**Étape 2 — Le sujet**
- Thème / titre provisoire (obligatoire).
- Problématique (obligatoire, ou case « Je veux que l'agent m'aide à la formuler » → l'agent proposera 3 formulations en P1).
- Questions de recherche (liste éditable).
- Objectifs général et spécifiques.
- Hypothèses (liste éditable, optionnelle).
- Terrain d'étude : pays, ville, structure / entreprise, période.
- Approche méthodologique : quantitative / qualitative / mixte / documentaire / à proposer par l'agent.
- Mots-clés (5 à 10).

**Étape 3 — Exigences de l'établissement**
- Établissement, faculté / école (texte).
- Nombre de pages visé (min–max) ou nombre de mots.
- Structure imposée : « Standard » (§15.3) ou « Personnalisée » (éditeur d'arbre) ou « Importée » (l'utilisateur importe le guide de rédaction de son établissement : l'agent en extrait les règles en P1).
- Pages liminaires souhaitées (cases) : page de garde, sommaire, dédicace, remerciements, sigles et abréviations, liste des tableaux, liste des figures, résumé, abstract (anglais), avertissement.
- Informations de page de garde : nom de l'étudiant, directeur de mémoire, maître de stage, année académique, logo de l'établissement (import image).
- Critères d'évaluation connus du jury (texte libre ou import de la grille).

**Étape 4 — Normes et format**
- Profil de normes (§15) : sélection + aperçu (exemple de citation dans le texte et de notice bibliographique).
- Style de citation dans le texte : auteur-date ou notes de bas de page (pré-rempli par le profil).
- Police, taille, interligne, marges (pré-remplis par le profil, modifiables).
- Livrables (cases) : DOCX, PDF, Diaporama de soutenance (PPTX), Fiche de préparation à la soutenance (questions probables du jury + réponses), Rapport de mission (sources, notes, coûts).
- Nombre de diapositives souhaité (défaut 15).

**Étape 5 — Documents et données**
- Zone de dépôt multi-fichiers, avec pour chaque fichier un type :
  - « Document de référence » (cours, articles, ouvrages en PDF) → intégré à la base de connaissances, prioritaire.
  - « Données de terrain » (questionnaires dépouillés CSV/XLSX, transcriptions d'entretiens, observations, statistiques de l'entreprise).
  - « Guide de rédaction de l'établissement ».
  - « Travail déjà rédigé » (chapitres existants à intégrer ou améliorer).
  - « Gabarit Word de l'établissement » (.docx/.dotx) → utilisé pour les styles du livrable.
- Pour les données de terrain : un court formulaire décrit la méthode de collecte (taille d'échantillon, mode d'échantillonnage, période, outil). Ces informations alimentent le chapitre méthodologique.
- Avertissement visible : « L'agent n'invente jamais de données. Si votre travail nécessite une enquête de terrain, importez vos données ici. Sans données, le chapitre résultats sera limité à une analyse documentaire. »

**Étape 6 — Paramètres d'exécution** (section « Avancé » repliée par défaut, valeurs par défaut §7.6)
- Modèles par rôle (préréglage ou personnalisé).
- Budget maximal en USD (obligatoire, défaut proposé = estimation haute × 1,3).
- Rondes de révision, seuils du jury, profondeur de recherche, nombre minimal de sources.
- Parallélisme (nombre d'agents simultanés, défaut 3).
- Préférence de sources : toutes / priorité aux sources africaines / priorité aux sources récentes (moins de 10 ans).

**Étape 7 — Récapitulatif et estimation**
- Récapitulatif complet du brief.
- **Estimation de coût et de durée** (§14.5) : fourchette basse / moyenne / haute, en USD et en durée estimée.
- Vérification du crédit disponible : alerte si crédit < estimation haute.
- Bouton « Générer le plan ».

### 6.5 Écran de validation du plan

- Panneau gauche : arbre du plan (parties, chapitres, sections) avec numérotation, éditable (renommer, déplacer par glisser-déposer, ajouter, supprimer).
- Panneau droit (section sélectionnée) : objectif, questions clés, nombre de mots cible, sources pressenties (titres trouvés en recherche exploratoire), remarques de l'agent.
- En haut : problématique retenue, hypothèses, méthodologie proposée, répartition des mots.
- Champ « Instructions supplémentaires pour l'agent » (texte libre).
- Boutons : « Demander une nouvelle version du plan » (avec commentaire), « Valider le plan et lancer la mission ».
- Rappel : « Après validation, l'agent travaille en autonomie. Vous pourrez suivre l'avancement et mettre en pause à tout moment. »

### 6.6 Dashboard de mission (pendant l'exécution)

Disposition :
- **Bandeau supérieur** : titre, statut, phase actuelle (P0–P9 en frise), temps écoulé, coût actuel / budget (barre), crédit OpenRouter restant, boutons Pause / Reprendre / Annuler.
- **Colonne gauche — Plan vivant** : chaque section avec son statut (icône + couleur : prévue, recherche, rédaction, révision, validée) et sa dernière note du jury.
- **Centre — Activité en direct** : liste des agents actifs (rôle, tâche, modèle, durée), et le flux d'événements (§5.13) en langage clair, ex. :
  - « 🔎 Chercheur (chap. 2) : 14 nouvelles sources trouvées sur OpenAlex »
  - « ✅ Vérificateur : 12 sources vérifiées, 2 rejetées (DOI introuvable) »
  - « ✍️ Rédacteur : section 2.3 rédigée (1 240 mots) »
  - « ⚖️ Jury : chapitre 2 noté 13,5/20 — à réviser (3 remarques majeures) »
- **Colonne droite — Indicateurs** : sources collectées / vérifiées / utilisées, mots rédigés / cible, note globale actuelle, ronde de révision en cours, graphique d'évolution des notes.
- **Onglets** : Activité | Plan | Sources | Jury | Brouillons | Coûts | Journal technique.

### 6.7 Onglets détaillés

- **Sources** : tableau filtrable (statut de vérification, origine, année, utilisée ou non), fiche détaillée avec preuves de vérification et extraits cités.
- **Jury** : pour chaque évaluation, la grille notée, le verdict, les remarques et la réponse apportée lors de la révision (avant / après).
- **Brouillons** : lecture de chaque section avec historique des versions et comparaison (diff) entre versions.
- **Coûts** : coût par phase, par agent, par modèle ; projection du coût restant.

### 6.8 Écran de fin de mission

- Résumé : note finale du jury, nombre de pages, de sources, durée, coût.
- Livrables téléchargeables / bouton « Ouvrir le dossier ».
- Points d'attention signalés par l'agent (ex. « La section 3.2 repose sur peu de sources africaines récentes »).
- Rappel de la charte (§17).

### 6.9 Notifications

- Notification système Windows à : plan prêt, mission terminée, mission en pause (crédit, réseau, budget), erreur fatale.

---

## 7. Le brief et la configuration de mission

### 7.1 Schéma du brief (`brief_json`)

```ts
type Brief = {
  workType: 'memoire_licence' | 'memoire_master' | 'these_chapitres' | 'rapport_stage'
          | 'rapport_formation_pro' | 'projet_pro' | 'article' | 'revue_litterature';
  exigence: 'standard' | 'eleve' | 'tres_eleve';
  discipline: string;
  specialite?: string;
  titre: string;
  problematique?: string;            // vide => l'agent propose
  problematiqueAProposer: boolean;
  questionsRecherche: string[];
  objectifGeneral?: string;
  objectifsSpecifiques: string[];
  hypotheses: string[];
  terrain?: { pays?: string; ville?: string; structure?: string; periode?: string };
  approche: 'quantitative' | 'qualitative' | 'mixte' | 'documentaire' | 'a_proposer';
  motsCles: string[];
  etablissement?: { nom?: string; faculte?: string; anneeAcademique?: string };
  auteur?: { nom?: string; directeur?: string; maitreStage?: string };
  longueur: { unite: 'pages' | 'mots'; min: number; max: number };
  structure: { mode: 'standard' | 'personnalisee' | 'importee'; arbre?: OutlineInput[] };
  liminaires: Record<'pageGarde'|'sommaire'|'dedicace'|'remerciements'|'sigles'
                    |'listeTableaux'|'listeFigures'|'resume'|'abstract'|'avertissement', boolean>;
  criteresJury?: string;
  livrables: { docx: boolean; pdf: boolean; pptx: boolean; nbDiapos?: number;
               fichePreparation: boolean; rapportMission: boolean };
  instructionsLibres?: string;
};
```

### 7.2 Règle sur la dédicace et les remerciements

Ces pages sont personnelles. L'agent NE DOIT PAS les inventer. Il produit un **modèle à compléter** avec des emplacements clairement marqués `[À COMPLÉTER : …]`, sauf si l'utilisateur a fourni le texte.

### 7.3 Règle sur les données de terrain

Voir §17. Si `approche` ≠ `documentaire` et qu'aucune donnée de terrain n'est fournie, l'étape 7 DOIT afficher un avertissement bloquant à confirmer : le chapitre résultats sera remplacé par des emplacements `[DONNÉES À INSÉRER]` et une trame d'analyse.

### 7.4 Pages ↔ mots

Conversion par défaut : 1 page ≈ 300 mots (Times 12, interligne 1,5, marges 2,5 cm). Ajustée selon le profil de normes. Les pages liminaires, la bibliographie et les annexes ne comptent pas dans la cible de corps de texte.

### 7.5 Répartition indicative des mots (mémoire standard)

| Bloc | Part du corps de texte |
|---|---|
| Introduction générale | 8–10 % |
| Partie théorique / revue de littérature | 25–30 % |
| Méthodologie | 12–15 % |
| Présentation et analyse des résultats | 25–30 % |
| Discussion et recommandations | 12–15 % |
| Conclusion générale | 5–7 % |

L'orchestrateur ajuste selon le type de travail (§15.3).

### 7.6 Configuration d'exécution (`config_json`) et valeurs par défaut

```ts
type ExecConfig = {
  models: Record<AgentRole, string>;        // id OpenRouter par rôle
  fallbackModels: Record<AgentRole, string[]>;
  budgetMaxUsd: number;
  parallelism: number;                      // défaut 3, min 1, max 8
  research: {
    profondeur: 'rapide' | 'normale' | 'approfondie';   // défaut 'normale'
    minSourcesTotal: number;                // défaut : licence 25, master 40, thèse 80
    minSourcesParSection: number;           // défaut 3
    partMinSourcesRecentes: number;         // défaut 0.5 (moins de 10 ans)
    prioriteAfrique: boolean;               // défaut true
    sourcesWebAutorisees: boolean;          // défaut true (sites institutionnels)
  };
  jury: {
    seuilSection: number;                   // défaut 14/20
    seuilChapitre: number;                  // défaut 14/20
    seuilGlobal: number;                    // défaut : standard 14, élevé 15, très élevé 16
    rondesMaxParChapitre: number;           // défaut 3 (min 1, max 6)
    rondesMaxGlobales: number;              // défaut 2 (min 0, max 4)
    gainMinimalParRonde: number;            // défaut 0.5 point
    nbJures: number;                        // défaut 3 (min 2, max 5)
  };
  verification: {
    exigerDoiOuIsbnOuUrl: boolean;          // défaut true
    tauxAncrageMin: number;                 // défaut 0.95
  };
  redaction: {
    tolerancelongueur: number;              // défaut 0.10 (±10 %)
    registre: 'academique_standard' | 'academique_soutenu';
  };
  keepAwake: boolean;                       // défaut true
  journalDetaille: boolean;                 // défaut false
};
```

**Justification des valeurs de révision proposées :**
- **3 rondes par chapitre** : en pratique, la première révision corrige l'essentiel, la deuxième affine, la troisième sert de filet de sécurité. Au-delà, le gain devient marginal et le coût grimpe.
- **2 rondes globales** : la vue d'ensemble (cohérence, transitions, fil conducteur) ne nécessite généralement qu'un ou deux passages.
- **Arrêt anticipé** si la note progresse de moins de 0,5 point entre deux rondes : le texte a atteint son plateau avec le modèle choisi ; continuer gaspille du crédit.
- **Seuil 14/20** (mention « Bien ») par défaut, relevable à 16 en exigence « très élevée ».
- Si une section n'atteint pas le seuil après le maximum de rondes, elle est **acceptée avec avertissement** (affiché dans le rapport final) plutôt que de bloquer la mission.

Tous ces paramètres sont modifiables à l'étape 6 et DOIVENT être affichés avec une infobulle expliquant leur effet sur la qualité, la durée et le coût.

---

## 8. Moteur d'orchestration

### 8.1 Machine à états de la mission

```
draft → briefing → planning → awaiting_plan_validation → running → completed
                         ↑              │                    │
                         └── (refus) ───┘                    ├→ paused (utilisateur)
                                                             ├→ paused_no_credit
                                                             ├→ paused_network
                                                             ├→ paused_budget
                                                             ├→ failed
                                                             └→ cancelled
```

Transitions autorisées codées explicitement (table de transitions). Toute transition est journalisée dans `events`.

### 8.2 File de tâches persistante

- Les tâches sont des lignes de la table `tasks` (§5.4). Il n'y a **aucune** file en mémoire seule.
- Une tâche passe `pending` → `ready` quand toutes ses dépendances sont `done`.
- Le **planificateur** (boucle toutes les 500 ms ou sur événement) prend jusqu'à `parallelism` tâches `ready`, par priorité puis ancienneté, pose un bail (`lease_until = now + 10 min`) et les exécute.
- Un battement (heartbeat) prolonge le bail des tâches longues.
- Au démarrage du moteur, les tâches `running` dont le bail a expiré repassent `ready` (attempts inchangé si l'interruption n'est pas due à la tâche elle-même).

### 8.3 Exécution d'une tâche

1. Charger l'entrée (`input_json`) et le contexte nécessaire depuis la DB (jamais depuis la mémoire d'une tâche précédente).
2. Construire le prompt de l'agent (§10) : prompt système + contexte de mission compact + entrée.
3. Appeler le modèle via le client LLM (§14) avec sortie JSON exigée.
4. Valider la sortie avec zod. En cas d'échec : 1 réessai avec le message d'erreur de validation renvoyé au modèle (« Ta réponse ne respecte pas le schéma : … Corrige. »). Puis échec de la tâche.
5. Exécuter les effets (écriture DB, création de sous-tâches) **dans une transaction SQLite**.
6. Marquer `done`, enregistrer coût et jetons, émettre les événements.
7. Créer un checkpoint si la tâche termine une étape clé (fin de section, fin de phase).

**Idempotence** : une tâche rejouée NE DOIT PAS dupliquer ses effets (vérifier l'existence avant insertion, clés naturelles uniques, ex. `(outline_node_id, version)`).

### 8.4 Gestion du contexte (fenêtre des modèles)

Les modèles ont des fenêtres limitées et une mission dépasse largement toute fenêtre. Règles :
- Chaque agent reçoit un **contexte de mission compact** (≤ 1 500 jetons) : titre, problématique, hypothèses, objectifs, plan résumé, règles de normes clés.
- Le reste vient de la **recherche dans la base de connaissances** (extraits pertinents) et des **résumés** :
  - Après validation de chaque section, un agent Résumeur produit un résumé de 150 à 250 mots stocké avec la section.
  - Le rédacteur d'une section reçoit : les résumés des sections précédentes du même chapitre, le résumé des chapitres précédents, les extraits de sources sélectionnés (≤ 12 000 jetons), les remarques du jury s'il s'agit d'une révision.
- Le client LLM DOIT connaître la longueur de contexte de chaque modèle (fournie par la liste de modèles OpenRouter) et réduire automatiquement les extraits si le prompt dépasse 70 % de la fenêtre.

### 8.5 Parallélisme

- Les recherches et rédactions de sections **indépendantes** s'exécutent en parallèle (dans la limite de `parallelism`).
- La rédaction d'une section dépend de la fin de sa recherche ; l'harmonisation d'un chapitre dépend de la validation de toutes ses sections.
- Réduire automatiquement le parallélisme à 1 en cas d'erreurs 429 (limite de débit) répétées, puis remonter progressivement.

### 8.6 Pause, reprise et interruptions

| Situation | Détection | Comportement |
|---|---|---|
| Pause utilisateur | Bouton | Plus de nouvelle tâche ; les tâches en cours terminent (ou sont interrompues après 60 s et remises `ready`). Statut `paused`. |
| Crédit épuisé | HTTP 402 d'OpenRouter **[À VÉRIFIER]** ou message de crédit insuffisant | Statut `paused_no_credit`, notification « Crédit OpenRouter épuisé. Rechargez votre compte puis cliquez sur Reprendre. » La tâche en cours repasse `ready` sans incrémenter `attempts`. Vérification automatique du crédit toutes les 15 min : reprise automatique si le crédit redevient suffisant (option activée par défaut). |
| Budget atteint | `cost_spent_usd ≥ budgetMaxUsd` | Statut `paused_budget`, proposition d'augmenter le budget ou de passer directement à la finalisation (P8–P9) avec l'état actuel. |
| Coupure réseau | Erreurs réseau répétées | Réessais avec délai exponentiel (2 s, 4 s, 8 s… plafonné à 5 min). Après 10 min sans réseau : `paused_network`, reprise automatique dès que le réseau revient (test toutes les 30 s). |
| Fermeture de l'app / PC éteint | Au redémarrage, missions `running` trouvées | Proposition « Reprendre la mission X ? » (ou reprise automatique si l'option est cochée). Les tâches orphelines repassent `ready`. |
| Crash du moteur | Le main détecte la sortie du utilityProcess | Redémarrage automatique (3 fois max en 10 min), reprise depuis la DB. |
| Modèle indisponible | 404 / 503 répétés sur un modèle | Bascule sur le modèle de secours du rôle (`fallbackModels`), événement d'avertissement. |
| Erreur fatale | Tâche critique échouée après `max_attempts` | Statut `failed` avec explication en français et bouton « Réessayer à partir de cette étape ». |

### 8.7 Annulation

Annuler arrête tout, conserve les données (consultables) et marque `cancelled`. Une mission annulée PEUT être dupliquée pour repartir de son état.

---

## 9. Les phases de la mission

Chaque phase a : objectif, agents impliqués, entrées, sorties, critères de sortie. Les phases P0 à P2 précèdent la validation du plan ; P3 à P9 sont autonomes.

### P0 — Préparation et ingestion

**Objectif** : rendre exploitables les fichiers de l'utilisateur.
**Agents** : aucun LLM obligatoire (traitement local) ; Analyste de documents pour classifier si nécessaire.
**Étapes** :
1. Extraction de texte de chaque fichier (PDF, DOCX, TXT). Détection des PDF scannés (peu ou pas de texte) → OCR si activé, sinon avertissement.
2. Extraction des métadonnées (titre, auteurs, année) depuis le PDF ; sinon, l'Analyste de documents les déduit de la première page.
3. Découpage en extraits (§11.5), embeddings, indexation FTS5 + vectorielle.
4. Données de terrain : lecture des tableurs, détection des colonnes, types, valeurs manquantes ; génération d'un **profil de données** (nombre de répondants, variables, modalités).
5. Guide de l'établissement : extraction des règles (structure, longueur, normes) par l'Analyste de documents → proposées comme surcharge du profil de normes.
6. Gabarit Word : extraction des styles (polices, titres, marges) pour l'export.
**Sortie** : fichiers parsés, KB initiale, profil de données, règles d'établissement.
**Critère de sortie** : tous les fichiers traités ou marqués en erreur avec raison.

### P1 — Cadrage

**Objectif** : consolider le brief.
**Agent** : Orchestrateur (en mode « cadrage »).
**Étapes** :
1. Vérifier la cohérence : problématique ↔ objectifs ↔ hypothèses ↔ méthodologie ↔ données disponibles.
2. Si `problematiqueAProposer` : proposer 3 formulations avec justification (l'utilisateur choisira à l'écran de validation).
3. Lister les concepts clés à définir, les théories et modèles probablement mobilisables, les angles géographiques (Afrique, pays du terrain).
4. Produire un **plan de recherche** : liste de requêtes par concept, en français et en anglais (les requêtes de recherche PEUVENT être en anglais car une grande partie de la littérature l'est ; la rédaction reste en français).
**Sortie** : `cadrage_json` (incohérences signalées, concepts, requêtes).

### P2 — Recherche exploratoire et proposition de plan

**Objectif** : proposer un plan réaliste, fondé sur la littérature disponible.
**Agents** : Chercheurs (exploratoire), Vérificateur (rapide), Architecte du plan.
**Étapes** :
1. Recherche exploratoire limitée (≈ 30 à 60 sources candidates, métadonnées + résumés seulement).
2. Vérification rapide (existence des DOI).
3. L'Architecte du plan produit le plan détaillé selon la structure choisie (§15.3) : pour chaque nœud, titre, objectif, questions clés, mots cibles, sources pressenties.
4. Calcul de l'estimation de coût affinée (§14.5).
**Sortie** : plan proposé → statut `awaiting_plan_validation`, notification.
**Boucle** : si l'utilisateur demande une nouvelle version avec commentaire, l'Architecte régénère (max conseillé 5 itérations, sans limite stricte).

### P3 — Recherche approfondie

**Objectif** : constituer une base de connaissances solide par section.
**Agents** : Chercheurs (un par chapitre, en parallèle), Analyste de documents, Vérificateur.
**Étapes par section** :
1. Générer les requêtes à partir de l'objectif et des questions clés de la section.
2. Interroger les connecteurs (§11.2), dédupliquer (DOI, puis titre normalisé + année).
3. Tri par pertinence (score d'embedding entre résumé et objectif de la section + évaluation LLM sur les 30 meilleurs candidats) et qualité (§11.4).
4. Récupérer le texte intégral en accès ouvert quand il existe (Unpaywall, liens PDF d'OpenAlex/CORE/HAL/arXiv) ; sinon, garder le résumé (`abstract_only`).
5. Ingestion (découpage, embeddings).
6. Vérification complète des sources retenues (§12.1).
7. **Fiches de lecture** : l'Analyste de documents produit pour chaque source retenue une fiche (thèse principale, méthode, résultats clés, citations exploitables avec page, limites, pertinence pour la section).
8. Contrôle de couverture : chaque section a-t-elle au moins `minSourcesParSection` sources vérifiées ? Sinon, nouvelles requêtes élargies (synonymes, termes anglais, concepts voisins), jusqu'à 3 itérations, puis avertissement.
**Sortie** : KB enrichie, fiches de lecture, matrice section ↔ sources.

### P4 — Analyse des données de terrain (si fournies)

**Objectif** : produire des résultats exacts à partir des données de l'utilisateur.
**Agent** : Analyste de données.
**Règles impératives** :
- Tous les calculs (effectifs, pourcentages, moyennes, écarts-types, tableaux croisés, tests du khi-deux, corrélations simples) DOIVENT être faits **par du code** (module statistique TypeScript, ex. `simple-statistics` / `jstat`), jamais estimés par le LLM.
- Le LLM choisit les analyses pertinentes au vu des hypothèses et du profil de données (sortie : liste d'analyses à exécuter au format JSON), puis interprète les résultats calculés.
- Chaque tableau et figure est numéroté, titré, sourcé (« Source : enquête de terrain, [mois année] ») et stocké.
- Données qualitatives (entretiens) : codage thématique assisté (thèmes, sous-thèmes, verbatims **exacts** tirés des transcriptions, avec identifiant anonymisé de l'enquêté).
**Sortie** : résultats structurés, tableaux, figures, verbatims, tests d'hypothèses (confirmée / infirmée / nuancée) avec les chiffres.

### P5 — Rédaction

**Objectif** : rédiger chaque section.
**Agents** : Rédacteurs de section (parallèles), Vérificateur d'ancrage.
**Ordre** : corps de texte d'abord (parties théorique, méthodologique, résultats, discussion), puis **introduction générale et conclusion générale en dernier**, puis pages liminaires (résumé, abstract, sigles…).
**Étapes par section** :
1. Assembler le contexte (§8.4) : contexte de mission, résumés précédents, fiches de lecture et extraits des sources de la section (recherche hybride), résultats de P4 si pertinent.
2. Le Rédacteur produit la section en Markdown enrichi avec des **marqueurs de citation** : `[@source_id, p. 12]` et, pour chaque affirmation sourcée, la référence de l'extrait utilisé dans une liste annexe JSON (`claims`).
3. Contraintes de rédaction (rappelées dans le prompt) :
   - français académique, impersonnel ou « nous » de modestie selon le profil ;
   - paraphrase obligatoire ; citations directes courtes (≤ 40 mots), entre guillemets, avec page ;
   - toute affirmation factuelle non triviale doit être sourcée ;
   - définir les concepts à leur première occurrence ;
   - transitions entre sous-sections ;
   - respecter ±10 % des mots cibles ;
   - contextualisation africaine / locale quand c'est pertinent et soutenu par des sources.
4. Le Vérificateur d'ancrage contrôle chaque affirmation (§12.2). Les affirmations non soutenues sont renvoyées au Rédacteur (correction ciblée, 2 tentatives), puis supprimées ou reformulées prudemment.
5. Contrôle anti-plagiat interne (§12.4).
6. Le Résumeur produit le résumé de la section.
**Sortie** : version 1 de chaque section, ancrages, résumés.

### P6 — Évaluation par le jury et révisions (par chapitre)

**Objectif** : atteindre le niveau d'exigence.
**Agents** : Jurés (§10), Président du jury, Rédacteurs (révision).
Détail complet en §13. Les chapitres sont évalués dès qu'ils sont complets (pas besoin d'attendre la fin de toute la rédaction), ce qui permet le parallélisme.

### P7 — Harmonisation et évaluation globale

**Objectif** : cohérence d'ensemble.
**Agents** : Harmonisateur, Jury (scope global), Rédacteurs.
**Étapes** :
1. L'Harmonisateur vérifie : fil conducteur problématique → conclusion, répétitions entre chapitres, transitions entre parties, cohérence terminologique, uniformité du style, annonces de plan, renvois internes.
2. Il produit une liste de modifications ciblées (pas de réécriture totale) appliquées section par section.
3. Le jury fait l'évaluation globale (grille complète §13.2), jusqu'à `rondesMaxGlobales`.
4. Rédaction ou mise à jour de l'introduction générale, de la conclusion générale, du résumé et de l'abstract à partir de la version finale.

### P8 — Mise en forme et bibliographie

**Agents** : Bibliographe, Metteur en page (code, LLM minimal).
**Étapes** :
1. Le Bibliographe convertit les marqueurs `[@id, p. x]` en citations conformes au profil (§15.2) via un moteur de styles CSL **[À VÉRIFIER : utiliser `citeproc-js` ou `citation-js` avec des fichiers .csl]**.
2. Bibliographie finale : uniquement les sources effectivement citées, triées selon la norme, regroupées par type si le profil l'exige (ouvrages, articles, mémoires et thèses, rapports, textes officiels, webographie).
3. Sigles et abréviations : extraction automatique + définitions.
4. Listes des tableaux et des figures.
5. Table des matières (champ TOC Word qui se met à jour à l'ouverture + version calculée pour le PDF).
6. Pages liminaires.
7. Annexes : questionnaire / guide d'entretien (si fournis), tableaux complémentaires.

### P9 — Livrables et rapport final

**Agents** : Concepteur de soutenance (diaporama + fiche de préparation), générateurs.
**Étapes** :
1. Générer le DOCX (§16.1), puis le PDF (§16.2).
2. Si demandé : diaporama (§16.3) et fiche de préparation à la soutenance : 20 à 30 questions probables du jury (issues des remarques du jury simulé et des faiblesses connues), avec éléments de réponse et renvois aux pages.
3. Rapport de mission (§16.4).
4. Contrôle final automatique (§16.5).
5. Statut `completed`, notification.

---

## 10. Les agents

### 10.1 Règles communes à tous les agents

- Chaque agent a : un **rôle**, un **prompt système** (fichier `prompt.md`, en français), un **schéma de sortie zod**, un **modèle** (configurable), une **température** par défaut, une liste d'**outils** autorisés.
- Sortie toujours en **JSON** conforme au schéma (utiliser le mode `response_format` JSON d'OpenRouter quand le modèle le supporte **[À VÉRIFIER : support des structured outputs selon le modèle]** ; sinon, consigne stricte + extraction du premier bloc JSON + validation).
- Les textes rédigés sont dans un champ `markdown` du JSON.
- Chaque prompt système contient un bloc commun « Règles d'intégrité » : ne jamais inventer de source, de chiffre, de citation, de donnée ; signaler explicitement toute information manquante dans un champ `manques`.
- Les prompts sont versionnés (`prompt_version` stockée avec chaque appel) pour faciliter l'amélioration.

### 10.2 Liste des rôles

| Rôle (`AgentRole`) | Mission | Profil de modèle conseillé | Temp. |
|---|---|---|---|
| `orchestrator` | Cadrage, décisions, création de tâches, arbitrages | Raisonnement fort | 0.3 |
| `outline_architect` | Proposition et révision du plan | Raisonnement fort | 0.4 |
| `researcher` | Génération de requêtes, tri des résultats | Rapide, économique | 0.2 |
| `document_analyst` | Fiches de lecture, extraction de règles, métadonnées | Bon en lecture longue, contexte large | 0.2 |
| `source_verifier` | Vérification sémantique des correspondances métadonnées (le reste est du code) | Économique | 0.0 |
| `data_analyst` | Choix des analyses, interprétation des résultats calculés, codage qualitatif | Raisonnement fort | 0.2 |
| `section_writer` | Rédaction et révision des sections | Meilleur rédacteur en français | 0.6 |
| `grounding_checker` | Vérifie que chaque affirmation est soutenue par l'extrait cité | Précis, économique | 0.0 |
| `summarizer` | Résumés de sections et chapitres | Économique | 0.2 |
| `juror_methodologist` | Juré : rigueur méthodologique | Raisonnement fort, **fournisseur différent du rédacteur** | 0.3 |
| `juror_specialist` | Juré : maîtrise du domaine et de la littérature | Raisonnement fort | 0.3 |
| `juror_form` | Juré : forme, langue, normes, structure | Bon en français | 0.2 |
| `jury_president` | Synthèse des jurés, verdict, plan de révision priorisé | Raisonnement fort | 0.2 |
| `harmonizer` | Cohérence globale | Contexte large | 0.3 |
| `bibliographer` | Complétion des notices CSL incomplètes, classement | Économique | 0.0 |
| `defense_designer` | Diaporama + fiche de préparation à la soutenance | Bon en synthèse | 0.4 |

**Recommandation importante** : les jurés DEVRAIENT utiliser un modèle d'une autre famille que le rédacteur, pour éviter qu'un modèle évalue trop favorablement son propre style. L'interface l'indique par une suggestion lors du choix des modèles.

### 10.3 Fiches détaillées (prompts système — squelettes)

Les squelettes ci-dessous DOIVENT être développés dans `packages/engine/src/agents/<role>/prompt.md`. Les variables entre `{{ }}` sont injectées par le code.

#### 10.3.1 Orchestrateur (mode cadrage, P1)

```
Tu es le directeur de recherche d'une équipe d'agents chargée de produire un {{type_travail}}
en {{discipline}}, en français, aux normes académiques de l'Afrique francophone.

Brief de l'utilisateur :
{{brief_compact}}

Ta tâche :
1. Vérifie la cohérence entre problématique, questions, objectifs, hypothèses, méthodologie
   et données disponibles ({{profil_donnees}}). Liste chaque incohérence avec une correction proposée.
2. Si la problématique est absente ou faible, propose 3 formulations (question centrale claire,
   délimitée dans l'espace et le temps), avec une justification de 2 phrases chacune.
3. Liste les concepts clés à définir et les cadres théoriques probablement mobilisables.
   Ne cite aucun auteur que tu n'es pas certain d'exister : propose plutôt des pistes de recherche.
4. Produis un plan de recherche : pour chaque concept, 3 à 6 requêtes en français et 3 à 6 en anglais.

Règles d'intégrité : {{regles_integrite}}

Réponds uniquement en JSON conforme au schéma : {{schema}}
```

Schéma de sortie (zod) : `{ incoherences: {element, probleme, proposition}[], problematiques: {formulation, justification}[], concepts: {nom, a_definir: boolean}[], cadres_theoriques_pistes: string[], requetes: {concept, fr: string[], en: string[]}[], manques: string[] }`

#### 10.3.2 Architecte du plan (P2)

Entrées : brief consolidé, structure-type (§15.3), sources exploratoires (titres + résumés), répartition des mots, règles de l'établissement.
Consignes clés :
- respecter la structure imposée si elle existe ;
- plan progressif, logique, équilibré (pas de section < 400 mots sauf liminaires) ;
- titres académiques explicites (pas de titres vagues) ;
- chaque section : objectif (1 phrase), 2 à 4 questions clés, mots cibles, sources pressenties (ids des sources exploratoires), justification ;
- annonce de la méthode de vérification des hypothèses.
Sortie : arbre `OutlineNode[]` + `justification_globale` + `risques` (ex. « peu de littérature sur le Bénin pour ce sujet »).

#### 10.3.3 Chercheur (P2, P3)

Deux sous-tâches distinctes :
- `generate_queries` : à partir de l'objectif d'une section → requêtes FR/EN, filtres (années, types).
- `rank_candidates` : à partir de 30 candidats (titre, résumé, année, revue) → score de pertinence 0–10 justifié, décision garder / écarter.
Le Chercheur n'appelle pas lui-même les API : le **code** exécute les requêtes via les connecteurs ; le LLM ne sert qu'à générer et trier.

#### 10.3.4 Analyste de documents (P0, P3)

Sous-tâches :
- `reading_note` : fiche de lecture d'une source à partir de ses extraits. Les citations exploitables DOIVENT être recopiées **à l'identique** depuis les extraits fournis, avec numéro de page si disponible. Le code vérifie ensuite que chaque citation existe littéralement dans le texte source (sinon elle est supprimée).
- `extract_guidelines` : règles du guide de l'établissement → JSON de surcharge du profil de normes.
- `extract_metadata` : métadonnées bibliographiques d'un PDF utilisateur à partir des 2 premières pages.

#### 10.3.5 Vérificateur de sources (P2, P3)

Majoritairement du **code** (§12.1). Le LLM intervient seulement pour juger si deux notices (celle annoncée et celle retrouvée via l'API) désignent bien le même document lorsque la correspondance automatique est ambiguë.

#### 10.3.6 Analyste de données (P4)

Sous-tâches :
- `plan_analyses` : à partir du profil de données, des hypothèses et des questions → liste d'analyses (type, variables, test) en JSON exécutable par le module statistique.
- `interpret_results` : à partir des résultats **calculés par le code** → interprétation rédigée, statut de chaque hypothèse. Interdiction de modifier ou d'arrondir différemment les chiffres fournis.
- `qualitative_coding` : à partir des transcriptions → grille de thèmes, verbatims exacts (vérifiés par le code comme pour les fiches de lecture).

#### 10.3.7 Rédacteur de section (P5, P6, P7)

```
Tu es un rédacteur académique expert en {{discipline}}. Tu rédiges en français la section
« {{numerotation}} {{titre_section}} » d'un {{type_travail}} intitulé « {{titre}} ».

Problématique : {{problematique}}
Objectif de cette section : {{objectif}}
Questions à traiter : {{questions_cles}}
Longueur visée : {{mots_cibles}} mots (±10 %)
Place dans le document : {{resume_contexte_precedent}}
Section suivante prévue : {{titre_section_suivante}}

Sources disponibles (fiches et extraits, chacun avec son identifiant) :
{{extraits}}

{{#if resultats}}Résultats de terrain calculés (à utiliser tels quels) : {{resultats}}{{/if}}
{{#if revision}}Remarques du jury à traiter impérativement : {{remarques_jury}}
Version précédente : {{version_precedente}}{{/if}}

Règles :
- Style : {{registre}}, {{personne}} ; phrases claires ; paragraphes de 4 à 8 phrases.
- Chaque affirmation factuelle, chiffre, définition ou idée d'auteur porte un marqueur
  [@ID_SOURCE] ou [@ID_SOURCE, p. N]. N'utilise QUE les identifiants fournis ci-dessus.
- Paraphrase. Citation directe seulement si essentielle, ≤ 40 mots, entre guillemets « »,
  recopiée exactement depuis l'extrait, avec la page.
- N'invente aucune source, aucun chiffre, aucune citation. S'il manque une information
  nécessaire, écris [INFORMATION MANQUANTE : …] et signale-le dans "manques".
- Termine par une transition vers la section suivante si pertinent.
- Typographie française : espaces insécables avant ; : ! ?, guillemets « », nombres 12 500.

Réponds en JSON : {{schema}}
```

Schéma : `{ markdown: string, claims: {phrase: string, source_id: string, chunk_id: string, page?: string}[], mots: number, manques: string[], notes_pour_jury?: string }`

#### 10.3.8 Vérificateur d'ancrage (P5, P6)

Pour chaque `claim` : reçoit la phrase et l'extrait cité → `supported` / `partially` / `unsupported` + justification courte. Traité par lots de 10 à 20 claims par appel pour limiter le coût.

#### 10.3.9 Jurés (P6, P7)

Prompt commun + spécialisation :
- **Méthodologiste** : cohérence problématique-hypothèses-méthode, validité de l'échantillonnage, justesse des analyses, honnêteté sur les limites.
- **Spécialiste** : maîtrise des concepts, actualité et pertinence de la littérature, profondeur de l'analyse, apport, contextualisation africaine.
- **Forme** : structure, clarté, langue, orthographe, typographie, respect des normes de citation, équilibre des parties.

Consignes communes :
- tu es exigeant et juste, comme un vrai jury de soutenance dans une université d'Afrique francophone ;
- note avec la grille §13.2, chaque critère justifié ;
- chaque remarque est **actionnable** : localisation précise (section, paragraphe), problème, correction attendue, gravité (`majeure`, `mineure`, `suggestion`) ;
- ne fais pas de remarques vagues (« approfondir l'analyse ») sans dire quoi et comment ;
- n'exige pas de sources que tu ne peux pas nommer avec certitude ; propose plutôt des pistes de recherche.

Schéma : `{ scores: {critere_id, note, justification}[], total_sur_20: number, points_forts: string[], remarques: {id, localisation, probleme, correction_attendue, gravite, besoin_recherche: boolean, requete_suggeree?: string}[] }`

#### 10.3.10 Président du jury

Reçoit les évaluations des jurés → note consolidée (moyenne pondérée §13.3), verdict, **plan de révision priorisé** : remarques fusionnées, dédoublonnées, classées (majeures d'abord), avec pour chaque section concernée les actions à mener et si une recherche complémentaire est nécessaire.

#### 10.3.11 Harmonisateur (P7)

Reçoit les résumés de toutes les sections + le texte des introductions/conclusions de chapitres + les transitions → liste de modifications ciblées `{section_id, type: 'transition'|'repetition'|'terminologie'|'renvoi'|'fil_conducteur', avant?, apres, justification}`.

#### 10.3.12 Bibliographe (P8)

Complète les notices CSL incomplètes (via les API, pas via le LLM quand c'est possible), détecte les doublons, signale les sources citées sans notice exploitable.

#### 10.3.13 Concepteur de soutenance (P9)

Diaporama : plan en N diapositives (titre, 3 à 5 puces courtes, suggestion de visuel, notes de l'orateur). Fiche de préparation : questions probables + éléments de réponse + renvoi aux pages.

---

## 11. Recherche documentaire et base de connaissances

### 11.1 Architecture des connecteurs

Interface commune :
```ts
interface SourceConnector {
  id: string;                                 // 'openalex', ...
  label: string;
  enabled: boolean;
  search(q: SearchQuery): Promise<CandidateSource[]>;
  fetchById?(id: string): Promise<CandidateSource | null>;
  fetchFullText?(c: CandidateSource): Promise<FullText | null>;
  rateLimit: { requestsPerSecond: number };
}
```
- Chaque connecteur est isolé dans `packages/engine/src/sources/<id>/`.
- Cache disque des réponses (clé = requête normalisée) pour éviter les appels répétés.
- Limitation de débit par connecteur (file à jetons).
- Un connecteur en panne NE DOIT PAS bloquer la recherche : il est ignoré et un avertissement est journalisé.
- **Extensibilité** : un format de « connecteur déclaratif » (JSON décrivant l'URL, les paramètres et le mapping des champs) PEUT être ajouté en V1.1 pour intégrer des sources publiées sur GitHub (jeux de données, listes de revues africaines, archives ouvertes) sans recoder.

### 11.2 Connecteurs V1

| Connecteur | Usage | Notes **[À VÉRIFIER : endpoints, quotas, paramètres]** |
|---|---|---|
| **OpenAlex** | Recherche principale (articles, ouvrages, thèses), métadonnées, liens accès ouvert | API gratuite ; ajouter un e-mail de contact (« polite pool ») configurable dans les paramètres |
| **Semantic Scholar** | Recherche complémentaire, résumés, citations | Quota sans clé limité ; champ optionnel pour une clé gratuite |
| **Crossref** | Vérification des DOI, métadonnées de référence | Gratuit |
| **HAL** | Littérature francophone (thèses, mémoires, articles) | Très important pour le français |
| **Unpaywall** | Trouver la version en accès ouvert d'un DOI | E-mail requis en paramètre |
| **CORE** | Textes intégraux en accès ouvert | Clé gratuite optionnelle |
| **arXiv** | Sciences exactes, informatique, économie | |
| **DOAJ** | Revues en accès ouvert | |
| **PubMed / Europe PMC** | Santé publique, médecine | |
| **Recherche web institutionnelle** | Textes officiels, rapports (BM, BAD, OMS, PNUD, UEMOA, CEDEAO, instituts nationaux de statistique) | **[À VÉRIFIER]** : choisir une API de recherche web (clé optionnelle fournie par l'utilisateur) ou une liste de sites institutionnels interrogés directement. Désactivable. |

Sources africaines à explorer pour connecteurs dédiés (V1.1) **[À VÉRIFIER : disponibilité d'API ou d'OAI-PMH]** : African Journals Online (AJOL), revues et archives du CAMES, dépôts institutionnels d'universités africaines (souvent OAI-PMH), CODESRIA.

### 11.3 Déduplication

1. Même DOI (normalisé en minuscules) → doublon.
2. Sinon, titre normalisé (minuscules, sans accents ni ponctuation) + année identique → doublon probable ; fusionner en gardant la notice la plus complète.

### 11.4 Score de qualité (0–1)

Combinaison pondérée (pondérations dans un fichier de config) :
- type de document (article de revue à comité de lecture, ouvrage académique, thèse > rapport institutionnel > site web) ;
- présence de DOI / ISBN ;
- récence (selon `partMinSourcesRecentes`) ;
- nombre de citations (normalisé par l'âge, si disponible) ;
- disponibilité du texte intégral ;
- bonus `prioriteAfrique` si le terrain ou l'affiliation concerne l'Afrique ;
- source importée par l'utilisateur : bonus fort (l'utilisateur la juge importante).

### 11.5 Découpage et indexation

- Découpage par paragraphes, regroupés en extraits de 300 à 800 mots, chevauchement de 1 paragraphe.
- Conserver les numéros de page (indispensable pour les citations).
- Ignorer les en-têtes et pieds de page répétés, les bibliographies des sources (marquer `is_bibliography` et exclure de la recherche).
- Embeddings locaux sur chaque extrait ; préfixes « query: » / « passage: » si le modèle le requiert **[À VÉRIFIER]**.
- Recherche **hybride** : score final = 0,6 × similarité vectorielle + 0,4 × BM25 (FTS5), puis reclassement LLM optionnel des 20 premiers pour les sections exigeantes.

---

## 12. Vérification et intégrité scientifique

### 12.1 Vérification des sources (code d'abord)

Pour chaque source candidate retenue :
1. **DOI présent** → requête Crossref (et/ou OpenAlex). Comparer titre (similarité ≥ 0,85 après normalisation), année (±1), premier auteur. Si OK → `verified`.
2. **ISBN** → vérification via une API de livres ouverte **[À VÉRIFIER : Open Library ou équivalent]**.
3. **URL seule** → la page doit répondre (HTTP 200) et contenir le titre (ou ses mots principaux).
4. **PDF importé par l'utilisateur** → `verified` par définition (le document existe), métadonnées à confirmer.
5. Correspondance ambiguë → arbitrage par le LLM `source_verifier`.
6. Échec → `rejected` (jamais citée) ; journaliser la raison.
Preuves stockées dans `verification_json` (réponse API, scores de correspondance, date).

**Règle absolue** : le Rédacteur ne peut citer que des `source_id` existant en base avec `verification_status = verified` ou `partially_verified`. Le code DOIT rejeter tout marqueur `[@id]` inconnu ou non vérifié.

### 12.2 Ancrage des affirmations

1. Après chaque version de section, extraire les `claims`.
2. Vérifier par le code que le `chunk_id` appartient bien à la `source_id` citée.
3. Le `grounding_checker` évalue le soutien.
4. Calcul du **taux d'ancrage** = supported / total. Si < `tauxAncrageMin` (0,95) → correction ciblée par le Rédacteur des phrases `unsupported` / `partially`.
5. Les citations directes entre guillemets DOIVENT être retrouvées littéralement (tolérance : espaces, apostrophes typographiques) dans le texte de l'extrait. Sinon, conversion en paraphrase ou suppression.

### 12.3 Chiffres

Tout nombre présent dans le texte doit provenir : d'un extrait de source cité dans la même phrase, ou des résultats de P4. Un contrôle automatique extrait les nombres de chaque section et vérifie leur présence dans les extraits ou résultats associés ; les nombres orphelins sont signalés au Rédacteur.

### 12.4 Contrôle de similarité interne

Pour éviter de recopier les sources : comparaison par n-grammes (n = 8 mots) entre chaque section et les extraits de ses sources. Tout passage de ≥ 8 mots identiques hors citation entre guillemets est renvoyé en reformulation. Objectif : 0 passage non cité recopié.

---

## 13. Jury simulé et boucle de révision

### 13.1 Composition

Par défaut 3 jurés (méthodologiste, spécialiste, forme) + 1 président. Paramétrable de 2 à 5 jurés (rôles supplémentaires possibles : « praticien du terrain » pour les rapports professionnels, « second spécialiste »).

### 13.2 Grille d'évaluation (sur 20)

| Id | Critère | Points | Évalué par |
|---|---|---|---|
| C1 | Pertinence et clarté de la problématique, cohérence avec les objectifs et hypothèses | 3 | Méthodologiste |
| C2 | Qualité, actualité et pertinence de la revue de littérature | 3 | Spécialiste |
| C3 | Maîtrise des concepts et du cadre théorique | 2 | Spécialiste |
| C4 | Rigueur méthodologique (méthode adaptée, justifiée, limites assumées) | 3 | Méthodologiste |
| C5 | Qualité de l'analyse et de l'interprétation des résultats | 3 | Méthodologiste + Spécialiste |
| C6 | Discussion, apport, recommandations, contextualisation | 2 | Spécialiste |
| C7 | Structure, logique, enchaînements | 2 | Forme |
| C8 | Langue, style, orthographe, typographie | 1 | Forme |
| C9 | Respect des normes (citations, bibliographie, mise en page) | 1 | Forme |
| **Total** | | **20** | |

Pour une section isolée, seuls les critères applicables sont notés et ramenés sur 20. La grille de l'établissement, si l'utilisateur l'a fournie, **remplace** cette grille (l'Analyste de documents la convertit au même format).

### 13.3 Consolidation

- Note par critère = moyenne des jurés qui l'évaluent.
- Écart > 4 points entre jurés sur la note totale → le président demande une justification croisée (1 appel) avant de trancher.
- Verdicts :
  - ≥ seuil → `valide` ;
  - ≥ seuil − 3 → `a_reviser` (corrections ciblées) ;
  - < seuil − 3 → `a_reecrire` (réécriture de la section avec le plan de révision).

### 13.4 Algorithme de révision (par chapitre)

```
ronde = 0
evaluer(chapitre)
tant que note < seuilChapitre ET ronde < rondesMaxParChapitre :
    ronde += 1
    plan = president.plan_de_revision(evaluations)
    pour chaque remarque avec besoin_recherche :
        lancer recherche complémentaire ciblée (P3 réduit)
    pour chaque section concernée (en parallèle) :
        reviser(section, remarques)     # nouvelle version, ancrage revérifié
    nouvelle_note = evaluer(chapitre)
    si nouvelle_note - note < gainMinimalParRonde :
        journaliser("plateau atteint") ; sortir
    note = nouvelle_note
si note < seuilChapitre :
    marquer chapitre "accepté avec réserves" + raisons dans le rapport final
```

- Une révision NE DOIT PAS dégrader les parties validées : le Rédacteur reçoit l'instruction de ne modifier que ce qui est visé par les remarques, et le code compare les versions (si la nouvelle note est inférieure à l'ancienne, conserver l'ancienne version et journaliser).
- Toutes les versions sont conservées (§5.9).

### 13.5 Évaluation globale (P7)

Même algorithme au niveau du document entier avec `rondesMaxGlobales` et `seuilGlobal`. Les jurés reçoivent : résumés de toutes les sections, introduction et conclusion générales complètes, échantillon de sections (les 3 moins bien notées + 2 au hasard), statistiques (sources, ancrage, équilibre des parties).

---

## 14. Intégration OpenRouter

### 14.1 Client LLM

- Base : API compatible OpenAI d'OpenRouter, `POST https://openrouter.ai/api/v1/chat/completions` **[À VÉRIFIER : en-têtes recommandés `HTTP-Referer` et `X-Title` pour identifier l'app]**.
- Fonctionnalités :
  - délai max par appel (configurable, défaut 180 s) ;
  - réessais avec backoff exponentiel + aléa sur 429, 5xx, erreurs réseau (max 5) ;
  - **pas** de réessai sur 400 (requête invalide) ni 401 (clé invalide → pause + alerte) ;
  - 402 / crédit insuffisant → pause `paused_no_credit` (§8.6) ;
  - streaming non nécessaire pour le moteur (désactivé), sauf pour l'aperçu en direct optionnel d'une rédaction ;
  - comptage des jetons et du coût : utiliser les informations d'usage renvoyées par OpenRouter **[À VÉRIFIER : champ `usage` et/ou endpoint de génération pour le coût exact]** ; à défaut, calcul via la grille de prix du modèle.
- Toutes les requêtes passent par une seule fonction `callModel(role, messages, options)` qui gère modèle, secours, journal, coût et budget.

### 14.2 Liste des modèles

- Récupérer la liste via `GET /api/v1/models` **[À VÉRIFIER]** : identifiant, nom, longueur de contexte, prix entrée/sortie, support des sorties structurées.
- Mettre en cache 24 h.
- Écran de choix : recherche, filtre par prix et contexte, badge « recommandé pour ce rôle ».

### 14.3 Préréglages

Les préréglages sont définis dans un fichier JSON **mis à jour facilement** (les modèles évoluent vite). Ils associent chaque rôle à un modèle selon trois niveaux :
- **Économique** : modèles bon marché pour tous les rôles, sauf rédacteur et président (gamme moyenne).
- **Équilibré** (défaut) : modèles haut de gamme pour orchestrateur, rédacteur, jurés, président ; économiques pour recherche, ancrage, résumés.
- **Excellence** : meilleurs modèles disponibles pour les rôles de raisonnement et de rédaction.
**[À VÉRIFIER : choisir les identifiants de modèles au moment du développement ; ne pas les coder en dur dans le code source.]** Un préréglage dont un modèle n'existe plus est signalé et l'utilisateur est invité à le remplacer.

### 14.4 Budget

- Avant chaque appel : si `cost_spent + coût_estimé_de_l'appel > budgetMaxUsd` → pause `paused_budget`.
- Alerte à 50 %, 80 % et 95 % du budget (événement + notification à 80 %).

### 14.5 Estimation du coût et de la durée

Modèle d'estimation (dans `packages/engine/src/llm/estimate.ts`) :
1. Calculer le nombre de sections N et les mots cibles M.
2. Estimer les jetons par phase avec des coefficients (fichier de config, à calibrer après les premiers tests réels) :
   - recherche : par section, ~ X appels de tri × jetons moyens ;
   - fiches de lecture : nombre de sources × jetons d'extraits ;
   - rédaction : M × 1,3 jetons/mot × (1 + facteur de contexte) ;
   - ancrage : nombre de claims estimé ;
   - jury : jurés × rondes moyennes attendues × taille des chapitres ;
   - révision : proportion attendue de sections révisées.
3. Multiplier par les prix des modèles choisis.
4. Afficher trois scénarios : **bas** (1 ronde en moyenne), **moyen** (2 rondes), **haut** (rondes max partout).
5. Durée : basée sur les jetons de sortie et une vitesse moyenne par modèle (mise à jour avec les vitesses réelles mesurées au fil des missions), divisée par le parallélisme effectif.
6. Après chaque phase, recalcul avec les coûts réels → « coût restant projeté ».

### 14.6 Clé API

- Stockée chiffrée avec `safeStorage` ; jamais écrite dans les journaux (masquage `sk-or-…xxxx`).
- Jamais transmise au renderer après la saisie (le renderer ne voit que la version masquée).
- Bouton « Supprimer la clé ».

---

## 15. Normes et mise en forme

### 15.1 Structure d'un profil de normes (`profile_json`)

```ts
type NormsProfile = {
  id: string; name: string; description: string;
  citation: {
    cslStyle: string;                 // fichier .csl embarqué
    mode: 'auteur_date' | 'notes';
    ibidem: boolean;                  // usage de ibid./op. cit. en mode notes
  };
  bibliography: {
    groupByType: boolean;
    groupsOrder?: string[];           // ex. ['ouvrages','articles','theses_memoires','rapports','textes_officiels','webographie']
    title: string;                    // 'Bibliographie' | 'Références bibliographiques'
  };
  layout: {
    paper: 'A4';
    margins: { top: number; bottom: number; left: number; right: number }; // cm
    font: string; fontSize: number; lineSpacing: number;
    paragraphIndent: number; justify: boolean;
    headingNumbering: 'decimal' | 'romain_alphabetique';  // 1.1.1 ou I. A. 1.
    pageNumbering: { liminaires: 'romain'; corps: 'arabe' };
    footnotesFontSize: number;
  };
  writing: { personne: 'nous' | 'impersonnel'; };
  structureTemplateId: string;        // §15.3
};
```

### 15.2 Profils fournis par défaut

1. **Afrique francophone — Standard universitaire** (défaut) : Times New Roman 12, interligne 1,5, marges 2,5 cm (gauche 3 cm pour la reliure), justifié, numérotation décimale, citations auteur-date, bibliographie regroupée par type. **[À VÉRIFIER : ces valeurs sont des usages courants ; elles ne correspondent pas à une norme officielle unique. Le préciser dans l'interface : « à ajuster selon le guide de votre établissement ».]**
2. **APA 7e édition (français)**.
3. **ISO 690 (auteur-date)**.
4. **ISO 690 (numérique / notes)**.
5. **Notes de bas de page — style juridique / sciences humaines** (ibid., op. cit.).
6. **Vancouver** (santé).
7. **Personnalisé** (copie modifiable d'un profil existant).

L'interface DOIT permettre de dupliquer et modifier un profil, et d'appliquer les surcharges extraites du guide de l'établissement (P0).

### 15.3 Structures-types (gabarits de plan)

**Mémoire de licence / master (recherche) — standard Afrique francophone**
- Pages liminaires : page de garde, avertissement (optionnel), dédicace, remerciements, sigles et abréviations, liste des tableaux, liste des figures, sommaire, résumé / abstract.
- Introduction générale : contexte et justification, problématique, questions de recherche, objectifs, hypothèses, intérêt de l'étude, annonce du plan.
- Première partie — Cadre théorique et méthodologique
  - Chapitre 1 : Clarification conceptuelle et revue de littérature
  - Chapitre 2 : Cadre théorique / modèle d'analyse et démarche méthodologique (type d'étude, population, échantillonnage, outils de collecte, méthodes d'analyse, difficultés et limites)
- Deuxième partie — Cadre empirique / pratique
  - Chapitre 3 : Présentation du milieu d'étude et des résultats
  - Chapitre 4 : Analyse, discussion des résultats, vérification des hypothèses et recommandations
- Conclusion générale : rappel de la problématique, synthèse des résultats, vérification des hypothèses, limites, perspectives.
- Bibliographie, annexes, table des matières.

**Rapport de stage**
Introduction ; Partie 1 : présentation de la structure d'accueil (historique, missions, organisation, organigramme) ; Partie 2 : déroulement du stage (tâches réalisées, compétences acquises) ; Partie 3 : analyse critique d'une problématique observée et suggestions ; conclusion ; bibliographie ; annexes.

**Rapport de fin de formation professionnelle / Projet professionnel**
Introduction ; diagnostic de la situation ; problématique professionnelle ; cadre de référence ; démarche ; plan d'action / solution proposée (objectifs, activités, ressources, chronogramme, budget si fourni, indicateurs de suivi) ; résultats attendus ou obtenus ; conclusion.

**Thèse (chapitres)** : l'utilisateur choisit les chapitres à produire ; structure IMRaD par chapitre empirique ou structure libre.

**Article scientifique** : IMRaD (Introduction, Méthodes, Résultats, Discussion), résumé structuré, mots-clés.

**Revue de littérature** : introduction, méthode de recherche documentaire (bases interrogées, mots-clés, critères d'inclusion/exclusion, nombre de documents retenus — **valeurs réelles issues du journal de la mission**), synthèse thématique, discussion, pistes de recherche, conclusion.

Les gabarits sont des fichiers JSON dans `resources/norms/structures/`.

### 15.4 Langue

- Toute la rédaction en français.
- Exception : l'**abstract** (traduction anglaise du résumé) si la case est cochée. C'est la seule production en anglais.
- Typographie française appliquée automatiquement en post-traitement (code) : espaces insécables, guillemets « », apostrophes typographiques, siècles en petites capitales romaines si le profil le demande.

---

## 16. Livrables

### 16.1 DOCX

- Généré avec la librairie `docx`. Si l'utilisateur a fourni un gabarit Word, en reprendre les styles (sinon styles du profil).
- Styles Word nommés (Titre 1, 2, 3, Normal, Légende, Citation) → la table des matières Word fonctionne.
- Table des matières en champ TOC (mise à jour à l'ouverture, avec message d'invite) **[À VÉRIFIER : comportement de la mise à jour automatique selon les versions de Word]**.
- Notes de bas de page natives si le profil est en mode notes.
- Tableaux et figures avec légendes numérotées (« Tableau 3 : … », « Figure 2 : … ») et source sous chaque élément.
- Numérotation des pages : romaine pour les liminaires, arabe à partir de l'introduction (sections Word distinctes).
- Sauts de page avant chaque partie et chapitre.
- Page de garde selon les informations du brief (logo inclus si fourni).
- Les emplacements à compléter `[À COMPLÉTER : …]` et `[DONNÉES À INSÉRER]` sont surlignés en jaune.

### 16.2 PDF

- Rendu HTML paginé (CSS Paged Media basique) → `printToPDF`. Signets PDF depuis les titres si possible **[À VÉRIFIER]**.
- Alternative acceptable : conversion du DOCX via LibreOffice si présent sur la machine (détection) — non obligatoire.

### 16.3 Diaporama de soutenance (PPTX)

- `pptxgenjs`, gabarit sobre et professionnel (couleurs neutres, une couleur d'accent configurable).
- Structure par défaut (15 diapositives) : titre ; plan ; contexte ; problématique et questions ; objectifs et hypothèses ; cadre théorique ; méthodologie ; terrain ; résultats clés (2 à 3 diapositives avec les vrais tableaux / figures) ; discussion ; vérification des hypothèses ; recommandations ; limites et perspectives ; conclusion ; remerciements.
- Notes de l'orateur pour chaque diapositive (texte à dire, 1 à 2 minutes).
- Règle : maximum 5 puces par diapositive, 12 mots par puce.

### 16.4 Rapport de mission (PDF ou HTML)

- Paramètres utilisés, durée, coût total et par phase.
- Sources : nombre trouvées / vérifiées / rejetées / citées ; liste des sources rejetées avec raison.
- Notes du jury par chapitre et par ronde, évolution.
- Points d'attention : sections acceptées avec réserves, informations manquantes, emplacements à compléter.
- Méthodologie de recherche documentaire (bases interrogées, requêtes) — utile à l'étudiant pour la soutenance.

### 16.5 Contrôle final automatique (avant `completed`)

- Aucun marqueur `[@…]` non résolu.
- Toutes les sources citées sont dans la bibliographie, et inversement.
- Taux d'ancrage global ≥ seuil.
- Longueur totale dans la tolérance.
- Numérotation des tableaux et figures continue.
- Liste exhaustive des `[À COMPLÉTER]` restants, reprise dans le rapport.
- Le DOCX s'ouvre sans erreur (test de relecture du fichier généré).

---

## 17. Intégrité et charte d'utilisation

L'outil est présenté comme un **assistant de recherche et de rédaction académique**. Les garde-fous suivants sont des exigences, pas des options :

1. **Pas de données fabriquées** : aucune donnée d'enquête, aucun entretien, aucun chiffre de terrain n'est généré. Sans données, des emplacements explicites sont laissés.
2. **Pas de sources fabriquées** : vérification systématique (§12).
3. **Pas de citations fabriquées** : contrôle littéral (§12.2).
4. **Pages personnelles** (dédicace, remerciements) non inventées (§7.2).
5. **Charte affichée** à l'onboarding et sur l'écran de fin : l'utilisateur reste l'auteur responsable de son travail, doit le relire, se l'approprier, vérifier les sources clés et respecter les règles de son établissement concernant l'usage de l'IA (certaines exigent une déclaration d'usage).
6. **Modèle de déclaration d'usage de l'IA** fourni en option dans les livrables (paragraphe à insérer dans l'avertissement ou la méthodologie).
7. La **fiche de préparation à la soutenance** aide l'utilisateur à maîtriser le contenu de son travail.

---

## 18. Journalisation et observabilité

- Journal technique (fichier rotatif, niveau configurable) : appels LLM (sans la clé), erreurs, durées, transitions d'état.
- Journal utilisateur (`events`) en français clair.
- Option « journal détaillé » : prompts et réponses complets enregistrés (compressés) pour diagnostiquer la qualité.
- Bouton « Exporter les journaux » (zip) dans Paramètres → pour l'assistance.
- Tableau de bord « Coûts » alimenté par `llm_calls`.

---

## 19. Sécurité et confidentialité

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` pour le renderer ; CSP stricte.
- Toutes les communications réseau se font depuis le moteur, uniquement vers : OpenRouter, les API de sources listées, les URL de PDF en accès ouvert, les sites vérifiés.
- Les fichiers importés ne quittent jamais la machine, **sauf** les extraits envoyés aux modèles via OpenRouter : l'utilisateur en est informé à l'onboarding (avec lien vers la politique de confidentialité d'OpenRouter et conseil de choisir des fournisseurs qui ne conservent pas les données **[À VÉRIFIER : paramètres de confidentialité / provider routing d'OpenRouter]**).
- Option d'**anonymisation** des données de terrain avant envoi (remplacement des noms propres détectés dans les transcriptions par des identifiants E1, E2…).
- Aucune télémétrie par défaut. Si ajoutée plus tard : opt-in explicite.
- Mises à jour de l'application via `electron-updater` (releases GitHub) avec vérification de signature quand disponible.

---

## 20. Gestion des erreurs (référence)

| Code interne | Cas | Message utilisateur (FR) | Action |
|---|---|---|---|
| E_KEY_INVALID | 401 OpenRouter | « Votre clé OpenRouter est invalide ou a été révoquée. » | Pause, ouvrir Paramètres |
| E_NO_CREDIT | 402 / crédit insuffisant | « Crédit OpenRouter épuisé. Rechargez puis cliquez sur Reprendre. » | `paused_no_credit`, reprise auto |
| E_BUDGET | Budget atteint | « Le budget de X $ est atteint. » | `paused_budget`, options |
| E_RATE_LIMIT | 429 | (silencieux, événement info) | Backoff, baisse du parallélisme |
| E_MODEL_UNAVAILABLE | 404/503 modèle | « Le modèle X est indisponible, bascule sur Y. » | Secours |
| E_NETWORK | Réseau | « Connexion Internet perdue, reprise automatique dès son retour. » | `paused_network` |
| E_SCHEMA | Sortie non conforme | (silencieux puis erreur si persistant) | Réessai avec correction |
| E_CONTEXT_OVERFLOW | Prompt trop long | (silencieux) | Réduction des extraits |
| E_PARSE_FILE | Fichier illisible | « Impossible de lire le fichier X (raison). » | Avertissement, continuer |
| E_SOURCES_INSUFFICIENT | Couverture insuffisante | « Peu de sources trouvées pour la section X. » | Avertissement, continuer |
| E_EXPORT | Échec génération | « La génération du fichier Word a échoué. » | Réessai, journal |
| E_ENGINE_CRASH | Crash moteur | « Le moteur a redémarré, la mission reprend. » | Redémarrage auto |

---

## 21. Tests et critères d'acceptation

### 21.1 Tests unitaires (Vitest)

- Machine à états (toutes les transitions, interdites incluses).
- File de tâches : dépendances, baux, reprise après crash simulé, idempotence.
- Client LLM : réessais, 402 → pause, bascule de secours, calcul de coût (avec un serveur simulé).
- Connecteurs : parsing des réponses (fixtures enregistrées), déduplication.
- Vérification : correspondance de notices, citations littérales, nombres orphelins, similarité n-grammes.
- Statistiques P4 : comparaison avec des résultats connus.
- Formatage CSL : exemples de référence pour chaque profil.
- Export DOCX : le fichier généré est relu et sa structure vérifiée.

### 21.2 Tests d'intégration

- Mission complète en **mode simulé** (« mock LLM ») : un faux client LLM renvoie des réponses déterministes valides → la mission va de P0 à P9 sans appel réseau payant. **Ce mode DOIT exister dès le jalon 2** et rester utilisable via une option développeur.
- Mission réelle courte (« mini-mémoire » de 10 pages, modèles économiques) pour la calibration des coûts.

### 21.3 Tests E2E (Playwright + Electron)

- Onboarding, création de mission via le wizard, validation du plan, pause / reprise, ouverture des livrables.

### 21.4 Critères d'acceptation V1

1. Une mission « mémoire de master, 60 pages, approche mixte avec données CSV fournies » se termine en autonomie après validation du plan.
2. 100 % des sources citées sont vérifiées et présentes en bibliographie.
3. Taux d'ancrage ≥ 95 %.
4. Aucun chiffre de résultats différent des calculs du module statistique.
5. Coupure réseau simulée de 20 min et fermeture brutale de l'app : la mission reprend sans perte ni doublon.
6. Crédit épuisé simulé : pause, puis reprise après rechargement.
7. Le DOCX s'ouvre dans Word et LibreOffice, TOC fonctionnelle, numérotation correcte.
8. Le coût réel reste dans la fourchette estimée (scénario haut) dans au moins 80 % des tests de calibration.
9. L'interface reste fluide pendant toute la mission.

---

## 22. Jalons de développement (ordre imposé)

Chaque jalon se termine par : tests verts, démonstration fonctionnelle, mise à jour de `docs/DECISIONS.md`.

**J1 — Socle**
Monorepo pnpm, Electron + React + Vite + Tailwind + shadcn, processus moteur (utilityProcess) avec IPC typé, SQLite + migrations, écran Paramètres avec saisie / test / stockage chiffré de la clé OpenRouter, liste des modèles.
**Design system (§6.1)** : tokens CSS clair / sombre, polices locales, configuration Tailwind, tous les composants de la §6.1.7 restylés, `AppShell` + `Sidebar`, et la page de démonstration `/design`. **Point d'arrêt obligatoire** : faire valider la page `/design` (captures d'écran clair et sombre) par Marion avant de construire les écrans des jalons suivants.

**J2 — Moteur et mode simulé**
Machine à états, file de tâches persistante, baux, checkpoints, reprise, client LLM réel + client simulé, journal d'événements, dashboard minimal affichant les événements en direct. Mission factice de bout en bout en mode simulé.

**J3 — Wizard et brief**
Les 7 étapes du wizard, import de fichiers, P0 (extraction de texte, découpage, embeddings locaux, FTS5 + sqlite-vec), profil de données de terrain.

**J4 — Recherche**
Connecteurs OpenAlex, Crossref, HAL, Semantic Scholar, Unpaywall (puis CORE, arXiv, DOAJ, Europe PMC), déduplication, scores, vérification des sources, fiches de lecture, recherche hybride.

**J5 — Cadrage et plan**
P1, P2, écran de validation du plan (édition de l'arbre), estimation de coût et de durée.

**J6 — Rédaction**
P4 (module statistique + interprétation), P5 (rédacteurs, ancrage, contrôles chiffres et similarité, résumés), parallélisme.

**J7 — Jury**
P6, P7 (grille, jurés, président, boucle de révision, plateau, harmonisation), onglets Jury et Brouillons (avec diff).

**J8 — Livrables**
Profils de normes + CSL, P8, P9 (DOCX, PDF, PPTX, fiche de préparation, rapport de mission), contrôle final.

**J9 — Robustesse et finition**
Tous les cas du §8.6 et du §20, notifications, garde anti-veille, budget, export/import de mission, onboarding, charte, packaging Windows (installateur NSIS), mises à jour automatiques.

**J10 — Calibration**
3 missions réelles courtes, ajustement des coefficients d'estimation, amélioration des prompts, préréglages de modèles.

---

## 23. Points ouverts et à vérifier

1. Endpoints exacts, quotas et conditions d'utilisation de chaque API de sources (§11.2).
2. Endpoints OpenRouter : informations de clé / crédit, coût exact par génération, support des sorties structurées, préférences de confidentialité (§14).
3. Choix et taille du modèle d'embeddings local multilingue (§4.1).
4. Moteur CSL et fichiers de styles pour les profils (§15.2).
5. Identifiants des modèles des préréglages (§14.3) — à fixer au moment du développement.
6. API de recherche web pour les documents institutionnels (§11.2) : laquelle, avec quelle clé.
7. Connecteurs africains (AJOL, CAMES, dépôts OAI-PMH d'universités) — faisabilité V1.1.
8. Nom définitif de l'application, logo, et pack d'illustrations 3D (originales ou sous licence commerciale vérifiée, §6.1.1).
9. Signature du code de l'installateur Windows (certificat) pour éviter les avertissements SmartScreen.
10. Mode cloud Cloudflare (V2) : Workers + Durable Objects + Queues + D1 + R2 + Vectorize, réutilisant le package `engine` (§4.6).
