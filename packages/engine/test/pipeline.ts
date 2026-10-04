import { expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultBrief, type BriefDraft, type SectionDraftSummary } from '@emilio/shared';
import {
  EngineService,
  HashEmbedder,
  MockLlmClient,
  researchMockRespond,
  planningMockRespond,
  writingMockRespond,
  juryMockRespond,
  exportMockRespond,
  type PdfAdapter,
  type LlmRequest,
} from '../src';

export const RES = join(__dirname, '../../../resources');
export const FX = (f: string) => join(__dirname, 'fixtures', f);
export type Respond = (req: LlmRequest) => string | undefined;
export const base: Respond = (r) =>
  researchMockRespond(r) ??
  planningMockRespond(r) ??
  writingMockRespond(r) ??
  juryMockRespond(r) ??
  exportMockRespond(r);

export type Opts = {
  withJury?: boolean;
  /** P8 / P9 (mise en forme et livrables) : ignorées par défaut. */
  withExport?: boolean;
  pdf?: PdfAdapter;
  brief?: BriefDraft;
  respond?: Respond;
  data?: boolean;
  delayMs?: number;
  setup?: (e: EngineService) => void;
};

/** Mission simulée complète : brief → plan validé → exécution jusqu'à la fin (P3, P4, P5). */
export async function runMission(o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'emilio-w-'));
  const respond = o.respond ?? base;
  const mock = new MockLlmClient({
    delayMs: o.delayMs ?? 0,
    costPerCallUsd: 0.002,
    respond: (r) => respond(r) ?? base(r),
  });
  const engine = new EngineService({
    dbPath: join(dir, 'e.db'),
    dataDir: dir,
    embedder: new HashEmbedder(),
    mock,
    presetsPath: join(RES, 'presets.json'),
    normsProfilesPath: join(RES, 'norms-profiles.json'),
    qualityWeightsPath: join(RES, 'quality-weights.json'),
    resourcesDir: RES,
    runner: { tickMs: 5 },
    ...(o.pdf ? { pdf: o.pdf } : {}),
  });
  const brief: BriefDraft = {
    ...defaultBrief('memoire_master'),
    discipline: 'Sciences de gestion',
    titre: 'Microfinance et inclusion financière au Bénin',
    problematique: 'Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière ?',
    approche: o.data ? 'quantitative' : 'documentaire',
    hypotheses: [
      'Le crédit solidaire améliore l’accès au crédit.',
      'Les femmes remboursent mieux.',
    ],
    motsCles: ['microfinance', 'inclusion financière'],
    execution: { ...defaultBrief().execution!, preset: 'equilibre', budgetMaxUsd: 12 },
    profilNormesId: 'afrique-francophone-standard',
    ...o.brief,
  };
  const d = engine.drafts.create({ workType: 'memoire_master' });
  engine.drafts.save(d.id, brief);
  if (o.data) {
    await engine.ingest.add(d.id, [{ path: FX('donnees-enquete.csv'), kind: 'field_data' }]);
    await engine.ingest.idle();
  }
  await engine.drafts.finalize(d.id, { confirmNoFieldData: true });
  await engine.handle('setLlmMode', { id: d.id, simulated: true });
  o.setup?.(engine);
  await engine.handle('generatePlan', { id: d.id });
  await engine.planning.idle();
  const v = await engine.handle('validatePlan', { id: d.id });
  expect(v.ok).toBe(true);
  // Les tests de la rédaction (J6) s'arrêtent après P5 ; ceux du jury (J7) passent `withJury` ; ceux des livrables (J8) `withExport`.
  if (!o.withJury)
    engine.db
      .prepare("UPDATE tasks SET status='skipped' WHERE mission_id=? AND phase IN ('P6','P7')")
      .run(d.id);
  if (!o.withExport)
    engine.db
      .prepare("UPDATE tasks SET status='skipped' WHERE mission_id=? AND phase IN ('P8','P9')")
      .run(d.id);
  const summary = await engine.runner.runUntilSettled(d.id, 6000);
  return { engine, mock, id: d.id, summary };
}
export const ask = async <T>(
  e: EngineService,
  m: Parameters<EngineService['handle']>[0],
  p: object,
) => {
  const r = await e.handle(m, p);
  if (!r.ok) throw new Error(r.error.messageFr + (r.error.detail ?? ''));
  return r.value as T;
};
export const drafts = (e: EngineService, id: string) =>
  ask<SectionDraftSummary[]>(e, 'listSectionDrafts', { id });
