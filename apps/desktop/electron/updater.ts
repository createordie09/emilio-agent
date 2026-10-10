import type { UpdateState } from '@emilio/shared';

/** Ce que l'on utilise d'`electron-updater` (injectable pour les tests). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, cb: (...a: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

/**
 * Mises à jour automatiques (CdC §19, `electron-updater` + releases GitHub). Actif seulement dans la version installée ;
 * la vérification de signature est faite par `electron-updater` quand l'installateur est signé.
 */
export class UpdateManager {
  private state: UpdateState;
  private listeners = new Set<(s: UpdateState) => void>();

  constructor(
    private readonly updater: UpdaterLike | null,
    private readonly enabled: boolean,
  ) {
    this.state = { status: enabled && updater ? 'idle' : 'inactive' };
    if (!updater || !enabled) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => this.set({ status: 'checking' }));
    updater.on('update-available', ((i: { version?: string }) =>
      this.set({ status: 'downloading', version: i?.version })) as never);
    updater.on('update-not-available', () => this.set({ status: 'idle' }));
    updater.on('update-downloaded', ((i: { version?: string }) =>
      this.set({ status: 'ready', version: i?.version })) as never);
    updater.on('error', (() =>
      this.set({
        status: 'error',
        message: 'La recherche de mise à jour a échoué. Vous pourrez réessayer plus tard.',
      })) as never);
  }

  private set(s: UpdateState): void {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  get(): UpdateState {
    return this.state;
  }

  onChange(cb: (s: UpdateState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async check(): Promise<UpdateState> {
    if (!this.updater || !this.enabled) return this.state;
    try {
      await this.updater.checkForUpdates();
    } catch {
      this.set({
        status: 'error',
        message: 'La recherche de mise à jour a échoué. Vous pourrez réessayer plus tard.',
      });
    }
    return this.state;
  }

  install(): boolean {
    if (this.state.status !== 'ready' || !this.updater) return false;
    this.updater.quitAndInstall();
    return true;
  }
}
