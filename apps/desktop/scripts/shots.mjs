// Captures de validation de la DA (CdC §22, point d'arrêt J1). Prérequis : `pnpm build`, puis Xvfb si pas d'écran :
//   xvfb-run -a pnpm shots
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
    NODE_USE_ENV_PROXY: '1',
  },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const go = (hash) => page.evaluate((h) => (location.hash = h), hash);
const settle = () => page.waitForTimeout(700);
const clearToasts = () => page.waitForTimeout(6500); // les toasts disparaissent après 6 s

// Clé factice (la clé réelle n'est jamais affichée) + mode développeur.
await go('#/parametres');
await page.getByLabel('Clé OpenRouter').fill('sk-or-v1-captures-demo-0000000000wxyz');
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.getByText('Connexion établie').waitFor({ timeout: 45000 });
await page.getByText(/modèles · liste/).waitFor({ timeout: 45000 });
await page.getByRole('tab', { name: 'Apparence' }).click();
await page.getByRole('switch', { name: 'Mode développeur' }).click();

for (const theme of ['clair', 'sombre']) {
  const t = theme === 'clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme === 'clair' ? 'Clair' : 'Sombre' }).click();

  await clearToasts();
  await go('#/');
  await page.getByText("Vue d'ensemble").waitFor();
  await settle();
  await page.screenshot({ path: join(out, `accueil-${t}.png`) });

  await go('#/parametres');
  await page.getByRole('tab', { name: 'Clé et modèles' }).click();
  await page.getByText('Connexion établie').waitFor({ timeout: 45000 });
  await settle();
  await page.screenshot({ path: join(out, `parametres-${t}.png`) });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));

  // Fenêtre haute pour capturer chaque section en entier.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 3200));
  await go('#/design');
  await page.getByRole('heading', { name: 'Design system' }).first().waitFor();
  await settle();
  for (const id of [
    'couleurs',
    'typo',
    'formes',
    'boutons',
    'champs',
    'cartes',
    'statuts',
    'nav',
    'panneaux',
    'retours',
  ]) {
    await page.locator(`#${id}`).screenshot({ path: join(out, `design-${id}-${t}.png`) });
  }
}
await app.close();
console.log('Captures écrites dans', out);
