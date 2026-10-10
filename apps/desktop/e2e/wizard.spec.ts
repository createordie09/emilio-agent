import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { launchApp } from './helpers';

const FX = join(__dirname, '../../../packages/engine/test/fixtures');

/** Remplace la boîte de dialogue système (non pilotable) par une liste de fichiers prédéfinie. */
async function stubDialog(app: ElectronApplication, files: string[]) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as never;
  }, files);
}

async function importFile(app: ElectronApplication, page: Page, kind: string, file: string) {
  await page.getByLabel('Type de document à importer').selectOption({ label: kind });
  await stubDialog(app, [join(FX, file)]);
  await page.getByRole('button', { name: /Parcourir mes fichiers/ }).click();
}

test('assistant en 7 étapes : brouillon enregistré, import réel de documents et de données, création de la mission', async () => {
  const { app, page } = await launchApp();
  try {
    await page.evaluate(() => (location.hash = '#/missions/nouvelle'));
    await expect(page.getByRole('heading', { name: /Quel travail lançons-nous/ })).toBeVisible();
    await page
      .getByLabel('Décrivez le thème de votre mémoire…')
      .first()
      .fill('Microfinance et inclusion financière au Bénin');
    await page.getByRole('radio', { name: /Mémoire de licence/ }).click();
    await page.getByRole('button', { name: "Ouvrir l'assistant" }).click();
    await expect(page.getByRole('heading', { name: '1. Type de travail' })).toBeVisible();

    // Étape 1 : pré-rempli depuis l'écran d'entrée ; discipline obligatoire.
    await expect(page.getByRole('radio', { name: /Mémoire de licence/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('alert')).toContainText('Indiquez la discipline.');
    await page.getByLabel(/^Discipline/).fill('Sciences de gestion');
    await page.getByRole('button', { name: 'Continuer' }).click();

    // Étape 2 : problématique obligatoire, titre pré-rempli.
    await expect(page.getByRole('heading', { name: '2. Sujet' })).toBeVisible();
    await expect(page.getByLabel('Thème ou titre provisoire')).toHaveValue(
      'Microfinance et inclusion financière au Bénin',
    );
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('alert')).toContainText('problématique');
    await page
      .getByLabel(/^Problématique/)
      .fill('Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière ?');
    await page.getByLabel('Mot-clé', { exact: true }).fill('microfinance');
    await page.getByLabel('Mot-clé', { exact: true }).press('Enter');
    await page.getByRole('radio', { name: 'Quantitative' }).click();

    // Enregistrement automatique : le brouillon réapparaît dans l'écran d'entrée avec ses données.
    await expect(page.getByText('Brouillon enregistré')).toBeVisible();
    await page.evaluate(() => (location.hash = '#/missions/nouvelle'));
    await expect(page.getByText('Brouillons en cours')).toBeVisible();
    await page.getByRole('button', { name: 'Reprendre' }).click();
    await expect(page.getByRole('heading', { name: '1. Type de travail' })).toBeVisible();
    await expect(page.getByLabel(/^Discipline/)).toHaveValue('Sciences de gestion');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByLabel(/^Problématique/)).toHaveValue(/microfinance/);
    await page.getByRole('button', { name: 'Continuer' }).click();

    // Étapes 3 et 4.
    await expect(page.getByRole('heading', { name: '3. Établissement' })).toBeVisible();
    await page.getByLabel('Établissement', { exact: true }).fill("Université d'Abomey-Calavi");
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { name: '4. Normes et format' })).toBeVisible();
    await page.getByRole('radio', { name: /Afrique francophone/ }).click();
    await expect(page.getByText('(Auteur, 2020, p. 45)')).toBeVisible();
    await expect(page.getByLabel('Police')).toHaveValue('Times New Roman');
    await page.getByRole('button', { name: 'Continuer' }).click();

    // Étape 5 : import réel (dialogue simulé), traitement P0 en direct.
    await expect(page.getByRole('heading', { name: '5. Documents' })).toBeVisible();
    await importFile(app, page, 'Document de référence', 'memoire-exemple.pdf');
    const list = page.getByRole('list', { name: 'Fichiers importés' });
    await expect(list.getByText('memoire-exemple.pdf', { exact: true })).toBeVisible();
    await expect(list.getByText('Prêt')).toBeVisible({ timeout: 30_000 });
    await expect(list).toContainText('extrait(s) indexé(s)');
    await importFile(app, page, 'Données de terrain', 'donnees-enquete.csv');
    await expect(list.getByText('60 répondant(s) · 9 variable(s)')).toBeVisible({
      timeout: 30_000,
    });
    // Un fichier du mauvais type est refusé avec un message clair.
    await importFile(app, page, 'Données de terrain', 'guide-redaction.docx');
    await expect(page.getByText(/non accepté pour ce type de document/)).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    // Étape 6 : préréglage + budget obligatoires.
    await expect(page.getByRole('heading', { name: '6. Exécution' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('alert')).toContainText('budget');
    await page.getByRole('radio', { name: /Équilibré/ }).click();
    await page.getByLabel('Budget maximal (en dollars)').fill('12');
    await page.getByRole('button', { name: 'Continuer' }).click();

    // Étape 7 : récapitulatif ; données fournies → aucune confirmation requise.
    await expect(page.getByRole('heading', { name: '7. Récapitulatif' })).toBeVisible();
    await expect(
      page.getByText('Microfinance et inclusion financière au Bénin').first(),
    ).toBeVisible();
    await expect(page.getByText('donnees-enquete.csv')).toBeVisible();
    await page.getByRole('button', { name: 'Créer la mission' }).click();
    await expect(page).toHaveURL(/#\/missions\/(?!nouvelle).+/);
    await expect(page.getByText('Brief', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/génération du plan arrive au prochain jalon/)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('approche empirique sans données : confirmation bloquante à l’étape 7 (CdC §7.3)', async () => {
  const { app, page } = await launchApp();
  try {
    await page.evaluate(() => (location.hash = '#/missions/nouvelle'));
    await page.getByRole('button', { name: "Ouvrir l'assistant" }).click();
    await page.getByLabel(/^Discipline/).fill('Droit');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page
      .getByLabel('Thème ou titre provisoire')
      .fill('Responsabilité des plateformes numériques');
    await page.getByLabel(/^Problématique/).fill('Quel régime de responsabilité ?');
    await page.getByRole('radio', { name: 'Qualitative' }).click();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('radio', { name: /Afrique francophone/ }).click();
    await page.getByRole('button', { name: 'Continuer' }).click(); // → documents (aucun import)
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('radio', { name: /Économique/ }).click();
    await page.getByLabel('Budget maximal (en dollars)').fill('5');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { name: '7. Récapitulatif' })).toBeVisible();
    await expect(page.getByText('Aucune donnée de terrain importée')).toBeVisible();
    const create = page.getByRole('button', { name: 'Créer la mission' });
    await expect(create).toBeDisabled();
    await page.getByRole('checkbox', { name: /sans données de terrain/ }).click();
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page).toHaveURL(/#\/missions\/(?!nouvelle).+/);
  } finally {
    await app.close();
  }
});
