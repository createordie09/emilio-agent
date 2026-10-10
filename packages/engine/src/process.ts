// Point d'entrée du processus moteur (utilityProcess Electron). Reçoit les requêtes du main via parentPort.
import { EngineService } from './service';
import type {
  EngineRequest,
  EngineResponse,
  EngineEvent,
  HostReply,
  HostRequest,
} from '@emilio/shared';

type ParentPort = {
  on(event: 'message', cb: (e: { data: EngineRequest | HostReply }) => void): void;
  postMessage(msg: EngineResponse | EngineEvent): void;
};
// utilityProcess : process.parentPort ; repli Node (mode dev/CI) : canal IPC de child_process.fork.
const parentPort: ParentPort | undefined =
  (process as unknown as { parentPort?: ParentPort }).parentPort ??
  (process.send
    ? {
        on: (_e, cb) =>
          process.on('message', (data) => cb({ data: data as EngineRequest | HostReply })),
        postMessage: (msg) => void process.send!(msg),
      }
    : undefined);
if (!parentPort) throw new Error('Ce module doit être exécuté dans un processus moteur.');

const dbPath = process.env.EMILIO_DB_PATH;
if (!dbPath) throw new Error('EMILIO_DB_PATH manquant.');

const engine = new EngineService({
  dbPath,
  dataDir: process.env.EMILIO_DATA_DIR,
  modelsDir: process.env.EMILIO_MODELS_DIR,
  presetsPath: process.env.EMILIO_PRESETS_PATH,
  normsProfilesPath: process.env.EMILIO_NORMS_PATH,
  resourcesDir: process.env.EMILIO_RESOURCES_DIR,
  qualityWeightsPath: process.env.EMILIO_QUALITY_WEIGHTS_PATH,
});
// Rendu PDF : délégué au processus principal (Electron `printToPDF`), le moteur n'a pas accès à Chromium.
const hostWaiting = new Map<number, (r: { ok: boolean; message?: string }) => void>();
let hostId = 0;
engine.setPdfAdapter({
  render: (htmlPath, pdfPath) =>
    new Promise<void>((resolve, reject) => {
      const id = ++hostId;
      const timer = setTimeout(() => {
        hostWaiting.delete(id);
        reject(new Error('délai dépassé'));
      }, 180_000);
      hostWaiting.set(id, (r) => {
        clearTimeout(timer);
        if (r.ok) resolve();
        else reject(new Error(r.message ?? 'rendu impossible'));
      });
      const req: HostRequest = { id, method: 'renderPdf', params: { htmlPath, pdfPath } };
      parentPort.postMessage({ event: 'host', payload: req });
    }),
});
engine.onLive((payload) => parentPort.postMessage({ event: 'live', payload }));
parentPort.on('message', async ({ data }) => {
  if ('hostReply' in data) {
    hostWaiting.get(data.hostReply.id)?.(data.hostReply);
    hostWaiting.delete(data.hostReply.id);
    return;
  }
  const result = await engine.handle(data.method, data.params);
  parentPort.postMessage({ id: data.id, result });
});
engine.start();
parentPort.postMessage({ event: 'ready' });
