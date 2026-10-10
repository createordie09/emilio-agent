// Génère build/icon.png (512 px) depuis build/icon.svg : icône provisoire (identité définitive : CdC §23.8).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../build');
const png = new Resvg(readFileSync(join(dir, 'icon.svg')), { fitTo: { mode: 'width', value: 512 } })
  .render()
  .asPng();
writeFileSync(join(dir, 'icon.png'), png);
console.log('build/icon.png écrit');
