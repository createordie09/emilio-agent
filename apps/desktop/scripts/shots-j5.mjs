// Captures J5 (cadrage et plan). Prérequis : `pnpm build`, puis `xvfb-run -a node scripts/shots-j5.mjs`.
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

// Mission au stade « brief », problématique à proposer, mode simulé.
await go('#/missions/nouvelle');
await page.getByRole('button', { name: "Ouvrir l'assistant" }).click();
await page.getByLabel(/^Discipline/).fill('Sciences de gestion');
await page.getByRole('button', { name: 'Continuer' }).click();
await page
  .getByLabel('Thème ou titre provisoire')
  .fill('Microfinance et inclusion financière des ménages ruraux au Bénin');
await page.getByRole('checkbox', { name: /m'aide à la formuler/ }).click();
await page.getByLabel('Mot-clé', { exact: true }).fill('microfinance');
await page.getByLabel('Mot-clé', { exact: true }).press('Enter');
await page.getByRole('radio', { name: 'Documentaire' }).click();
for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('radio', { name: /Afrique francophone/ }).click();
await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('radio', { name: /Équilibré/ }).click();
await page.getByLabel('Budget maximal (en dollars)').fill('12');
await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('button', { name: 'Créer la mission' }).click();
await page.getByRole('switch', { name: /Mode simulé/ }).click();
await page.getByRole('button', { name: 'Générer le plan' }).click();
await page.getByRole('region', { name: 'Plan prêt' }).waitFor({ timeout: 30000 });
await page.waitForTimeout(6500); // les toasts disparaissent après 6 s
const missionHash = await page.evaluate(() => location.hash);
const planHash = `${missionHash}/plan`;

for (const theme of ['Clair', 'Sombre']) {
  const t = theme === 'Clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme }).click();
  await go(missionHash);
  await page.getByRole('region', { name: 'Plan prêt' }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `j5-mission-plan-pret-${t}.png`) });
  await go(planHash);
  await page.getByRole('heading', { name: 'Valider le plan', level: 1 }).waitFor();
  await page.getByRole('radiogroup', { name: 'Problématique' }).getByRole('radio').nth(1).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `j5-plan-${t}.png`) });
  await page.getByRole('region', { name: 'Arbre du plan' }).scrollIntoViewIfNeeded();
  await page.getByRole('region', { name: 'Détail de la section' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /^1 Clarification conceptuelle/ }).click();
  await page.getByLabel('Titre', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `j5-plan-arbre-${t}.png`) });
  await page
    .getByRole('region', { name: 'Estimation du coût et de la durée' })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `j5-plan-estimation-${t}.png`) });
}
await app.close();
console.log('Captures J5 écrites dans', out);
