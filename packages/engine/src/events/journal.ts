import type { AgentRole, EventLevel, MissionEvent } from '@emilio/shared';
import { newId, nowIso, type Db } from '../storage/db';

type Listener = (e: MissionEvent) => void;

/** Journal utilisateur en français (CdC §5.13) + diffusion en direct vers l'interface. */
export class EventJournal {
  private listeners = new Set<Listener>();
  constructor(
    private readonly db: Db,
    private readonly now: () => string = nowIso,
  ) {}

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Écrit l'événement ; à appeler dans la même transaction que l'effet qu'il décrit. */
  record(e: {
    missionId: string | null;
    level: EventLevel;
    messageFr: string;
    agentRole?: AgentRole | 'local' | null;
    data?: unknown;
  }): MissionEvent {
    const row: MissionEvent = {
      id: newId(),
      missionId: e.missionId,
      level: e.level,
      agentRole: e.agentRole ?? null,
      messageFr: e.messageFr,
      createdAt: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO events(id, mission_id, level, agent_role, message_fr, data_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.missionId,
        row.level,
        row.agentRole,
        row.messageFr,
        e.data === undefined ? null : JSON.stringify(e.data),
        row.createdAt,
        row.createdAt,
      );
    // Diffusion différée : jamais à l'intérieur d'une transaction qui pourrait être annulée.
    queueMicrotask(() => this.listeners.forEach((l) => l(row)));
    return row;
  }

  list(missionId: string | null, limit = 200): MissionEvent[] {
    const rows = (
      missionId
        ? this.db
            .prepare(
              'SELECT * FROM events WHERE mission_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
            )
            .all(missionId, limit)
        : this.db
            .prepare('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT ?')
            .all(limit)
    ) as Record<string, string | null>[];
    return rows
      .map((r) => ({
        id: r.id!,
        missionId: r.mission_id ?? null,
        level: r.level as EventLevel,
        agentRole: r.agent_role as MissionEvent['agentRole'],
        messageFr: r.message_fr!,
        createdAt: r.created_at!,
      }))
      .reverse();
  }
}
