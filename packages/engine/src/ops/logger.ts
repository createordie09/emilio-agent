import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Journal technique en fichier rotatif (CdC §18) : transitions d'état, erreurs, appels de modèle (jamais la clé ni le contenu des prompts). */
export class FileLogger {
  private readonly file: string;
  constructor(
    readonly dir: string,
    private readonly maxBytes = 1_000_000,
    private readonly keep = 3,
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'emilio.log');
  }

  line(level: string, text: string): void {
    try {
      this.rotate();
      appendFileSync(
        this.file,
        `${new Date().toISOString()} ${level.toUpperCase().padEnd(7)} ${text.replace(/\s+/g, ' ')}\n`,
      );
    } catch {
      /* le journal ne doit jamais faire échouer l'application */
    }
  }

  private rotate(): void {
    if (!existsSync(this.file) || statSync(this.file).size < this.maxBytes) return;
    rmSync(`${this.file}.${this.keep}`, { force: true });
    for (let i = this.keep - 1; i >= 1; i--)
      if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
    renameSync(this.file, `${this.file}.1`);
  }
}
