-- Cache disque des réponses des connecteurs (CdC §11.1) : clé = requête normalisée (sans e-mail ni clé).
CREATE TABLE source_cache (
  key TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  body TEXT NOT NULL,
  status INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_source_cache_expires ON source_cache(expires_at);

-- Fiches de lecture (CdC §9 P3.7) : une par source et par section.
CREATE TABLE reading_notes (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  note_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, section_key)
);

-- Matrice section ↔ sources (CdC §9 P3 sortie). `section_key` = identifiant du nœud du plan (J5).
CREATE TABLE section_sources (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  relevance REAL,
  rank INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (mission_id, section_key, source_id)
);
CREATE INDEX idx_section_sources_source ON section_sources(source_id);
