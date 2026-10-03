import { join } from 'node:path';
import type { IngestService } from '../kb/ingest';
import { extractText } from '../kb/extract';
import type { FileAdapter } from '../storage/file-adapter';
import type { SourceHttp } from '../sources/http';
import type { SourceConnector } from '../sources/types';

export type FullTextOutcome = {
  status: 'fulltext' | 'abstract_only' | 'none';
  chunks: number;
  pages?: number;
  pdfUrl?: string;
  /** Raison du repli (affichée dans le rapport de mission). */
  reasonFr?: string;
};

export type FullTextDeps = {
  http: Pick<SourceHttp, 'download'>;
  ingest: Pick<IngestService, 'indexPages'>;
  files: FileAdapter;
  dataDir: string;
  /** Connecteurs capables de donner les emplacements en accès ouvert d'un DOI (Unpaywall, OpenAlex…). */
  oaProviders: SourceConnector[];
  maxBytes?: number;
  /** Nombre maximal de PDF essayés par source. */
  maxAttempts?: number;
};

const looksLikePdf = (b: Buffer): boolean =>
  b.subarray(0, 1024).toString('latin1').includes('%PDF-');

/**
 * Texte intégral en accès ouvert (CdC §9 P3.4) : PDF direct de la notice, puis emplacements Unpaywall / OpenAlex.
 * Le PDF est téléchargé, vérifié (signature %PDF, taille), lu, découpé et indexé. Un PDF scanné ou illisible est écarté.
 * À défaut, le résumé est indexé seul (`abstract_only`) pour que la source reste ancrable.
 */
export async function acquireFullText(
  deps: FullTextDeps,
  missionId: string,
  src: { id: string; title: string; doi?: string; oaPdfUrl?: string; abstract?: string },
  signal?: AbortSignal,
): Promise<FullTextOutcome> {
  const urls: string[] = [];
  const add = (u?: string) => u && !urls.includes(u) && urls.push(u);
  add(src.oaPdfUrl);
  if (src.doi) {
    for (const p of deps.oaProviders) {
      if (!p.openAccess) continue;
      try {
        for (const l of await p.openAccess(src.doi)) add(l.pdfUrl);
      } catch {
        /* un fournisseur indisponible n'empêche pas d'essayer les autres */
      }
    }
  }
  const reasons: string[] = [];
  const path = join(deps.dataDir, 'missions', missionId, 'sources', `${src.id}.pdf`);
  for (const url of urls.slice(0, deps.maxAttempts ?? 3)) {
    try {
      const buf = await deps.http.download(url, deps.maxBytes ?? 50 * 1024 * 1024, signal);
      if (!looksLikePdf(buf)) {
        reasons.push('le lien ne renvoie pas un PDF');
        continue;
      }
      await deps.files.writeBuffer(path, buf);
      const doc = await extractText(path, `${src.id}.pdf`);
      if (doc.scanned || !doc.pages.some((p) => p.text.trim())) {
        await deps.files.remove(path);
        reasons.push('PDF sans texte exploitable (scanné)');
        continue;
      }
      const { chunks } = await deps.ingest.indexPages(missionId, src.id, doc.pages);
      return { status: 'fulltext', chunks, pages: doc.pages.length, pdfUrl: url };
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      await deps.files.remove(path).catch(() => undefined);
      reasons.push((e as { detail?: string; message: string }).detail ?? (e as Error).message);
    }
  }
  if (src.abstract) {
    const { chunks } = await deps.ingest.indexPages(missionId, src.id, [
      { page: null, text: src.abstract },
    ]);
    return {
      status: 'abstract_only',
      chunks,
      reasonFr: reasons.length
        ? `Texte intégral indisponible (${reasons[0]}) : résumé seul`
        : 'Aucun texte intégral en accès ouvert : résumé seul',
    };
  }
  return { status: 'none', chunks: 0, reasonFr: reasons[0] ?? 'Aucun texte disponible' };
}
