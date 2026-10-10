// Télécharge le modèle d'embeddings local (CdC §4.1, ADR-017) dans resources/models/multilingual-e5-small.
// À lancer une fois sur votre machine (accès à huggingface.co requis) :   pnpm models:fetch
// Le modèle est ensuite embarqué dans l'installateur (ENF-05 : < 400 Mo au total) et lu hors ligne.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPO = process.env.EMILIO_EMBEDDING_REPO ?? 'Xenova/multilingual-e5-small';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../resources/models/multilingual-e5-small',
);
const HF = 'https://huggingface.co';

/** Fichiers nécessaires à Transformers.js : configuration, tokenizer, et UN modèle ONNX (quantifié de préférence). */
export function selectFiles(siblings) {
  const names = siblings.map((s) => s.rfilename);
  const need = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
  ].filter((f) => names.includes(f));
  const onnx = names.includes('onnx/model_quantized.onnx')
    ? 'onnx/model_quantized.onnx'
    : names.includes('onnx/model.onnx')
      ? 'onnx/model.onnx'
      : null;
  if (!need.includes('config.json') || !need.includes('tokenizer.json') || !onnx) {
    throw new Error(
      `Dépôt ${REPO} inattendu : config.json, tokenizer.json ou fichier ONNX introuvable.`,
    );
  }
  return [...need, onnx];
}

async function main() {
  const meta = await fetch(`${HF}/api/models/${REPO}`);
  if (!meta.ok) throw new Error(`Impossible de lire ${REPO} (HTTP ${meta.status}).`);
  const info = await meta.json();
  const files = selectFiles(info.siblings ?? []);
  const sums = [];
  for (const f of files) {
    const dest = join(OUT, f);
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest) && statSync(dest).size > 0) {
      console.log(`déjà présent : ${f}`);
    } else {
      const r = await fetch(`${HF}/${REPO}/resolve/main/${f}`);
      if (!r.ok || !r.body) throw new Error(`Échec du téléchargement de ${f} (HTTP ${r.status}).`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
      console.log(`téléchargé : ${f} (${(statSync(dest).size / 1048576).toFixed(1)} Mo)`);
    }
    const h = createHash('sha256');
    await pipeline((await import('node:fs')).createReadStream(dest), h);
    sums.push(`${h.digest('hex')}  ${f}`);
  }
  writeFileSync(join(OUT, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log(
    `\nModèle prêt dans ${OUT}\nVérifiez la taille totale et la licence du modèle avant de l'embarquer (docs/DECISIONS.md, ADR-017).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
