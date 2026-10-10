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
    await expect(page.getByText('Mission terminée.').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Analyse' }).click();
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

    await page.getByRole('tab', { name: 'Rédaction' }).click();
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

    // Jury (P6/P7) : grille par juré, notes sur 20, révisions, évaluation globale.
    await page.getByRole('tab', { name: 'Jury' }).click();
    const jury = page.getByRole('region', { name: 'Jury' });
    await expect(jury.getByRole('article').first()).toContainText('/ 20');
    await expect(jury.getByRole('table', { name: 'Grille d’évaluation' }).first()).toBeVisible();
    await expect(jury.getByRole('article', { name: 'Ensemble du travail' })).toBeVisible();

    // Brouillons : versions conservées et comparaison phrase par phrase.
    await page.getByRole('tab', { name: 'Brouillons' }).click();
    const drafts = page.getByRole('region', { name: 'Brouillons' });
    await expect(drafts.getByRole('list', { name: 'Versions' })).toBeVisible();
    await expect(drafts.getByText('Version courante')).toBeVisible();

    // Livrables (P8/P9) : Word, PDF rendu par Chromium, rapport ; contrôle final ; charte d'utilisation.
    await page.getByRole('tab', { name: 'Livrables' }).click();
    const liv = page.getByRole('region', { name: 'Livrables' });
    const files = liv.getByRole('list', { name: 'Fichiers produits' }).getByRole('listitem');
    await expect(files).toHaveCount(3);
    await expect(files.nth(0)).toContainText('Mémoire (Word)');
    await expect(files.nth(1)).toContainText('Mémoire (PDF)');
    await expect(files.nth(2)).toContainText('Rapport de mission');
    await expect(liv.getByText(/source\(s\) citée\(s\) sur/)).toBeVisible();
    await expect(
      liv.getByRole('group', { name: 'Contrôle final' }).or(liv.getByLabel('Contrôle final')),
    ).toContainText('Aucun problème bloquant');
    await expect(liv.getByText(/emplacement\(s\) à compléter par vous/).first()).toBeVisible();
    await expect(liv.getByLabel('Charte d’utilisation')).toContainText('auteur responsable');
  } finally {
    await app.close();
  }
});
