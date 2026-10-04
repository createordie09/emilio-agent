import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test('isolation du renderer, moteur, clé, modèles, thème', async () => {
  const { app, page } = await launchApp();
  try {
    // Isolation (CdC §19) : ni Node ni ipcRenderer dans la page, seule window.api existe.
    const iso = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      api: Object.keys((window as unknown as { api: object }).api).sort(),
    }));
    expect(iso.require).toBe('undefined');
    expect(iso.process).toBe('undefined');
    expect(iso.api).toEqual([
      'app',
      'catalog',
      'drafts',
      'engine',
      'exports',
      'files',
      'key',
      'missions',
      'models',
      'onEvent',
      'plan',
      'sources',
      'ui',
      'writing',
    ]);

    await expect(page.getByRole('heading', { name: 'Bonjour !' })).toBeVisible();

    // Paramètres → À propos : le moteur répond (utilityProcess / IPC / SQLite migré).
    await page.evaluate(() => (location.hash = '#/parametres'));
    await page.getByRole('tab', { name: 'À propos' }).click();
    await expect(page.getByText(/En marche · v0\.8\.0 · base v7/)).toBeVisible();

    // Clé : enregistrement (chiffré), jamais renvoyée en clair.
    await page.getByRole('tab', { name: 'Clé et modèles' }).click();
    await page.getByLabel('Clé OpenRouter').fill('sk-or-v1-e2e-cle-factice-0123456789abcd');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/Clé enregistrée : sk-or-v1…abcd/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('cle-factice-0123456789');

    // Test réel auprès d'OpenRouter (via le moteur).
    await expect(page.getByText('Connexion établie')).toBeVisible({ timeout: 45_000 });

    // Liste des modèles réelle.
    await expect(page.getByText(/modèles · liste/)).toBeVisible({ timeout: 45_000 });
    await page.getByPlaceholder('Rechercher un modèle').fill('claude');
    await expect(page.locator('tbody tr').first()).toBeVisible();

    // Thème sombre persistant.
    await page.getByRole('tab', { name: 'Apparence' }).click();
    await page.getByRole('radio', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  } finally {
    await app.close();
  }
});

test('la page /design est masquée hors mode développeur', async () => {
  const { app, page } = await launchApp();
  try {
    await page.evaluate(() => (location.hash = '#/design'));
    await expect(page.getByRole('heading', { name: 'Bonjour !' })).toBeVisible();
    await page.evaluate(() => (location.hash = '#/parametres'));
    await page.getByRole('tab', { name: 'Apparence' }).click();
    await page.getByRole('switch', { name: 'Mode développeur' }).click();
    await page.evaluate(() => (location.hash = '#/design'));
    await expect(page.getByRole('heading', { name: 'Design system' }).first()).toBeVisible();
  } finally {
    await app.close();
  }
});
