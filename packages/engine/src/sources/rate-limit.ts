/** Limiteur à jetons (CdC §11.1 : limitation de débit par connecteur). Horloge et attente injectables pour les tests. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly ratePerSecond: number,
    private readonly burst = 1,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.tokens = burst;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSecond);
    this.last = t;
  }

  /** Attend qu'un jeton soit disponible. Les appels concurrents sont servis dans l'ordre. */
  private queue: Promise<void> = Promise.resolve();
  acquire(): Promise<void> {
    const run = async () => {
      this.refill();
      while (this.tokens < 1) {
        await this.sleep(Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000));
        this.refill();
      }
      this.tokens -= 1;
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
