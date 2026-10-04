import { fork, type ChildProcess } from 'node:child_process';
import { utilityProcess } from 'electron';
import {
  AppError,
  serializeError,
  type EngineEvent,
  type EngineMethod,
  type EngineRequest,
  type EngineResponse,
  type HostReply,
  type HostRequest,
  type Result,
} from '@emilio/shared';

export interface EngineClient {
  request<T>(method: EngineMethod, params?: unknown): Promise<Result<T>>;
}

/** Processus moteur abstrait : utilityProcess (défaut) ou Node système (mode dev/CI, cf. ADR-006). */
interface EngineProc {
  postMessage(msg: EngineRequest | HostReply): void;
  onMessage(cb: (m: EngineResponse | EngineEvent) => void): void;
  onExit(cb: () => void): void;
  kill(): void;
}

function spawnEngine(entry: string, env: Record<string, string>): EngineProc {
  const nodePath = process.env.EMILIO_ENGINE_NODE;
  if (nodePath) {
    // Mode dev/CI : le module natif better-sqlite3 est compilé pour Node, pas pour l'ABI d'Electron.
    const cp: ChildProcess = fork(entry, [], {
      execPath: nodePath,
      env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    return {
      postMessage: (m) => void cp.send(m),
      onMessage: (cb) => cp.on('message', (m) => cb(m as EngineResponse | EngineEvent)),
      onExit: (cb) => cp.on('exit', cb),
      kill: () => void cp.kill(),
    };
  }
  const up = utilityProcess.fork(entry, [], { serviceName: 'emilio-engine', env });
  return {
    postMessage: (m) => up.postMessage(m),
    onMessage: (cb) => up.on('message', cb),
    onExit: (cb) => up.on('exit', () => cb()),
    kill: () => void up.kill(),
  };
}

type Pending = { resolve: (r: Result<unknown>) => void; timer: NodeJS.Timeout };

/**
 * Supervise le processus moteur (utilityProcess) : relais des requêtes, redémarrage automatique
 * (3 fois max en 10 min, CdC §8.6), ré-initialisation via `onReady` après chaque démarrage.
 */
export class EngineHost implements EngineClient {
  private proc: EngineProc | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private restarts: number[] = [];
  private ready: Promise<void> = Promise.resolve();
  private stopping = false;
  private restarted = false;

  constructor(
    private readonly entry: string,
    private readonly dbPath: string,
    private readonly extraEnv: Record<string, string> = {},
    private readonly onReady: (raw: EngineClient) => Promise<void>,
    private readonly requestTimeoutMs = 60_000,
    private readonly onLive: (payload: unknown) => void = () => {},
    /** Appels du moteur vers l'application (rendu PDF) : renvoie un message d'erreur, ou rien si tout va bien. */
    private readonly onHost: (req: HostRequest) => Promise<string | void> = async () =>
      'Non disponible.',
  ) {}

  start(): Promise<void> {
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const proc = spawnEngine(this.entry, {
        ...process.env,
        ...this.extraEnv,
        EMILIO_DB_PATH: this.dbPath,
        ...(this.restarted ? { EMILIO_ENGINE_RESTARTED: '1' } : {}),
      } as Record<string, string>);
      this.proc = proc;
      proc.onMessage((msg) => {
        if ('event' in msg) {
          if (msg.event === 'live') this.onLive(msg.payload);
          if (msg.event === 'host') {
            const req = msg.payload as HostRequest;
            this.onHost(req).then(
              (err) =>
                proc.postMessage({
                  hostReply: { id: req.id, ok: !err, message: err || undefined },
                }),
              (e: unknown) =>
                proc.postMessage({
                  hostReply: { id: req.id, ok: false, message: (e as Error).message },
                }),
            );
          }
          if (msg.event === 'ready') {
            this.onReady({ request: (m, p) => this.send(m, p) }).then(resolveReady, rejectReady);
          }
          return;
        }
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve(msg.result);
        }
      });
      proc.onExit(() => {
        this.proc = null;
        const err = serializeError(new AppError('E_ENGINE'));
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.resolve({ ok: false, error: err });
        }
        this.pending.clear();
        if (!this.stopping) this.maybeRestart();
      });
    });
    return this.ready;
  }

  private maybeRestart(): void {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 10 * 60_000);
    if (this.restarts.length >= 3) return;
    this.restarts.push(now);
    this.restarted = true;
    void this.start();
  }

  async request<T>(method: EngineMethod, params?: unknown): Promise<Result<T>> {
    try {
      await this.ready;
    } catch (e) {
      return { ok: false, error: serializeError(e) };
    }
    return this.send<T>(method, params);
  }

  /** Envoi direct (sans attendre `ready`) : utilisé pour l'initialisation du moteur. */
  private send<T>(method: EngineMethod, params?: unknown): Promise<Result<T>> {
    const proc = this.proc;
    if (!proc)
      return Promise.resolve<Result<T>>({
        ok: false,
        error: serializeError(new AppError('E_ENGINE')),
      });
    return this.dispatch<T>(proc, method, params);
  }

  private dispatch<T>(
    proc: EngineProc,
    method: EngineMethod,
    params?: unknown,
  ): Promise<Result<T>> {
    const id = this.nextId++;
    const msg: EngineRequest = { id, method, params };
    return new Promise<Result<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: serializeError(new AppError('E_ENGINE', 'délai dépassé')) });
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (r: Result<unknown>) => void, timer });
      proc.postMessage(msg);
    });
  }

  stop(): void {
    this.stopping = true;
    this.proc?.kill();
  }
}
