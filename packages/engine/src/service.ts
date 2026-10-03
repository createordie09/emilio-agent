import {
  AppError,
  serializeError,
  type EngineMethod,
  type EnginePing,
  type Result,
} from '@emilio/shared';
import { openDatabase, schemaVersion, type Db } from './storage/db';
import { SettingsRepo } from './storage/settings';
import {
  OpenRouterClient,
  DEFAULT_OPENROUTER_CONFIG,
  type FetchLike,
  type OpenRouterConfig,
} from './llm/openrouter';

export const ENGINE_VERSION = '0.1.0';

export type EngineOptions = {
  dbPath: string;
  fetch?: FetchLike;
  openrouter?: Partial<OpenRouterConfig>;
};

/** Façade du moteur : indépendante d'Electron (CdC §4.6), pilotée par le process utilitaire ou par les tests. */
export class EngineService {
  readonly db: Db;
  readonly settings: SettingsRepo;
  readonly llm: OpenRouterClient;

  constructor(opts: EngineOptions) {
    this.db = openDatabase(opts.dbPath);
    this.settings = new SettingsRepo(this.db);
    this.llm = new OpenRouterClient(this.settings, opts.fetch, {
      ...DEFAULT_OPENROUTER_CONFIG,
      ...opts.openrouter,
    });
  }

  ping(): EnginePing {
    return { ok: true, engineVersion: ENGINE_VERSION, schemaVersion: schemaVersion(this.db) };
  }

  /** Point d'entrée unique des requêtes main → moteur. */
  async handle(method: EngineMethod, params: unknown): Promise<Result<unknown>> {
    try {
      return { ok: true, value: await this.dispatch(method, params) };
    } catch (e) {
      return { ok: false, error: serializeError(e) };
    }
  }

  private async dispatch(method: EngineMethod, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'ping':
        return this.ping();
      case 'getSetting':
        return this.settings.get(String(p.key)) ?? null;
      case 'setSetting':
        this.settings.set(String(p.key), p.value);
        return null;
      case 'deleteSetting':
        this.settings.delete(String(p.key));
        return null;
      case 'setApiKey':
        this.llm.setApiKey((p.key as string | null) ?? null);
        return null;
      case 'testKey':
        return this.llm.testKey();
      case 'listModels':
        return this.llm.listModels({ refresh: Boolean(p.refresh) });
      default:
        throw new AppError('E_INTERNAL', `Méthode inconnue : ${String(method)}`);
    }
  }

  close(): void {
    this.db.close();
  }
}
