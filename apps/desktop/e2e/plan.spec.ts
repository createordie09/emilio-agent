import { test, expect } from '@playwright/test';
import { createBriefedMission, enableDevMode, launchApp } from './helpers';

test('cadrage et plan : génération simulée, édition de l’arbre, nouvelle version, validation et recherche', async () => {
  const { app, page } = await launchApp();
  try {
    await enableDevMode(page);
    await createBriefedMission(page, { aProposer: true });
    await expect(page.getByRole('button', { name: 'Générer le plan' })).toBeVisible();

    // Mode simulé (mode développeur) : aucun appel payant.
    await page.getByRole('switch', { name: /Mode simulé/ }).click();
    await page.getByRole('button', { name: 'Générer le plan' }).click();
    await expect(page.getByText(/Planification en cours/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Plan prêt' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Architecte du plan : plan proposé/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Examiner le plan' }).click();

    // Écran de validation (§6.5).
    await expect(page.getByRole('heading', { name: 'Valider le plan', level: 1 })).toBeVisible();
    const tree = page.getByRole('list', { name: 'Plan' });
    await expect(tree.getByRole('button', { name: 'Introduction générale' })).toBeVisible();
    await expect(
      tree.getByRole('button', { name: /^I Cadre théorique et méthodologique/ }),
    ).toBeVisible();
    await expect(
      tree.getByRole('button', { name: /^1 Clarification conceptuelle et revue de littérature/ }),
    ).toBeVisible();

    // Estimation : trois scénarios, prix d'exemple signalés comme tels (mode simulé).
    for (const s of ['bas', 'moyen', 'haut'])
      await expect(page.getByTestId(`scenario-${s}`)).toBeVisible();
    await expect(page.getByText('Prix d’exemple (mode simulé)')).toBeVisible();

    // Problématique à proposer : trois formulations ; la validation est bloquée tant qu'aucune n'est choisie.
    const radios = page.getByRole('radiogroup', { name: 'Problématique' }).getByRole('radio');
    await expect(radios).toHaveCount(3);
    await page.getByRole('button', { name: 'Valider le plan et lancer la mission' }).click();
    await expect(page.getByText(/Choisissez la problématique/)).toBeVisible();
    await radios.nth(1).click();
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');

    // Édition : renommer un chapitre, ajouter puis supprimer une sous-section.
    await tree.getByRole('button', { name: /^1 Clarification conceptuelle/ }).click();
    const titre = page.getByLabel('Titre', { exact: true });
    await titre.fill('Cadre conceptuel du microcrédit');
    await titre.blur();
    await expect(
      tree.getByRole('button', { name: /^1 Cadre conceptuel du microcrédit/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter une sous-section' }).click();
    const added = tree.getByRole('button', { name: /^1\.\d Nouvelle section/ });
    await expect(added).toBeVisible();

    // Glisser-déposer : la section ajoutée passe du chapitre 1 au chapitre 2 (centre de la carte = à l'intérieur).
    const cible = tree.getByRole('button', { name: /^2 Cadre théorique et démarche/ });
    await added.dragTo(cible);
    const moved = tree.getByRole('button', { name: /^2\.\d Nouvelle section/ });
    await expect(moved).toBeVisible();

    // Suppression avec confirmation.
    await moved.click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(moved).toHaveCount(0);

    // Nouvelle version avec commentaire : la mission repasse en planification, puis revient avec la version 2.
    await page.getByRole('button', { name: 'Demander une nouvelle version du plan' }).click();
    await expect(page.getByText('Écrivez ce que vous voulez changer')).toBeVisible();
    await page
      .getByLabel(/^Instructions supplémentaires/)
      .fill('Développer davantage le cadre théorique.');
    await page.getByRole('button', { name: 'Demander une nouvelle version du plan' }).click();
    await expect(page).toHaveURL(/#\/missions\/(?!nouvelle)[^/]+$/);
    await expect(page.getByRole('region', { name: 'Plan prêt' })).toContainText('version 2', {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Examiner le plan' }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Instructions supplémentaires/)).toHaveValue(
      'Développer davantage le cadre théorique.',
    );

    // Validation : choix de la problématique (perdu à la régénération ? non : conservé), puis lancement.
    await page
      .getByRole('radiogroup', { name: 'Problématique' })
      .getByRole('radio')
      .first()
      .click();
    await page.getByRole('button', { name: 'Valider le plan et lancer la mission' }).click();
    await expect(page).toHaveURL(/#\/missions\/(?!nouvelle)[^/]+$/);
    await expect(page.getByText('Terminée', { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/Étapes disponibles terminées/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Liste des sources' })).toBeVisible();

    // Le plan validé reste consultable, en lecture seule.
    await page.getByRole('button', { name: 'Voir le plan' }).click();
    await expect(page.getByRole('heading', { name: 'Plan de la mission', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Valider le plan et lancer la mission' }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('les outils de simulation du plan sont refusés hors mode développeur', async () => {
  const { app, page } = await launchApp();
  try {
    const r = await page.evaluate(() =>
      (
        window as unknown as {
          api: {
            missions: {
              setSimulated(
                id: string,
                v: boolean,
              ): Promise<{ ok: boolean; error?: { code: string } }>;
            };
          };
        }
      ).api.missions.setSimulated('x', true),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('E_BAD_REQUEST');
  } finally {
    await app.close();
  }
});
