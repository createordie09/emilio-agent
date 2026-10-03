import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

/** Interface abstraite de stockage de fichiers (CdC §4.6 `FileAdapter`). V1 : système de fichiers ; V2 : R2. */
export interface FileAdapter {
  copyIn(src: string, dest: string): Promise<{ sha256: string; size: number }>;
  write(path: string, content: string): Promise<void>;
  writeBuffer(path: string, content: Buffer): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): boolean;
  size(path: string): Promise<number>;
}

export class LocalFileAdapter implements FileAdapter {
  /** Copie en flux en calculant l'empreinte SHA-256 au passage (fichiers volumineux sans les charger en mémoire). */
  async copyIn(src: string, dest: string): Promise<{ sha256: string; size: number }> {
    await mkdir(dirname(dest), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _e, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });
    await pipeline(createReadStream(src), tap, createWriteStream(dest));
    return { sha256: hash.digest('hex'), size };
  }
  async write(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  async writeBuffer(path: string, content: Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }
  exists(path: string): boolean {
    return existsSync(path);
  }
  async size(path: string): Promise<number> {
    return (await stat(path)).size;
  }
}
