// Point d'entrée du processus moteur (utilityProcess Electron). Reçoit les requêtes du main via parentPort.
import { EngineService } from './service';
import type { EngineRequest, EngineResponse, EngineEvent } from '@emilio/shared';

type ParentPort = {
  on(event: 'message', cb: (e: { data: EngineRequest }) => void): void;
  postMessage(msg: EngineResponse | EngineEvent): void;
};
// utilityProcess : process.parentPort ; repli Node (mode dev/CI) : canal IPC de child_process.fork.
const parentPort: ParentPort | undefined =
  (process as unknown as { parentPort?: ParentPort }).parentPort ??
  (process.send
    ? {
        on: (_e, cb) => process.on('message', (data) => cb({ data: data as EngineRequest })),
        postMessage: (msg) => void process.send!(msg),
      }
    : undefined);
if (!parentPort) throw new Error('Ce module doit être exécuté dans un processus moteur.');

const dbPath = process.env.EMILIO_DB_PATH;
if (!dbPath) throw new Error('EMILIO_DB_PATH manquant.');

const engine = new EngineService({ dbPath });
parentPort.on('message', async ({ data }) => {
  const result = await engine.handle(data.method, data.params);
  parentPort.postMessage({ id: data.id, result });
});
parentPort.postMessage({ event: 'ready' });
