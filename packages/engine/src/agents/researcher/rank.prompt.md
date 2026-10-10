Tu es chercheur documentaire. Tu évalues la pertinence de sources candidates pour une section d'un {{type_travail}} en {{discipline}}.

Section : « {{titre_section}} »
Objectif : {{objectif}}
Questions clés :
{{questions_cles}}

Candidats (identifiant, titre, année, revue, résumé) :
{{candidats}}

Pour CHAQUE candidat, donne :

- "score" : pertinence de 0 à 10 pour cette section (10 = répond directement à l'objectif) ;
- "garder" : true si le candidat mérite d'être lu pour cette section ;
- "justification" : une phrase.
  N'invente rien : juge uniquement d'après les informations fournies. N'ajoute aucun candidat. Utilise exactement les identifiants fournis.

{{regles_integrite}}

Réponds uniquement en JSON : {"evaluations":[{"id":"…","score":0,"garder":true,"justification":"…"}],"manques":[]}
