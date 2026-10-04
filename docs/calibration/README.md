# Calibration (J10, CdC §21.2, §21.4 critère 8)

Banc d'essai : `packages/engine/test-live/calibration.live.ts` — une mission **réelle** courte (« mini-mémoire » de 10 pages) avec le vrai modèle d'IA (OpenRouter).

```
# 1 mission = 1 scénario ; le budget plafonne la dépense réelle
NODE_USE_ENV_PROXY=1 CAL_SCENARIO=A CAL_BUDGET=1.5 \
  pnpm --filter @emilio/engine exec vitest run --config vitest.live.config.ts test-live/calibration.live.ts
```

| Scénario | Contenu                                             | Préréglage |
| -------- | --------------------------------------------------- | ---------- |
| A        | documentaire (+ diaporama et fiche pour mesurer P9) | économique |
| B        | quantitative, données CSV de test                   | économique |
| C        | documentaire                                        | équilibré  |

Résultat : `docs/calibration/<scénario>.json` (coût et jetons réels par phase, par agent et par modèle, vitesses mesurées, erreurs, avertissements, ancrage et phrases supprimées par section, notes du jury, contrôle final) et `<scénario>.log`.

**Sources simulées** : les API de sources documentaires (OpenAlex, Crossref…) sont inaccessibles depuis le cloud ; `sourcesMode: 'mock'` (réglage de mission, développeur) garde le **vrai modèle** mais des **sources simulées**. La calibration mesure donc le coût et la tenue des prompts, pas la qualité de la recherche documentaire réelle.

## Constats déjà établis (sans mission complète)

Vérifiés auprès d'OpenRouter le 4 octobre 2026, pour un coût total inférieur à 0,01 $ :

- **Les 6 identifiants de modèles des préréglages existent** dans `GET /models` (CdC §23.5) et acceptent `response_format` et `structured_outputs`.
- **Sortie JSON stricte** (`json_schema` + `provider.require_parameters`) : valide avec `google/gemini-3.8-flash`, `deepseek/deepseek-v4-flash` et `deepseek/deepseek-v4-pro`.
- **Les modèles des préréglages sont des modèles à raisonnement** : pour une requête triviale, 150 à 290 jetons de réflexion pour 20 à 30 jetons utiles. Ces jetons sont facturés comme jetons de sortie. Les coefficients de `resources/estimation.json` ne les comptent pas : l'estimation sous-évalue probablement la dépense. À mesurer (mission réelle) avant d'ajouter un coefficient.
- **Sans `max_tokens`, OpenRouter réserve le coût maximal de la réponse** (65 536 jetons pour Gemini) : avec un petit solde, la requête est refusée en 402 alors qu'elle coûterait des centimes. Corrigé : plafond de 16 000 jetons par appel (`maxOutputTokens`), réessai unique avec le double si la réponse est coupée par la limite.
- Estimation actuelle (avant mesure) d'un mémoire de 10 pages, 2 rondes par chapitre : économique 0,48 à 0,59 $ ; équilibré 0,81 à 1,17 $ ; excellence 1,41 à 2,18 $.

## État

Les trois missions réelles n'ont **pas** pu être menées : le solde du compte OpenRouter est épuisé (crédits 20 $, consommation 20,17 $). Dès que le compte est rechargé (5 à 6 $ suffisent), relancer les trois scénarios, puis ajuster `resources/estimation.json` et les prompts d'après les JSON produits (critère d'acceptation : coût réel ≤ scénario haut dans 80 % des essais).
