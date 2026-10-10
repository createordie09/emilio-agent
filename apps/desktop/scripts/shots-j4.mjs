// Captures J4 (sources documentaires). Prérequis : `pnpm build`, puis `xvfb-run -a node scripts/shots-j4.mjs`.
import { _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../../docs/screenshots');
mkdirSync(out, { recursive: true });
const app = await electron.launch({
  args: [
    '--no-sandbox',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'emilio-shots-'))}`,
    join(here, '../out/main/index.js'),
  ],
  env: {
    ...process.env,
    EMILIO_ENGINE_NODE: process.execPath,
    EMILIO_INSECURE_TEST_CIPHER: '1',
    EMILIO_RESOURCES_DIR: join(here, '../../../resources'),
  },
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1360, height: 860 });
await page.waitForLoadState('domcontentloaded');
const go = (h) => page.evaluate((x) => (location.hash = x), h);
await go('#/parametres');
await page.getByRole('tab', { name: 'Apparence' }).click();
await page.getByRole('switch', { name: 'Mode développeur' }).click();
await go('#/missions');
await page.getByRole('button', { name: /Lancer une mission factice/ }).click();
await page.getByRole('button', { name: 'Recherche de démonstration' }).click();
const missionHash = await page.evaluate(() => location.hash);
const list = page.getByRole('list', { name: 'Liste des sources' });
await list.waitFor({ timeout: 30000 });
for (const theme of ['Clair', 'Sombre']) {
  const t = theme === 'Clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme }).click();
  await page.getByRole('tab', { name: 'Sources documentaires' }).click();
  await page.getByLabel('Adresse e-mail de contact').fill('prenom.nom@exemple.fr');
  await page.getByRole('button', { name: 'Tester les connexions' }).click();
  await page
    .getByLabel(/^État de /)
    .first()
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, `j4-reglages-sources-${t}.png`) });
  await go(missionHash);
  await list.waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `j4-sources-${t}.png`) });
  await list.getByRole('button').first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `j4-source-detail-${t}.png`) });
  await page.getByRole('button', { name: 'Fermer' }).first().click();
}
await app.close();
console.log('Captures J4 écrites dans', out);
