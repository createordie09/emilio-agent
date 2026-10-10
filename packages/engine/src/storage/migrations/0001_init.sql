-- Schéma initial (CdC §5.1–5.14). Les champs *_json contiennent du JSON validé par zod.
-- chunks_vec (sqlite-vec) est créée en J3, quand le modèle d'embeddings (donc la dimension) est fixé.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE norms_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','briefing','planning',
    'awaiting_plan_validation','running','paused','paused_no_credit','paused_network',
    'paused_budget','failed','completed','cancelled')),
  current_phase TEXT,
  brief_json TEXT,
  config_json TEXT,
  plan_json TEXT,
  norms_profile_id TEXT REFERENCES norms_profiles(id),
  cost_estimate_json TEXT,
  cost_spent_usd REAL NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  last_checkpoint_id TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_missions_status ON missions(status);

CREATE TABLE mission_files (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('user_document','field_data','institution_guidelines','template','other')),
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  sha256 TEXT,
  parsed_status TEXT,
  parsed_text_path TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_mission_files_mission ON mission_files(mission_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  parent_task_id TEXT REFERENCES tasks(id),
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','running','done','failed','skipped','blocked')),
  priority INTEGER NOT NULL DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_until TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  error_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tasks_mission_status ON tasks(mission_id, status);

CREATE TABLE llm_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  request_hash TEXT,
  prompt_version TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  status_code INTEGER,
  error TEXT,
  openrouter_generation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  authors_json TEXT,
  year INTEGER,
  publisher TEXT,
  journal TEXT,
  volume TEXT,
  issue TEXT,
  pages TEXT,
  doi TEXT,
  isbn TEXT,
  url TEXT,
  oa_pdf_url TEXT,
  language TEXT,
  abstract TEXT,
  fulltext_status TEXT NOT NULL DEFAULT 'none' CHECK (fulltext_status IN ('none','abstract_only','fulltext')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','partially_verified','rejected')),
  verification_json TEXT,
  relevance_score REAL,
  quality_score REAL,
  used_in_text INTEGER NOT NULL DEFAULT 0,
  csl_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sources_mission ON sources(mission_id);
CREATE INDEX idx_sources_doi ON sources(mission_id, doi);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  page_from INTEGER,
  page_to INTEGER,
  section_title TEXT,
  token_count INTEGER,
  is_bibliography INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, ordinal)
);
CREATE INDEX idx_chunks_mission ON chunks(mission_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, section_title, content='chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, section_title) VALUES (new.rowid, new.text, new.section_title);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title) VALUES ('delete', old.rowid, old.text, old.section_title);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title) VALUES ('delete', old.rowid, old.text, old.section_title);
  INSERT INTO chunks_fts(rowid, text, section_title) VALUES (new.rowid, new.text, new.section_title);
END;

CREATE TABLE outline_nodes (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES outline_nodes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('partie','chapitre','section','sous_section')),
  numbering TEXT,
  title TEXT NOT NULL,
  objective TEXT,
  key_questions_json TEXT,
  target_words INTEGER,
  required_sources_min INTEGER,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','researching','drafting','in_review','validated')),
  current_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_outline_mission ON outline_nodes(mission_id);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  outline_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  author_agent TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  parent_version_id TEXT,
  change_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (outline_node_id, version)
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  sentence_index INTEGER,
  claim_text TEXT NOT NULL,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  support_level TEXT CHECK (support_level IN ('supported','partially','unsupported')),
  checked_by TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE jury_reviews (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('section','chapter','global')),
  target_id TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  juror_role TEXT NOT NULL,
  scores_json TEXT,
  total_score REAL,
  verdict TEXT CHECK (verdict IN ('valide','a_reviser','a_reecrire')),
  comments_json TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  phase TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info','success','warning','error')),
  agent_role TEXT,
  message_fr TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_mission ON events(mission_id, created_at);
