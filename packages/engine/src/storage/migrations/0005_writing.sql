-- J6 : analyse des données de terrain (P4), rédaction (P5) : résumés, contrôles, pages liminaires.
CREATE TABLE field_analysis (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  plan_json TEXT,
  results_json TEXT,
  interpretation_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Résumé de la section (150 à 250 mots, §8.4) et bilan des contrôles d'intégrité (§12) de chaque version.
ALTER TABLE drafts ADD COLUMN summary TEXT;
ALTER TABLE drafts ADD COLUMN checks_json TEXT;

-- Pages liminaires produites par la rédaction (résumé, abstract, dédicace, remerciements, avertissement).
CREATE TABLE front_matter (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  markdown TEXT NOT NULL,
  /** `genere` : rédigé à partir du travail ; `a_completer` : modèle à compléter par l'auteur (jamais inventé, §7.2). */
  kind TEXT NOT NULL CHECK (kind IN ('genere','a_completer')),
  checks_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (mission_id, key)
);
