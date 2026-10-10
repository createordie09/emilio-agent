// Captures J9 (robustesse et finition). Prérequis : `pnpm build`, puis `xvfb-run -a node scripts/shots-j9.mjs`.
import { _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../../docs/screenshots');
const CSV = join(here, '../../../packages/engine/test/fixtures/donnees-enquete.csv');
mkdirSync(out, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'emilio-shots-'));

// Onboarding (premier lancement) : application dédiée, thèmes clair et sombre.
const onbApp = await electron.launch({
  args: [
    '--no-sandbox',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'emilio-onb-'))}`,
    join(here, '../out/main/index.js'),
  ],
  env: {
    ...process.env,
    EMILIO_ENGINE_NODE: process.execPath,
    EMILIO_INSECURE_TEST_CIPHER: '1',
    EMILIO_SKIP_ONBOARDING: '0',
    EMILIO_RESOURCES_DIR: join(here, '../../../resources'),
  },
});
const op = await onbApp.firstWindow();
await op.setViewportSize({ width: 1360, height: 860 });
await op.waitForLoadState('domcontentloaded');
for (const t of ['light', 'dark']) {
  await op.evaluate((th) => window.api.ui.set({ theme: th === 'light' ? 'clair' : 'sombre' }), t);
  await op.waitForTimeout(400);
  const dlg = op.getByRole('dialog', { name: 'Bienvenue' });
  await dlg.waitFor();
  while (
    (await dlg.getByRole('button', { name: 'Retour' }).isEnabled()) &&
    (await dlg.getByRole('button', { name: 'Retour' }).count())
  ) {
    await dlg.getByRole('button', { name: 'Retour' }).click();
    if (!(await dlg.getByRole('button', { name: 'Retour' }).isEnabled())) break;
  }
  await op.screenshot({ path: join(out, `j9-onboarding-bienvenue-${t}.png`) });
  await dlg.getByRole('button', { name: 'Continuer' }).click();
  await op.screenshot({ path: join(out, `j9-onboarding-confidentialite-${t}.png`) });
  await dlg.getByRole('button', { name: 'Continuer' }).click();
  await dlg.getByRole('button', { name: 'Continuer' }).click();
  await dlg.getByRole('checkbox', { name: /J’ai lu la charte/ }).click();
  await op.screenshot({ path: join(out, `j9-onboarding-charte-${t}.png`) });
  await dlg.getByRole('checkbox', { name: /J’ai lu la charte/ }).click();
}
await onbApp.close();

const app = await electron.launch({
  args: ['--no-sandbox', `--user-data-dir=${userData}`, join(here, '../out/main/index.js')],
  env: {
    ...process.env,
    EMILIO_ENGINE_NODE: process.execPath,
    EMILIO_INSECURE_TEST_CIPHER: '1',
    EMILIO_SKIP_ONBOARDING: '1',
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

await go('#/missions/nouvelle');
await page.getByRole('button', { name: "Ouvrir l'assistant" }).click();
await page.getByLabel(/^Discipline/).fill('Sciences de gestion');
await page.getByRole('button', { name: 'Continuer' }).click();
await page
  .getByLabel('Thème ou titre provisoire')
  .fill('Microfinance et inclusion financière des ménages ruraux au Bénin');
await page
  .getByLabel(/^Problématique/)
  .fill(
    'Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière des ménages ruraux ?',
  );
for (const h of [
  'Le crédit solidaire améliore l’accès au crédit.',
  'Les femmes remboursent mieux que les hommes.',
]) {
  await page.getByLabel('Hypothèse', { exact: true }).fill(h);
  await page.getByLabel('Hypothèse', { exact: true }).press('Enter');
}
await page.getByLabel('Mot-clé', { exact: true }).fill('microfinance');
await page.getByLabel('Mot-clé', { exact: true }).press('Enter');
await page.getByRole('radio', { name: 'Quantitative' }).click();
for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('radio', { name: /Afrique francophone/ }).click();
await page.getByRole('button', { name: 'Continuer' }).click();
await app.evaluate(
  ({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  },
  [CSV],
);
await page.getByLabel('Type de document à importer').selectOption({ label: 'Données de terrain' });
await page.getByRole('button', { name: /Parcourir mes fichiers/ }).click();
await page
  .getByRole('list', { name: 'Fichiers importés' })
  .getByText(basename(CSV), { exact: true })
  .waitFor();
await page
  .getByRole('list', { name: 'Fichiers importés' })
  .getByText(/répondant\(s\)/)
  .waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('radio', { name: /Équilibré/ }).click();
await page.getByLabel('Budget maximal (en dollars)').fill('0.06');
await page.getByRole('button', { name: 'Continuer' }).click();
await page.getByRole('button', { name: 'Créer la mission' }).click();
await page.getByRole('switch', { name: /Mode simulé/ }).click();
await page.getByRole('button', { name: 'Générer le plan' }).click();
await page.getByRole('button', { name: 'Examiner le plan' }).click({ timeout: 30000 });
await page.getByRole('button', { name: 'Valider le plan et lancer la mission' }).click();
const banner = page.getByRole('region', { name: 'Budget atteint' });
await banner.waitFor({ timeout: 90000 });
await page.waitForTimeout(7000); // les toasts disparaissent après 6 s
const missionHash = await page.evaluate(() => location.hash);
const shot = async (name, t) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `j9-${name}-${t}.png`) });
};
for (const theme of ['Clair', 'Sombre']) {
  const t = theme === 'Clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme }).click();
  await go(missionHash);
  await banner.waitFor();
  await banner.scrollIntoViewIfNeeded();
  await shot('budget', t);
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Missions et confidentialité' }).click();
  await shot('parametres-missions', t);
  await go(missionHash);
}
await banner.getByRole('button', { name: 'Finaliser avec l’état actuel' }).click();
await page.getByText('Mission terminée.').first().waitFor({ timeout: 90000 });
await page.waitForTimeout(7000);
for (const theme of ['Clair', 'Sombre']) {
  const t = theme === 'Clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme }).click();
  await go(missionHash);
  await page.getByRole('tab', { name: 'Livrables' }).click();
  await page
    .getByRole('region', { name: 'Livrables' })
    .getByLabel('Résumé de la mission')
    .scrollIntoViewIfNeeded();
  await shot('livrables-resume', t);
  await page.getByRole('tab', { name: 'Coûts' }).click();
  await page.getByRole('region', { name: 'Coûts' }).scrollIntoViewIfNeeded();
  await shot('couts', t);
  await page.getByRole('tab', { name: 'Journal technique' }).click();
  await page.getByRole('region', { name: 'Journal technique' }).scrollIntoViewIfNeeded();
  await shot('journal', t);
}
await app.close();
