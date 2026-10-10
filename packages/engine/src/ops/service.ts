import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  AppError,
  DEFAULT_PREFS,
  type AppPrefs,
  type CostsView,
  type MissionArchiveInfo,
  type MissionSummary,
  type TechCallView,
} from '@emilio/shared';
import type { Db } from '../storage/db';
import { schemaVersion } from '../storage/db';
import type { SettingsRepo } from '../storage/settings';
import type { MissionRepo } from '../storage/missions';
import type { MissionRunner } from '../orchestrator/runner';
import type { EventJournal } from '../events/journal';
import type { MissionExecConfig } from '../llm/exec-config';
import type { ExportService } from '../export/service';
import type { EmbeddingAdapter } from '../kb/embeddings';
import { roleLabelFr } from '../agents/registry';
import { PRIVACY_DENY_KEY } from '../llm/openrouter';
import { exportMissionArchive, importMissionArchive } from './archive';
import { costsOf, techLogOf } from './costs';
import type { FileLogger } from './logger';

const KEYS: Record<keyof AppPrefs, string> = {
  autoResumeMissions: 'auto_resume_missions',
  notifications: 'notifications_enabled',
  preventSleep: 'prevent_sleep',
  denyDataCollection: PRIVACY_DENY_KEY,
  checkUpdates: 'check_updates',
  onboardingDone: 'onboarding_done',
};

export type OpsDeps = {
  db: Db;
  settings: SettingsRepo;
  missions: MissionRepo;
  runner: MissionRunner;
  journal: EventJournal;
  exporter: ExportService;
  embedder: () => EmbeddingAdapter;
  logger: FileLogger;
  dataDir: string;
  version: string;
};

/** Exploitation (CdC §6.6–6.9, §8.6, §18, J9) : préférences, coûts, budget, journaux, archives de mission. */
export class OpsService {
  constructor(private readonly d: OpsDeps) {}

  prefs(): AppPrefs {
    const out = { ...DEFAULT_PREFS };
    for (const k of Object.keys(KEYS) as (keyof AppPrefs)[]) {
      const v = this.d.settings.get<boolean>(KEYS[k]);
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  }

  setPrefs(patch: Partial<AppPrefs>): AppPrefs {
    for (const k of Object.keys(KEYS) as (keyof AppPrefs)[])
      if (typeof patch[k] === 'boolean') this.d.settings.set(KEYS[k], patch[k]);
    return this.prefs();
  }

  costs(missionId: string): CostsView {
    return costsOf(this.d.db, missionId, (r) =>
      r === 'local' ? 'Préparation locale' : roleLabelFr(r as never),
    );
  }

  techLog(missionId: string): TechCallView[] {
    return techLogOf(this.d.db, missionId);
  }

  /** Budget atteint (§8.6) : relève le plafond puis reprend. */
  raiseBudget(missionId: string, budgetUsd: number): MissionSummary {
    if (this.d.missions.status(missionId) !== 'paused_budget')
      throw new AppError('E_BAD_REQUEST', 'Cette mission n’a pas atteint son budget.');
    const spent = this.d.missions.costSpent(missionId);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= spent)
      throw new AppError(
        'E_BAD_REQUEST',
        `Le nouveau budget doit dépasser les ${spent.toFixed(2)} $ déjà dépensés.`,
      );
    const cfg = this.d.missions.config<MissionExecConfig>(missionId);
    this.d.missions.setConfig(missionId, { ...cfg, budgetMaxUsd: budgetUsd, budgetAlertsSent: [] });
    this.d.journal.record({
      missionId,
      level: 'info',
      messageFr: `Budget relevé à ${budgetUsd} $ : la mission reprend.`,
    });
    this.d.runner.resume(missionId);
    return this.d.missions.summary(missionId);
  }

  /**
   * Budget atteint (§8.6) : « passer directement à la finalisation (P8–P9) avec l'état actuel ».
   * Les tâches restantes de P3 à P7 sont abandonnées ; les livrables qui exigent encore le modèle (diaporama, fiche) sont signalés comme non produits.
   */
  finalizeNow(missionId: string): MissionSummary {
    if (this.d.missions.status(missionId) !== 'paused_budget')
      throw new AppError('E_BAD_REQUEST', 'Cette mission n’a pas atteint son budget.');
    const { db } = this.d;
    db.transaction(() => {
      db.prepare(
        "UPDATE tasks SET status='skipped', updated_at=? WHERE mission_id=? AND status IN ('pending','ready','blocked') AND phase IN ('P3','P4','P5','P6','P7')",
      ).run(new Date().toISOString(), missionId);
      const llm = db
        .prepare(
          "SELECT id, input_json FROM tasks WHERE mission_id=? AND status IN ('pending','ready','blocked') AND phase='P9'",
        )
        .all(missionId) as { id: string; input_json: string | null }[];
      for (const t of llm) {
        const h = (JSON.parse(t.input_json ?? '{}') as { handler?: string }).handler;
        if (h === 'p9.slides' || h === 'p9.fiche') {
          db.prepare("UPDATE tasks SET status='skipped' WHERE id=?").run(t.id);
          this.d.exporter.skipDeliverable(
            missionId,
            h === 'p9.slides' ? 'pptx' : 'fiche',
            'le budget est atteint (ce livrable exige le modèle d’IA).',
          );
        }
      }
    })();
    this.d.journal.record({
      missionId,
      level: 'info',
      messageFr:
        'Finalisation avec l’état actuel : les sections non rédigées seront signalées dans le document.',
    });
    // Le budget n'autorise plus aucun appel : les tâches restantes de P8–P9 sont locales.
    this.d.runner.resume(missionId);
    return this.d.missions.summary(missionId);
  }

  /** Zip des journaux pour l'assistance (§18) : fichiers de journal et informations techniques, sans clé ni documents. */
  exportLogs(destPath: string): void {
    const files: Record<string, Uint8Array> = {};
    const dir = this.d.logger.dir;
    if (existsSync(dir))
      for (const f of readdirSync(dir))
        if (f.startsWith('emilio.log'))
          files[`logs/${f}`] = new Uint8Array(readFileSync(join(dir, f)));
    const n = (t: string) =>
      (this.d.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    files['info.json'] = strToU8(
      JSON.stringify(
        {
          application: 'emilio agent',
          version: this.d.version,
          schema: schemaVersion(this.d.db),
          plateforme: process.platform,
          node: process.version,
          missions: n('missions'),
          generePar: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    writeFileSync(destPath, zipSync(files));
  }

  exportMission(missionId: string, destPath: string): MissionArchiveInfo {
    return exportMissionArchive(this.d.db, missionId, destPath);
  }

  importMission(srcPath: string): Promise<MissionArchiveInfo> {
    return importMissionArchive(this.d.db, this.d.dataDir, srcPath, this.d.embedder());
  }
}
