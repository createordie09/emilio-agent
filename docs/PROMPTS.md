# Prompts des agents (documentation)

Les prompts sont des fichiers `packages/engine/src/agents/<rôle>/<nom>.prompt.md`, chargés par `renderPrompt` (variables `{{nom}}`). Le bloc **règles d'intégrité** (§17 : ne rien inventer, citer seulement ce qui est fourni) est injecté d'office. La version (`RESEARCH_PROMPT_VERSION`, actuellement `recherche-1`) est enregistrée avec chaque appel. Toute sortie est un JSON validé par zod (`research/schemas.ts`) ; sinon une relance est tentée puis `E_SCHEMA`.

| Prompt                          | Rôle               | Entrée                                  | Sortie                                                   |
| ------------------------------- | ------------------ | --------------------------------------- | -------------------------------------------------------- |
| `researcher/queries`            | Chercheur          | section, objectif, questions clés       | requêtes courtes FR/EN                                   |
| `researcher/rank`               | Chercheur          | candidats (titre, année, revue, résumé) | score 0–10, garder, justification par candidat           |
| `source_verifier/arbitration`   | Vérificateur       | notice annoncée vs notice retrouvée     | même document ou non, avec justification                 |
| `document_analyst/reading-note` | Analyste documents | extraits de la source (identifiés)      | thèse, méthode, résultats, citations littérales, limites |

Garde-fous appliqués **par le code**, pas par le prompt : vérification d'existence des sources, contrôle littéral des citations (`quoteExists`), plafond de 40 mots par citation, seules les sources vérifiées sont citables.
