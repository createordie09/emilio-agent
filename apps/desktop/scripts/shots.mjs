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
// --- J2 : dashboard de mission (mode simulé) ---
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
for (const theme of ['clair', 'sombre']) {
  const t = theme === 'clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme === 'clair' ? 'Clair' : 'Sombre' }).click();
  await go('#/missions');
  await page.getByRole('button', { name: /Lancer une mission factice/ }).click();
  await page.getByText(/Phase P0 terminée/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `mission-en-cours-${t}.png`) });
  await page.getByRole('button', { name: 'Crédit épuisé' }).click();
  await page.getByRole('button', { name: 'Reprendre' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `mission-pause-credit-${t}.png`) });
  await page.getByRole('button', { name: 'Recharger le crédit' }).click();
  await page.getByText('Terminée', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `mission-terminee-${t}.png`) });
  await go('#/missions');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `missions-liste-${t}.png`) });
}
// --- J3 : assistant « Nouvelle mission » ---
const fx = join(here, '../../../packages/engine/test/fixtures');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1500));
const draftId = await page.evaluate(
  async (paths) => {
    const api = window.api;
    const d = await api.drafts.create({
      workType: 'memoire_master',
      titre: 'Microfinance et inclusion financière des ménages ruraux au Bénin',
    });
    const norms = await api.catalog.normsProfiles();
    const n = norms.value[0];
    await api.drafts.save(d.value.id, {
      discipline: 'Sciences de gestion',
      specialite: 'Finance et microfinance',
      problematique:
        'Dans quelle mesure la microfinance améliore-t-elle l’inclusion financière des ménages ruraux du Bénin ?',
      questionsRecherche: ['Quel est le rôle des groupes de caution solidaire ?'],
      objectifGeneral: 'Analyser l’effet de la microfinance sur l’inclusion financière.',
      hypotheses: ['L’accès au crédit améliore la productivité agricole.'],
      motsCles: ['microfinance', 'inclusion financière', 'Bénin'],
      terrain: { pays: 'Bénin', ville: 'Parakou', periode: '2025' },
      approche: 'mixte',
      etablissement: {
        nom: 'Université de Parakou',
        faculte: 'Faculté de droit et de sciences politiques',
        anneeAcademique: '2025-2026',
      },
      profilNormesId: n.id,
      styleCitation: n.citationMode,
      mise_en_page: {
        police: n.layout.font,
        taille: n.layout.fontSize,
        interligne: n.layout.lineSpacing,
        margeCm: n.layout.marginCm,
      },
      execution: {
        preset: 'equilibre',
        budgetMaxUsd: 15,
        parallelism: 3,
        rondesMaxParChapitre: 3,
        rondesMaxGlobales: 2,
        profondeurRecherche: 'normale',
        preferenceSources: 'toutes',
        models: undefined,
      },
    });
    await api.files.add(
      d.value.id,
      paths.map(([path, kind]) => ({ path, kind })),
    );
    return d.value.id;
  },
  [
    [join(fx, 'memoire-exemple.pdf'), 'user_document'],
    [join(fx, 'guide-redaction.docx'), 'institution_guidelines'],
    [join(fx, 'donnees-enquete.csv'), 'field_data'],
  ],
);
for (const theme of ['clair', 'sombre']) {
  const t = theme === 'clair' ? 'light' : 'dark';
  await go('#/parametres');
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.getByRole('radio', { name: theme === 'clair' ? 'Clair' : 'Sombre' }).click();
  await go('#/missions/nouvelle');
  await page.getByRole('heading', { name: /Quel travail/ }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `wizard-entree-${t}.png`) });
  await go(`#/missions/nouvelle/${draftId}`);
  await page.getByRole('heading', { name: '1. Type de travail' }).waitFor();
  for (let i = 1; i <= 7; i++) {
    if (i === 5)
      await page.getByText('60 répondant(s) · 9 variable(s)').waitFor({ timeout: 30000 });
    if (i === 7) await page.getByRole('button', { name: 'Créer la mission' }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `wizard-etape${i}-${t}.png`) });
    if (i < 7) await page.getByRole('button', { name: 'Continuer' }).click();
  }
}
await app.close();
console.log('Captures écrites dans', out);
