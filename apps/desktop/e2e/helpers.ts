import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Lance l'application Electron construite (`pnpm build` requis).
 * - --no-sandbox : nécessaire uniquement quand on s'exécute en root (conteneurs de CI).
 * - EMILIO_ENGINE_NODE : moteur sous Node système (ABI de better-sqlite3 compilé pour Node, ADR-006).
 * - EMILIO_INSECURE_TEST_CIPHER : pas de trousseau système en CI ; ignoré dans un build packagé.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'emilio-e2e-'));
  const app = await electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userData}`, join(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      EMILIO_ENGINE_NODE: process.execPath,
      EMILIO_INSECURE_TEST_CIPHER: '1',
      NODE_USE_ENV_PROXY: '1',
      EMILIO_RESOURCES_DIR: join(__dirname, '../../../resources'),
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
