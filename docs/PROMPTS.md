# Prompts des agents (documentation)

Les prompts sont des fichiers `packages/engine/src/agents/<rôle>/<nom>.prompt.md`, chargés par `renderPrompt` (variables `{{nom}}`). Le bloc **règles d'intégrité** (§17 : ne rien inventer, citer seulement ce qui est fourni) est injecté d'office. La version (`RESEARCH_PROMPT_VERSION` = `recherche-1`, `PLAN_PROMPT_VERSION` = `plan-1`, `ANALYSIS_PROMPT_VERSION` = `analyse-1`, `WRITING_PROMPT_VERSION` = `redaction-1`) est enregistrée avec chaque appel. Toute sortie est un JSON validé par zod (`research/schemas.ts`) ; sinon une relance est tentée puis `E_SCHEMA`.

| Prompt                          | Rôle                    | Entrée                                                                                          | Sortie                                                            |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `researcher/queries`            | Chercheur               | section, objectif, questions clés                                                               | requêtes courtes FR/EN                                            |
| `researcher/rank`               | Chercheur               | candidats (titre, année, revue, résumé)                                                         | score 0–10, garder, justification par candidat                    |
| `orchestrator/cadrage`          | Orchestrateur (cadrage) | brief condensé, profil des données                                                              | incohérences, problématiques, concepts, pistes, requêtes FR/EN    |
| `outline_architect/plan`        | Architecte du plan      | brief, cadrage, squelette de gabarit, sources candidates (alias S1…), instructions, plan actuel | liste plate de nœuds, justification, méthodologie, risques        |
| `data_analyst/plan`             | Analyste de données     | problématique, hypothèses, profil des données                                                   | liste d'analyses exécutables (type, variables, hypothèse)         |
| `data_analyst/interpret`        | Analyste de données     | faits calculés par le code                                                                      | interprétation, statut de chaque hypothèse, limites               |
| `section_writer/write`          | Rédacteur               | contexte, résumés, sources A…, extraits E…, résultats                                           | Markdown avec marqueurs `[@A1, p. 3]`, `claims`                   |
| `section_writer/general`        | Rédacteur               | résumés des sections, hypothèses                                                                | introduction ou conclusion générale (sans citation)               |
| `section_writer/correct`        | Rédacteur               | texte actuel + phrases fautives et raisons                                                      | texte corrigé                                                     |
| `grounding_checker/check`       | Vérificateur d'ancrage  | affirmations + extraits                                                                         | verdict `supported` / `partially` / `unsupported` par affirmation |
| `summarizer/section`            | Résumeur                | texte d'une section                                                                             | résumé de 150 à 250 mots                                          |
| `summarizer/resume`             | Résumeur                | résumés des sections, problématique                                                             | résumé de la page liminaire + mots-clés                           |
| `summarizer/abstract`           | Résumeur                | résumé français                                                                                 | abstract anglais (seule production en anglais, §15.4)             |
| `source_verifier/arbitration`   | Vérificateur            | notice annoncée vs notice retrouvée                                                             | même document ou non, avec justification                          |
| `document_analyst/reading-note` | Analyste documents      | extraits de la source (identifiés)                                                              | thèse, méthode, résultats, citations littérales, limites          |

Garde-fous appliqués **par le code**, pas par le prompt : vérification d'existence des sources, contrôle littéral des citations (`quoteExists`), plafond de 40 mots par citation, seules les sources vérifiées sont citables.

Garanties du plan appliquées **par le code** : structure imposée (restauration des nœuds du gabarit), répartition exacte des mots, sources pressenties limitées aux alias fournis, numérotation, longueur et sections trop courtes signalées.

Garde-fous de la rédaction appliqués **par le code** : marqueurs valides seulement, citations retrouvées littéralement, nombres justifiés, similarité (8 mots), longueur, suppression des phrases qui restent fautives après deux rondes de correction, statuts d'hypothèses cohérents avec les tests. Le calcul statistique n'est jamais confié au modèle.
