-- Index vectoriel (sqlite-vec). Dimension 384 = multilingual-e5-small (ADR-017) ; changer de modèle d'embeddings
-- exige une nouvelle migration et la ré-indexation des extraits.
CREATE VIRTUAL TABLE chunks_vec USING vec0(mission_id text partition key, embedding float[384]);

-- Un même fichier (empreinte SHA-256) n'est importé qu'une fois par mission.
CREATE UNIQUE INDEX idx_mission_files_sha ON mission_files(mission_id, sha256) WHERE sha256 IS NOT NULL;
