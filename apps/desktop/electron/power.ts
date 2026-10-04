import type { MissionStatus, MissionSummary } from '@emilio/shared';

/**
 * Garde anti-veille (CdC J9) : empêche la mise en veille de l'ordinateur tant qu'au moins une mission s'exécute.
 * Les fonctions `start` / `stop` sont celles de `powerSaveBlocker` d'Electron (injectées pour les tests).
 */
export class PowerGuard {
  private running = new Set<string>();
  private blockerId: number | null = null;
  constructor(
    private readonly start: () => number,
    private readonly stop: (id: number) => void,
    private readonly enabled: () => boolean = () => true,
  ) {}

  update(m: Pick<MissionSummary, 'id' | 'status'>): void {
    if (m.status === ('running' satisfies MissionStatus)) this.running.add(m.id);
    else this.running.delete(m.id);
    this.sync();
  }

  /** À appeler aussi quand la préférence change. */
  sync(): void {
    const want = this.enabled() && this.running.size > 0;
    if (want && this.blockerId === null) this.blockerId = this.start();
    else if (!want && this.blockerId !== null) {
      this.stop(this.blockerId);
      this.blockerId = null;
    }
  }

  get active(): boolean {
    return this.blockerId !== null;
  }
}
