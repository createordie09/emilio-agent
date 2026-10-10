-- Livrables (CdC §16) : fichiers produits, contrôle final et journal de recherche documentaire (utile au rapport de mission, §16.4).
CREATE TABLE deliverables (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('docx','pdf','pptx','fiche','rapport')),
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (mission_id, kind)
);

CREATE TABLE export_state (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  final_check_json TEXT,
  bibliography_json TEXT,
  skipped_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE search_log (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  section_key TEXT,
  iteration INTEGER NOT NULL DEFAULT 0,
  queries_json TEXT NOT NULL,
  connectors_json TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_search_log_mission ON search_log(mission_id);
