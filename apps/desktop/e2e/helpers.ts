import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Lance l'application Electron construite (`pnpm build` requis).
 * - --no-sandbox : nécessaire uniquement quand on s'exécute en root (conteneurs de CI).
 * - EMILIO_ENGINE_NODE : moteur sous Node système (ABI de better-sqlite3 compilé pour Node, ADR-006).
 * - EMILIO_INSECURE_TEST_CIPHER : pas de trousseau système en CI ; ignoré dans un build packagé.
 */
export async function launchApp(
  opts: { onboarding?: boolean; userData?: string } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'emilio-e2e-'));
  const app = await electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userData}`, join(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      EMILIO_ENGINE_NODE: process.execPath,
      EMILIO_INSECURE_TEST_CIPHER: '1',
      // Premier lancement : l'onboarding est passé d'office, sauf test dédié.
      EMILIO_SKIP_ONBOARDING: opts.onboarding ? '0' : '1',
      NODE_USE_ENV_PROXY: '1',
      EMILIO_RESOURCES_DIR: join(__dirname, '../../../resources'),
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** Active le mode développeur (outils de simulation) via les Paramètres. */
export async function enableDevMode(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = '#/parametres'));
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('switch', { name: 'Mode développeur' }).click();
}

/**
 * Parcourt l'assistant jusqu'à « Créer la mission » (sans documents ni données) : la mission est au stade « brief ».
 * `aProposer` : l'agent doit proposer la problématique.
 */
export async function createBriefedMission(
  page: Page,
  opts: {
    title?: string;
    aProposer?: boolean;
    hypotheses?: string[];
    /** Importe un fichier de données de terrain (dialogue système simulé). */
    data?: { app: ElectronApplication; file: string };
    /** Budget maximal en dollars (défaut 12). */
    budget?: string;
  } = {},
): Promise<void> {
  const title = opts.title ?? 'Microfinance et inclusion financière au Bénin';
  await page.evaluate(() => (location.hash = '#/missions/nouvelle'));
  await page.getByRole('button', { name: "Ouvrir l'assistant" }).click();
  await page.getByLabel(/^Discipline/).fill('Sciences de gestion');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Thème ou titre provisoire').fill(title);
  if (opts.aProposer) {
    await page.getByRole('checkbox', { name: /m'aide à la formuler/ }).click();
  } else {
    await page
      .getByLabel(/^Problématique/)
      .fill('Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière ?');
  }
  await page.getByLabel('Mot-clé', { exact: true }).fill('microfinance');
  await page.getByLabel('Mot-clé', { exact: true }).press('Enter');
  for (const h of opts.hypotheses ?? []) {
    await page.getByLabel('Hypothèse', { exact: true }).fill(h);
    await page.getByLabel('Hypothèse', { exact: true }).press('Enter');
  }
  await page.getByRole('radio', { name: opts.data ? 'Quantitative' : 'Documentaire' }).click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('radio', { name: /Afrique francophone/ }).click();
  await page.getByRole('button', { name: 'Continuer' }).click(); // → documents
  if (opts.data) {
    const { app, file } = opts.data;
    await app.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as never;
      },
      [file],
    );
    await page
      .getByLabel('Type de document à importer')
      .selectOption({ label: 'Données de terrain' });
    await page.getByRole('button', { name: /Parcourir mes fichiers/ }).click();
    await page
      .getByRole('list', { name: 'Fichiers importés' })
      .getByText(basename(file), { exact: true })
      .waitFor();
    await page
      .getByRole('list', { name: 'Fichiers importés' })
      .getByText(/répondant\(s\)/)
      .waitFor({ timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('radio', { name: /Équilibré/ }).click();
  await page.getByLabel('Budget maximal (en dollars)').fill(opts.budget ?? '12');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Créer la mission' }).click();
}
