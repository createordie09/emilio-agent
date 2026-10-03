import { existsSync, readFileSync } from 'node:fs';
import { nowIso, type Db } from '../storage/db';
import {
  AGENT_ROLES,
  type AgentRole,
  type ModelInfo,
  type NormsProfileInfo,
  type PresetInfo,
} from '@emilio/shared';

type PresetFile = {
  presets: { id: string; label: string; description: string; models: Record<string, string> }[];
};
type NormsFile = { profiles: NormsProfileInfo[] };

/** Préréglages de modèles (CdC §14.3), lus dans un fichier de configuration — jamais dans le code. */
export function loadPresets(
  path: string | undefined,
  knownModels: ModelInfo[] | null,
): PresetInfo[] {
  // Fichier absent : liste vide (le moteur doit démarrer) ; fichier corrompu : erreur explicite.
  if (!path || !existsSync(path)) return [];
  const file = JSON.parse(readFileSync(path, 'utf8')) as PresetFile;
  const known = knownModels ? new Set(knownModels.map((m) => m.id)) : null;
  return file.presets.map((p) => {
    const missingRoles = AGENT_ROLES.filter((r) => !p.models[r]);
    if (missingRoles.length)
      throw new Error(`Préréglage « ${p.id} » incomplet : ${missingRoles.join(', ')}`);
    const ids = [...new Set(Object.values(p.models))];
    return {
      id: p.id,
      label: p.label,
      description: p.description,
      models: p.models as Record<AgentRole, string>,
      // Sans liste de modèles (hors ligne, jamais chargée) on ne peut pas conclure : rien n'est signalé.
      missing: known ? ids.filter((id) => !known.has(id)) : [],
    };
  });
}

export function loadNormsProfiles(path: string | undefined): NormsProfileInfo[] {
  if (!path || !existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, 'utf8')) as NormsFile).profiles;
}

/** Alimente `norms_profiles` avec les profils intégrés (§5.14, `builtin = 1`) ; les profils modifiés par l'utilisateur ne sont pas écrasés. */
export function seedNormsProfiles(db: Db, profiles: NormsProfileInfo[]): void {
  const t = nowIso();
  const ins = db.prepare(
    `INSERT INTO norms_profiles(id,name,builtin,profile_json,created_at,updated_at) VALUES (?,?,1,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, profile_json=excluded.profile_json, updated_at=excluded.updated_at WHERE builtin = 1`,
  );
  db.transaction(() => {
    for (const p of profiles) ins.run(p.id, p.name, JSON.stringify(p), t, t);
  })();
}
