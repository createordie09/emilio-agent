import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test('mission factice : événements en direct, pause crédit épuisé, reprise, fin — dans la vraie application', async () => {
  const { app, page } = await launchApp();
  try {
    // Mode développeur requis pour les outils de simulation.
    await page.evaluate(() => (location.hash = '#/parametres'));
    await page.getByRole('tab', { name: 'Apparence' }).click();
    await page.getByRole('switch', { name: 'Mode développeur' }).click();

    await page.evaluate(() => (location.hash = '#/missions'));
    await page.getByRole('button', { name: /Lancer une mission factice/ }).click();
    await expect(page).toHaveURL(/#\/missions\/.+/);

    // Flux en direct : des événements en français arrivent sans recharger la page.
    await expect(page.getByText('Plan validé : la mission démarre en autonomie.')).toBeVisible();
    await expect(page.getByText(/Phase P0 terminée/)).toBeVisible({ timeout: 15_000 });

    // Crédit épuisé simulé → pause automatique.
    await page.getByRole('button', { name: 'Crédit épuisé' }).click();
    await expect(page.getByText('Crédit épuisé', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Reprendre' })).toBeVisible();

    // Rechargement → reprise automatique puis fin de mission.
    await page.getByRole('button', { name: 'Recharger le crédit' }).click();
    await expect(page.getByText('Terminée', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('16 / 16')).toBeVisible();
    await expect(page.getByText('Mission terminée.').first()).toBeVisible();
  } finally {
    await app.close();
  }
});

test('les outils de simulation sont refusés hors mode développeur', async () => {
  const { app, page } = await launchApp();
  try {
    const r = await page.evaluate(() =>
      (
        window as unknown as {
          api: { missions: { createDemo(): Promise<{ ok: boolean; error?: { code: string } }> } };
        }
      ).api.missions.createDemo(),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('E_BAD_REQUEST');
  } finally {
    await app.close();
  }
});
