import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_ROLES,
  AppError,
  BriefDraftSchema,
  BriefSchema,
  defaultBrief,
  needsFieldDataWarning,
  type BriefDraft,
  type DraftDetail,
  type DraftSummary,
  type FinalizeOptions,
  type MissionSummary,
  type WorkType,
} from '@emilio/shared';
import type { Db } from '../storage/db';
import { nowIso } from '../storage/db';
import type { MissionRepo } from '../storage/missions';
import type { IngestService } from '../kb/ingest';
import type { KbStore } from '../kb/store';
import type { MissionExecConfig } from '../llm/exec-config';
import type { PresetInfo } from '@emilio/shared';
import type { EventJournal } from '../events/journal';

type Row = {
  id: string;
  title: string;
  status: string;
  brief_json: string | null;
  updated_at: string;
};

/** Brouillons de mission de l'assistant « Nouvelle mission » : enregistrement automatique, import de fichiers, validation finale (§6.4, §7). */
export class DraftService {
  constructor(
    private readonly db: Db,
    private readonly missions: MissionRepo,
    private readonly ingest: IngestService,
    private readonly store: KbStore,
    private readonly journal: EventJournal,
    private readonly dataDir: string,
    private readonly presets: () => PresetInfo[],
  ) {}

  private row(id: string): Row {
    const r = this.db
      .prepare('SELECT id,title,status,brief_json,updated_at FROM missions WHERE id=?')
      .get(id) as Row | undefined;
    if (!r) throw new AppError('E_INTERNAL', `Brouillon introuvable : ${id}`);
    return r;
  }

  private editable(id: string): Row {
    const r = this.row(id);
    if (r.status !== 'draft')
      throw new AppError('E_BAD_REQUEST', 'Cette mission n’est plus un brouillon');
    return r;
  }

  private brief(r: Row): BriefDraft {
    return r.brief_json ? (JSON.parse(r.brief_json) as BriefDraft) : {};
  }

  list(): DraftSummary[] {
    return (
      this.db
        .prepare(
          "SELECT id,title,status,brief_json,updated_at FROM missions WHERE status='draft' ORDER BY updated_at DESC, id DESC",
        )
        .all() as Row[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      workType: this.brief(r).workType ?? null,
      updatedAt: r.updated_at,
    }));
  }

  create(opts: { workType?: WorkType; titre?: string } = {}): DraftDetail {
    const brief: BriefDraft = {
      ...defaultBrief(opts.workType),
      ...(opts.titre ? { titre: opts.titre } : {}),
    };
    const id = this.missions.create({
      title: opts.titre?.trim() || 'Nouveau brouillon',
      status: 'draft',
    });
    this.db
      .prepare('UPDATE missions SET brief_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(brief), nowIso(), id);
    return this.get(id);
  }

  get(id: string): DraftDetail {
    const r = this.row(id);
    return {
      id,
      status: r.status,
      brief: this.brief(r),
      files: this.ingest.list(id),
      updatedAt: r.updated_at,
    };
  }

  /** Enregistrement automatique : le brouillon peut être incomplet, mais jamais invalide. */
  save(id: string, patch: BriefDraft): DraftDetail {
    const r = this.editable(id);
    const parsed = BriefDraftSchema.safeParse({ ...this.brief(r), ...patch });
    if (!parsed.success) {
      throw new AppError(
        'E_BAD_REQUEST',
        parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; '),
      );
    }
    const title = parsed.data.titre?.trim() || 'Nouveau brouillon';
    this.db
      .prepare('UPDATE missions SET brief_json=?, title=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(parsed.data), title, nowIso(), id);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    this.editable(id);
    await this.ingest.idle();
    for (const f of this.ingest.list(id)) await this.ingest.remove(id, f.id);
    this.db.prepare('DELETE FROM missions WHERE id=?').run(id);
    await rm(join(this.dataDir, 'missions', id), { recursive: true, force: true });
  }

  /**
   * Validation finale (§6.4 étape 7) : brief complet, fichiers traités, confirmation de l'absence de données
   * de terrain (§7.3), modèles de tous les rôles. La mission passe de `draft` à `briefing`.
   */
  async finalize(id: string, opts: FinalizeOptions = {}): Promise<MissionSummary> {
    const r = this.editable(id);
    await this.ingest.idle();
    const parsed = BriefSchema.safeParse(this.brief(r));
    if (!parsed.success) {
      throw new AppError(
        'E_BAD_REQUEST',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'brief'} : ${i.message}`).join(' ; '),
      );
    }
    const brief = parsed.data;
    const files = this.ingest.list(id);
    const busy = files.filter((f) => ['pending', 'parsing', 'indexing'].includes(f.status));
    if (busy.length)
      throw new AppError(
        'E_BAD_REQUEST',
        `Traitement en cours : ${busy.map((f) => f.filename).join(', ')}`,
      );

    const fieldFiles = files.filter((f) => f.kind === 'field_data' && f.status !== 'error').length;
    if (needsFieldDataWarning(brief, fieldFiles) && !opts.confirmNoFieldData) {
      throw new AppError(
        'E_BAD_REQUEST',
        'Confirmation requise : aucune donnée de terrain importée',
      );
    }

    const ex = brief.execution;
    const preset = this.presets().find((p) => p.id === ex?.preset);
    const models = (ex?.models && Object.keys(ex.models).length ? ex.models : preset?.models) as
      MissionExecConfig['models'] | undefined;
    const missingRoles = AGENT_ROLES.filter((role) => !models?.[role]);
    if (!models || missingRoles.length) {
      throw new AppError('E_BAD_REQUEST', `Modèles manquants pour : ${missingRoles.join(', ')}`);
    }
    if (!ex?.budgetMaxUsd) throw new AppError('E_BAD_REQUEST', 'Budget maximal requis');

    const config: MissionExecConfig = {
      llmMode: 'real',
      models,
      budgetMaxUsd: ex.budgetMaxUsd,
      parallelism: ex.parallelism,
    };
    this.db.transaction(() => {
      this.missions.setConfig(id, config);
      this.db
        .prepare('UPDATE missions SET title=?, norms_profile_id=?, updated_at=? WHERE id=?')
        .run(brief.titre, brief.profilNormesId ?? null, nowIso(), id);
      this.missions.transition(id, 'briefing', {
        reason:
          `Brief enregistré : ${files.length} fichier(s), ${this.store.count(id).chunks} extrait(s) indexé(s).` +
          (fieldFiles === 0 && needsFieldDataWarning(brief, 0)
            ? ' Sans données de terrain : le chapitre résultats sera limité (emplacements « DONNÉES À INSÉRER »).'
            : ''),
      });
    })();
    this.journal.record({
      missionId: id,
      level: 'info',
      messageFr: 'Vous pouvez maintenant générer le plan de la mission.',
    });
    return this.missions.summary(id);
  }
}
