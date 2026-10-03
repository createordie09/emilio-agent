import type { Phase } from '@emilio/shared';
import { newId, type Db } from '../storage/db';

export type CheckpointSnapshot = {
  phase: Phase | null;
  tasksDone: number;
  tasksTotal: number;
  costSpentUsd: number;
  note?: string;
};

/** Sauvegarde de l'état de l'orchestrateur à chaque fin de phase (CdC §5.12, ENF-02). */
export class CheckpointRepo {
  constructor(
    private readonly db: Db,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  create(missionId: string, snapshot: CheckpointSnapshot): string {
    const id = newId();
    const t = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO checkpoints(id,mission_id,phase,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        )
        .run(id, missionId, snapshot.phase, JSON.stringify(snapshot), t, t);
      this.db
        .prepare('UPDATE missions SET last_checkpoint_id=?, updated_at=? WHERE id=?')
        .run(id, t, missionId);
    })();
    return id;
  }

  latest(missionId: string): (CheckpointSnapshot & { id: string }) | null {
    const r = this.db
      .prepare(
        'SELECT id, snapshot_json FROM checkpoints WHERE mission_id=? ORDER BY created_at DESC, id DESC LIMIT 1',
      )
      .get(missionId) as { id: string; snapshot_json: string } | undefined;
    return r ? { id: r.id, ...(JSON.parse(r.snapshot_json) as CheckpointSnapshot) } : null;
  }

  count(missionId: string): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE mission_id=?')
        .get(missionId) as { n: number }
    ).n;
  }
}
