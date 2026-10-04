import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBriefedMission, enableDevMode, launchApp } from './helpers';

test('onboarding : confidentialité, charte obligatoire, réglage conservé', async () => {
  const { app, page } = await launchApp({ onboarding: true });
  try {
    const dlg = page.getByRole('dialog', { name: 'Bienvenue' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('n’invente jamais');
    await dlg.getByRole('button', { name: 'Continuer' }).click();
    await expect(dlg.getByRole('region', { name: 'Confidentialité' })).toContainText(
      'extraits de texte',
    );
    await expect(dlg.getByRole('link', { name: /confidentialité d’OpenRouter/ })).toBeVisible();
    await dlg.getByRole('switch', { name: /Refuser les fournisseurs/ }).click();
    await dlg.getByRole('button', { name: 'Continuer' }).click();
    await expect(dlg.getByRole('region', { name: 'Clé OpenRouter' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Continuer' }).click();
    // La charte doit être acceptée pour continuer.
    await expect(dlg.getByRole('button', { name: 'Commencer' })).toBeDisabled();
    await dlg.getByRole('checkbox', { name: /J’ai lu la charte/ }).click();
    await dlg.getByRole('button', { name: 'Commencer' }).click();
    await expect(dlg).toBeHidden();

    await page.evaluate(() => (location.hash = '#/parametres'));
    await page.getByRole('tab', { name: 'Missions et confidentialité' }).click();
    await expect(page.getByRole('switch', { name: /Refuser les fournisseurs/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('switch', { name: /Reprendre les missions automatiquement/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('switch', { name: /Notifications du système/ }).click();
    await expect(page.getByRole('switch', { name: /Notifications du système/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Mises à jour : inactives hors version installée.
    await page.getByRole('tab', { name: 'À propos' }).click();
    await expect(page.getByText(/ne sont actives que dans la version installée/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rechercher une mise à jour' })).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('budget atteint : finaliser avec l’état actuel, coûts, journal technique, export puis import de la mission', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'emilio-ops-'));
  const archive = join(dir, 'mission.emilio');
  const first = await launchApp();
  try {
    const { app, page } = first;
    await enableDevMode(page);
    await createBriefedMission(page, { budget: '0.06' });
    await page.getByRole('switch', { name: /Mode simulé/ }).click();
    await page.getByRole('button', { name: 'Générer le plan' }).click();
    await page.getByRole('button', { name: 'Examiner le plan' }).click({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Valider le plan et lancer la mission' }).click();

    const banner = page.getByRole('region', { name: 'Budget atteint' });
    await expect(banner).toBeVisible({ timeout: 90_000 });
    await expect(banner).toContainText('La mission est en pause');
    await banner.getByRole('button', { name: 'Finaliser avec l’état actuel' }).click();
    await expect(page.getByText('Mission terminée.').first()).toBeVisible({ timeout: 90_000 });

    // Fin de mission : résumé, points d'attention (sections non rédigées), diaporama non produit faute de budget.
    await page.getByRole('tab', { name: 'Livrables' }).click();
    const liv = page.getByRole('region', { name: 'Livrables' });
    await expect(
      liv
        .getByRole('group', { name: 'Résumé de la mission' })
        .or(liv.getByLabel('Résumé de la mission')),
    ).toContainText('Coût');
    await expect(liv.getByLabel('Résumé de la mission')).toContainText('non rédigée');
    await expect(liv.getByRole('list', { name: 'Fichiers produits' })).toContainText(
      'Mémoire (Word)',
    );

    // Coûts et journal technique.
    await page.getByRole('tab', { name: 'Coûts' }).click();
    const costs = page.getByRole('region', { name: 'Coûts' });
    await expect(costs.getByRole('table', { name: 'Par phase' })).toContainText(
      'Recherche documentaire',
    );
    await expect(costs.getByRole('table', { name: 'Par modèle d’IA' })).toBeVisible();
    await page.getByRole('tab', { name: 'Journal technique' }).click();
    await expect(page.getByRole('table', { name: 'Appels aux modèles' })).toBeVisible();

    // Export de la mission (dialogue système simulé).
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as never;
    }, archive);
    await page.getByRole('button', { name: 'Exporter la mission' }).click();
    await expect.poll(() => existsSync(archive), { timeout: 30_000 }).toBe(true);
    expect(readFileSync(archive).subarray(0, 2).toString()).toBe('PK');
  } finally {
    await first.app.close();
  }

  // Import dans une autre installation (autre dossier de données).
  const second = await launchApp();
  try {
    const { app, page } = second;
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
    }, archive);
    await page.evaluate(() => (location.hash = '#/missions'));
    await page.getByRole('button', { name: 'Importer une mission' }).click();
    await expect(
      page.getByRole('heading', { name: /Microfinance et inclusion financière au Bénin/ }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Livrables' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Livrables' })
        .getByRole('list', { name: 'Fichiers produits' }),
    ).toContainText('Mémoire (Word)');
    await expect(page.getByText('Mission terminée.').first()).toBeVisible();
    // Une seconde importation de la même mission est refusée avec un message clair.
    await page.evaluate(() => (location.hash = '#/missions'));
    await page.getByRole('button', { name: 'Importer une mission' }).click();
    await expect(page.getByText('Cette mission existe déjà sur cet ordinateur.')).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await second.app.close();
  }
});
