import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { createBriefedMission, enableDevMode, launchApp } from './helpers';

const CSV = join(__dirname, '../../../packages/engine/test/fixtures/donnees-enquete.csv');

test('analyse des données et rédaction : tableaux calculés, sections ancrées, pages liminaires à compléter', async () => {
  test.setTimeout(240_000);
  const { app, page } = await launchApp();
  try {
    await enableDevMode(page);
    await createBriefedMission(page, {
      hypotheses: [
        'Le crédit solidaire améliore l’accès au crédit.',
        'Les femmes remboursent mieux.',
      ],
      data: { app, file: CSV },
    });
    await page.getByRole('switch', { name: /Mode simulé/ }).click();
    await page.getByRole('button', { name: 'Générer le plan' }).click();
    await page.getByRole('button', { name: 'Examiner le plan' }).click({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Valider le plan et lancer la mission' }).click();

    await expect(page.getByText('Terminée', { exact: true }).first()).toBeVisible({
      timeout: 180_000,
    });
    await expect(page.getByText(/jusqu'à P5/).first()).toBeVisible();

    // Analyse des données (P4) : chiffres calculés par le code, interprétation contrôlée, hypothèses.
    const analyse = page.getByRole('region', { name: 'Analyse des données' });
    await expect(analyse).toContainText('60 répondants');
    await expect(analyse).toContainText('calculés par le module statistique');
    await expect(analyse.getByRole('figure').first()).toContainText('Tableau 1 :');
    await expect(analyse.getByRole('figure').first()).toContainText('Source : enquête de terrain');
    await expect(analyse.getByText(/phrase\(s\) écartée\(s\)/)).toBeVisible();
    await expect(
      analyse.getByRole('list', { name: 'Hypothèses' }).getByRole('listitem'),
    ).toHaveCount(2);

    // Rédaction (P5) : toutes les sections, ancrage, lecture avec preuves.
    const redaction = page.getByRole('region', { name: 'Rédaction' });
    const items = redaction.getByRole('list', { name: 'Sections rédigées' }).getByRole('listitem');
    expect(await items.count()).toBeGreaterThan(10);
    await expect(items.first()).toContainText('Rédigée');
    await expect(items.nth(1)).toContainText('Ancrage 100 %');
    await items.nth(1).getByRole('button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Affirmations sourcées/ })).toBeVisible();
    await expect(dialog.getByText(/, p\. \d/).first()).toBeVisible(); // pastille de citation lisible
    await expect(dialog.getByText('Étayée').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Fermer' }).click();

    // Une section de résultats affiche un tableau calculé inséré par son jeton.
    for (let i = 0; i < (await items.count()); i++) {
      const title = await items.nth(i).innerText();
      if (!/résultats/i.test(title)) continue;
      await items.nth(i).getByRole('button').click();
      if (await page.getByRole('dialog').getByRole('figure').count()) break;
      await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
    }
    await expect(page.getByRole('dialog').getByRole('figure').first()).toContainText('Tableau');
    await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();

    // Pages liminaires : résumé rédigé, dédicace et remerciements laissés à compléter (jamais inventés).
    const front = redaction.getByLabel('Pages liminaires');
    await expect(front.locator('summary', { hasText: 'Résumé' })).toContainText('Rédigée');
    await front.locator('summary', { hasText: 'Dédicace' }).click();
    await expect(front.getByText(/\[À COMPLÉTER : dédicace/)).toBeVisible();
    await expect(front.getByText('À compléter par vous').first()).toBeVisible();
  } finally {
    await app.close();
  }
});
