import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Interface abstraite (CdC §4.6 `EmbeddingAdapter`). V1 : Transformers.js local ; V2 : Workers AI. */
export interface EmbeddingAdapter {
  readonly modelId: string;
  readonly dim: number;
  /** `true` si le vrai modèle sémantique est chargé ; `false` pour l'embeddeur de repli (lexical). */
  readonly semantic: boolean;
  embedPassages(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export const EMBEDDING_DIM = 384;

const FOLD = /[̀-ͯ]/g;
export const foldText = (s: string): string => s.normalize('NFD').replace(FOLD, '').toLowerCase();

function fnv1a(s: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Embeddeur de repli déterministe (« hashing trick » sur mots et bigrammes, sans accents ni casse).
 * Aucun modèle, aucun réseau : sert aux tests et de secours si le modèle local est absent.
 * Il capture la proximité LEXICALE, pas sémantique : la recherche reste utile grâce au BM25.
 */
export class HashEmbedder implements EmbeddingAdapter {
  readonly modelId = 'repli-lexical-hash';
  readonly dim = EMBEDDING_DIM;
  readonly semantic = false;

  private vec(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    const toks = foldText(text)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
    const add = (feat: string, w: number) => {
      const h = fnv1a(feat);
      v[h % this.dim]! += (fnv1a(feat, 99) & 1 ? 1 : -1) * w;
    };
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) add(t, 1 + Math.log(n));
    for (let i = 0; i + 1 < toks.length; i++) add(`${toks[i]} ${toks[i + 1]}`, 0.5);
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm) as Float32Array;
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.vec(t));
  }
  async embedQuery(text: string): Promise<Float32Array> {
    return this.vec(text);
  }
}

type FeaturePipeline = (
  texts: string[],
  o: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Embeddeur sémantique local (Transformers.js + ONNX, hors ligne, CdC §4.1).
 * Modèle `multilingual-e5-small` : préfixes « passage: » / « query: » requis par la famille E5.
 * Le dossier du modèle est lu localement (`allowRemoteModels = false`) : aucun téléchargement à l'exécution.
 */
export class TransformersEmbedder implements EmbeddingAdapter {
  readonly dim = EMBEDDING_DIM;
  readonly semantic = true;
  private pipe: Promise<FeaturePipeline> | null = null;

  constructor(private readonly modelDir: string) {}

  get modelId(): string {
    return basename(this.modelDir);
  }

  private load(): Promise<FeaturePipeline> {
    this.pipe ??= (async () => {
      const t = await import('@huggingface/transformers');
      t.env.allowRemoteModels = false;
      t.env.allowLocalModels = true;
      t.env.localModelPath = dirname(this.modelDir);
      return (await t.pipeline('feature-extraction', basename(this.modelDir), {
        dtype: 'q8',
      })) as unknown as FeaturePipeline;
    })();
    return this.pipe;
  }

  private async run(texts: string[], prefix: string): Promise<Float32Array[]> {
    const pipe = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 8) {
      const batch = texts.slice(i, i + 8).map((t) => prefix + t);
      const r = await pipe(batch, { pooling: 'mean', normalize: true });
      for (const row of r.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }

  embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.run(texts, 'passage: ');
  }
  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.run([text], 'query: '))[0]!;
  }
}

export const EMBEDDING_MODEL_DIRNAME = 'multilingual-e5-small';

/** Modèle local présent ? (config + tokenizer + au moins un fichier ONNX) */
export function embeddingModelAvailable(modelsDir: string): boolean {
  const d = join(modelsDir, EMBEDDING_MODEL_DIRNAME);
  return (
    existsSync(join(d, 'config.json')) &&
    existsSync(join(d, 'tokenizer.json')) &&
    existsSync(join(d, 'onnx'))
  );
}

/** Choisit le vrai modèle s'il est installé, sinon le repli lexical (signalé à l'utilisateur). */
export function resolveEmbedder(modelsDir?: string): EmbeddingAdapter {
  if (modelsDir && embeddingModelAvailable(modelsDir)) {
    return new TransformersEmbedder(join(modelsDir, EMBEDDING_MODEL_DIRNAME));
  }
  return new HashEmbedder();
}
