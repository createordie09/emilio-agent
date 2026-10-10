// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { MissionStatus, MissionSummary } from '@emilio/shared';
import { noticeFor, StatusWatcher } from '../electron/notifier';
import { PowerGuard } from '../electron/power';
import { UpdateManager, type UpdaterLike } from '../electron/updater';

const mission = (status: MissionStatus, id = 'm1'): MissionSummary =>
  ({ id, title: 'Microfinance au Bénin', status }) as MissionSummary;

describe('notifications système (§6.9)', () => {
  it('plan prêt, terminée, pauses (crédit, réseau, budget), erreur : tout en français', () => {
    const n = (s: MissionStatus) => noticeFor('running', mission(s));
    expect(n('awaiting_plan_validation')?.title).toBe('Plan prêt');
    expect(n('completed')?.title).toBe('Mission terminée');
    expect(n('paused_no_credit')?.body).toMatch(/Crédit OpenRouter épuisé/);
    expect(n('paused_network')?.body).toMatch(/Connexion Internet perdue/);
    expect(n('paused_budget')?.title).toBe('Budget atteint');
    expect(n('failed')?.title).toBe('Erreur');
    expect(n('running')).toBeNull();
    expect(n('cancelled')).toBeNull();
    expect(noticeFor('completed', mission('completed'))).toBeNull(); // pas de répétition
  });

  it('le premier événement d’une mission déjà connue ne notifie pas ; un changement oui', () => {
    const w = new StatusWatcher();
    w.seed([mission('running')]);
    expect(w.update(mission('running'))).toBeNull();
    expect(w.update(mission('completed'))?.title).toBe('Mission terminée');
    expect(w.update(mission('completed'))).toBeNull();
    expect(w.update(mission('completed', 'm2'))).toBeNull(); // mission inconnue : état initial
  });
});

describe('garde anti-veille', () => {
  it('actif tant qu’une mission s’exécute, relâché ensuite, respecte la préférence', () => {
    let next = 1;
    const started: number[] = [];
    const stopped: number[] = [];
    let enabled = true;
    const g = new PowerGuard(
      () => {
        started.push(next);
        return next++;
      },
      (id) => stopped.push(id),
      () => enabled,
    );
    g.update({ id: 'a', status: 'running' });
    g.update({ id: 'b', status: 'running' });
    expect(started).toEqual([1]);
    expect(g.active).toBe(true);
    g.update({ id: 'a', status: 'paused' });
    expect(g.active).toBe(true);
    g.update({ id: 'b', status: 'completed' });
    expect(stopped).toEqual([1]);
    expect(g.active).toBe(false);
    enabled = false;
    g.update({ id: 'c', status: 'running' });
    expect(g.active).toBe(false);
    enabled = true;
    g.sync();
    expect(g.active).toBe(true);
  });
});

describe('mises à jour automatiques (§19)', () => {
  function fake() {
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const calls = { check: 0, install: 0 };
    const u: UpdaterLike = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: (e, cb) => void handlers.set(e, cb as (...a: unknown[]) => void),
      checkForUpdates: async () => void calls.check++,
      quitAndInstall: () => void calls.install++,
    };
    return { u, handlers, calls };
  }

  it('inactif hors version installée', async () => {
    const m = new UpdateManager(null, false);
    expect(m.get().status).toBe('inactive');
    expect((await m.check()).status).toBe('inactive');
    expect(m.install()).toBe(false);
  });

  it('cycle : vérification → disponible → téléchargée → installation', async () => {
    const { u, handlers, calls } = fake();
    const m = new UpdateManager(u, true);
    const seen: string[] = [];
    m.onChange((s) => seen.push(s.status));
    expect(u.autoDownload).toBe(true);
    await m.check();
    expect(calls.check).toBe(1);
    handlers.get('checking-for-update')!();
    handlers.get('update-available')!({ version: '1.2.0' });
    expect(m.install()).toBe(false); // pas encore téléchargée
    handlers.get('update-downloaded')!({ version: '1.2.0' });
    expect(m.get()).toEqual({ status: 'ready', version: '1.2.0' });
    expect(m.install()).toBe(true);
    expect(calls.install).toBe(1);
    expect(seen).toEqual(['checking', 'downloading', 'ready']);
  });

  it('une erreur réseau donne un message clair, sans casser l’application', async () => {
    const { u, handlers } = fake();
    u.checkForUpdates = async () => {
      throw new Error('ENOTFOUND');
    };
    const m = new UpdateManager(u, true);
    const s = await m.check();
    expect(s.status).toBe('error');
    expect(s.message).toMatch(/mise à jour/);
    handlers.get('update-not-available')!();
    expect(m.get().status).toBe('idle');
  });
});
