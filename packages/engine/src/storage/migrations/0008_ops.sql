-- Coûts par rôle et par mission (CdC §6.7 onglet Coûts) : rattachement direct des appels de modèle.
ALTER TABLE llm_calls ADD COLUMN agent_role TEXT;
ALTER TABLE llm_calls ADD COLUMN mission_id TEXT;
CREATE INDEX idx_llm_calls_mission ON llm_calls(mission_id);
