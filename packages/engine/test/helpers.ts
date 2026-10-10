import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineService, MockLlmClient, type EngineOptions, type MissionExecConfig } from '../src';

export const tmpDb = () => join(mkdtempSync(join(tmpdir(), 'emilio-t-')), 'test.db');

export function mkEngine(over: Partial<EngineOptions> & { mock?: MockLlmClient } = {}) {
  const mock = over.mock ?? new MockLlmClient({ delayMs: 0, costPerCallUsd: 0.002 });
  const engine = new EngineService({
    dbPath: over.dbPath ?? tmpDb(),
    mock,
    runner: {
      tickMs: 5,
      networkBackoffBaseMs: 1,
      networkBackoffMaxMs: 5,
      networkGiveUpMs: 30,
      pauseGraceMs: 50,
      ...over.runner,
    },
    ...over,
  });
  return { engine, mock };
}

export const cfgOf = (e: EngineService, id: string) => e.missions.config<MissionExecConfig>(id);

export const statusCounts = (e: EngineService, id: string) => e.queue.counts(id);

export const llmCalls = (e: EngineService) =>
  (
    e.db.prepare('SELECT COUNT(*) AS n FROM llm_calls WHERE status_code = 200').get() as {
      n: number;
    }
  ).n;

export const eventsOf = (e: EngineService, id: string) =>
  e.journal.list(id, 1000).map((x) => x.messageFr);
