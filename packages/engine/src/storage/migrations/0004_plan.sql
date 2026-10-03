-- J5 : cadrage (P1), plan (P2) et ses versions (CdC §5.2, §5.8, §9).
ALTER TABLE missions ADD COLUMN cadrage_json TEXT;
-- Méta du plan courant : version, justification, risques, méthodologie, choix de problématique, instructions.
ALTER TABLE missions ADD COLUMN plan_meta_json TEXT;

ALTER TABLE outline_nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'corps' CHECK (kind IN ('corps','introduction','conclusion'));
ALTER TABLE outline_nodes ADD COLUMN template_key TEXT;
ALTER TABLE outline_nodes ADD COLUMN sources_json TEXT;
ALTER TABLE outline_nodes ADD COLUMN remarks TEXT;

-- Historique des propositions de plan (une ligne par génération), pour le « diff » et la reprise.
CREATE TABLE plan_versions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  comment TEXT,
  proposal_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (mission_id, version)
);
