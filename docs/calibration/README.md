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

## Résultats (compte rechargé, 10 octobre 2026)

Quatre missions réelles (sources simulées), mini-mémoire de ~3 000 mots, une à deux rondes de révision par chapitre. Les relevés bruts sont dans ce dossier.

| Essai | Réglages                                   | Issue                                  | Coût réel | Estimation moyen / haut (de l'époque)   |
| ----- | ------------------------------------------ | -------------------------------------- | --------- | --------------------------------------- |
| A0    | économique, réflexion par défaut, 2 rondes | arrêtée au budget (1,2 $) en P5, 35/49 | 1,20 $    | 0,63 $ / —                              |
| A1    | économique, réflexion « low », 2 rondes    | arrêtée au budget (1,0 $) en P7, 35/43 | 1,04 $    | 0,55 $ / 0,56 $                         |
| B     | économique, données CSV, 1 ronde           | terminée jusqu'à P9 (36 min)           | 1,05 $    | 0,55 $ / 0,56 $                         |
| C     | « équilibré » (voir défaut n° 1), 1 ronde  | terminée jusqu'à P9 (28 min)           | 0,81 $    | 1,19 $ / 1,22 $ (nouveaux coefficients) |

### Constats

1. **Défaut trouvé : modèles Claude 5.5 / GPT-6.1 refusés.** Ces modèles n'acceptent pas le paramètre `temperature` ; avec `require_parameters`, OpenRouter répondait 404 (« Filter by Parameters »), le moteur basculait sur le modèle de secours. L'essai C a donc tourné **entièrement sur les modèles de secours** (Gemini + DeepSeek), jamais sur ceux du préréglage « équilibré ». Corrigé : `temperature` n'est plus envoyée aux modèles dont `supported_parameters` ne la contient pas (test unitaire). Une requête simple vers le modèle Claude avec ce correctif répond bien (200). **Non revérifié en mission complète** : le crédit restant (< 0,6 $) n'y suffisait pas.
2. **Les jetons de réflexion dominent le coût.** Réflexion par défaut : 987 jetons de réflexion pour 150 mots utiles (A0 : 1,20 $ dépensés pour atteindre P5). `reasoning.effort = "low"` par défaut (`resources/llm-config.json`) supprime cette réflexion. `"minimal"` est pire pour DeepSeek (2 332 jetons) : à éviter.
3. **Le jury coûte 50 à 60 % de la mission** (B : P6 0,53 $ + P7 0,26 $ sur 1,05 $). Les jurés produisent ~4 300 jetons par appel (60 à 75 s) malgré la consigne de concision ; président : ~660 jetons.
4. **L'estimateur sous-évaluait ×1,9 (B)** : P5 ×1,8, P6 ×2,8, P7 ×3. Corrigé (`estimation.json` et `estimate.ts`) : sorties des jurés 4 300, rédaction ×2,5 en sortie, résumés 1 000, ancrage 850, entrée du président fixe, évaluations par chapitre = rondes + 1. P3 reste **surestimée** (réel 0,10 $ pour 0,16 à 0,22 $ estimés) ; non diminué, car les sources simulées donnent des extraits courts.
5. **Critère §21.4 n° 8 (coût réel ≤ scénario « haut » dans ≥ 80 % des essais)** : **non démontré**. Avec les anciens coefficients : A1 et B échouent. Avec les nouveaux : C passe (0,81 $ ≤ 1,22 $, avec une marge de 50 %, donc probablement trop prudent) ; B et A1 n'ont pas été rejoués faute de crédit. À revalider sur une machine avec crédit et sources réelles.
6. **Qualité** : chapitres notés de 7,8 à 15,4/20, tous « accepté avec réserves » sauf exception ; ancrage final de 90 à 100 % ; contrôle final sans marqueur non résolu. Les réserves viennent surtout des sources simulées (2 à 7 sources pauvres, `[INFORMATION MANQUANTE]`) et d'un dépassement de longueur (4 155 mots pour 2 980 visés en B, 139 %). Une révision qui dégradait le texte a été annulée par le code comme prévu. Aucune citation, source ou donnée inventée relevée par les contrôles.
7. **Erreurs** : une erreur distante isolée par essai (reprise automatique) ; aucune perte de mission.

### Reste à faire

- Rejouer B et C avec les modèles réellement prévus par le préréglage « équilibré » (correctif n° 1) et mesurer le coût réel du jury avec Claude / GPT.
- Rejouer avec de **vraies sources** (`pnpm sources:check` sur une machine avec accès réseau).
- Réduire le dépassement de longueur de la rédaction (ratio de mots) et le coût du jury (jurés moins bavards).
