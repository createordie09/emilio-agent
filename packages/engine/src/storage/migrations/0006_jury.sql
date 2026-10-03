-- J7 : jury (P6, P7), révisions et issue de chaque évaluation (CdC §13, §5.11).
CREATE UNIQUE INDEX uq_jury_reviews ON jury_reviews(mission_id, scope, COALESCE(target_id, ''), round, juror_role);

-- Journal des révisions : quelle version a remplacé quelle autre, pour quelles remarques, et si elle a été conservée.
CREATE TABLE revision_log (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('chapter','global')),
  target_id TEXT NOT NULL DEFAULT '',
  round INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('revision','harmonisation')),
  node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
  from_draft_id TEXT,
  to_draft_id TEXT,
  remarks_json TEXT,
  outcome TEXT NOT NULL DEFAULT 'kept' CHECK (outcome IN ('kept','reverted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_revision_log_scope ON revision_log(mission_id, scope, target_id, round);

-- Issue d'une boucle de révision : `valide`, ou `accepte_avec_reserves` avec les raisons (§9.3, §13.4, rapport final J8).
CREATE TABLE review_outcomes (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('chapter','global')),
  target_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('valide','accepte_avec_reserves')),
  final_score REAL NOT NULL,
  rounds INTEGER NOT NULL,
  reasons_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (mission_id, scope, target_id)
);
