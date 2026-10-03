import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test('sources documentaires : recherche de démonstration, source fantôme rejetée, fiche détaillée, réglages', async () => {
  const { app, page } = await launchApp();
  try {
    await page.evaluate(() => (location.hash = '#/parametres'));
    await page.getByRole('tab', { name: 'Apparence' }).click();
    await page.getByRole('switch', { name: 'Mode développeur' }).click();

    await page.evaluate(() => (location.hash = '#/missions'));
    await page.getByRole('button', { name: /Lancer une mission factice/ }).click();
    await expect(page).toHaveURL(/#\/missions\/.+/);

    await page.getByRole('button', { name: 'Recherche de démonstration' }).click();
    const list = page.getByRole('list', { name: 'Liste des sources' });
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list.getByText('Rejetée').first()).toBeVisible();

    await list.getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Fermer' }).first().click();

    await page.evaluate(() => (location.hash = '#/parametres'));
    await page.getByRole('tab', { name: 'Sources documentaires' }).click();
    await page.getByLabel('Adresse e-mail de contact').fill('test@example.org');
    await page.getByRole('button', { name: 'Tester les connexions' }).click();
    await expect(page.getByLabel(/^État de /).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.close();
  }
});
