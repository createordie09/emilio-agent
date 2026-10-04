import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME, FILE_KIND_LABEL_FR, IPC, type FileKind, type HostRequest } from '@emilio/shared';
import { EngineHost, type EngineClient } from './engine-host';
import { createHandlers, type SecretCipher } from './ipc/handlers';

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);

app.setName(APP_NAME);

/** CSP stricte (CdC §19). En développement, Vite exige 'unsafe-inline' (React Refresh) et un WebSocket local. */
function csp(): string {
  const script = isDev ? "'self' 'unsafe-inline'" : "'self'";
  const connect = isDev ? "'self' ws://localhost:* http://localhost:*" : "'none'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Chiffreur NON sûr, réservé aux tests E2E sans trousseau système. Ignoré dans un build packagé. */
const testCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`TEST:${plain}`).toString('base64'),
  decrypt: (b64) =>
    Buffer.from(b64, 'base64')
      .toString()
      .replace(/^TEST:/, ''),
};

const secureCipher: SecretCipher = {
  isAvailable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    // Sous Linux sans trousseau, Electron retombe sur un « basic_text » non sûr : on refuse.
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      return false;
    }
    return true;
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
};

const cipher: SecretCipher =
  !app.isPackaged && process.env.EMILIO_INSECURE_TEST_CIPHER === '1' ? testCipher : secureCipher;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#F4F1FB',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault();
  });
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

/** Dossier `resources/` : variable d'environnement, installateur, ou dépôt de sources (dev, quel que soit le point d'entrée). */
function resolveResourcesDir(): string {
  const candidates = [
    process.env.EMILIO_RESOURCES_DIR,
    app.isPackaged ? join(process.resourcesPath, 'resources') : undefined,
    join(app.getAppPath(), '../../resources'),
    join(app.getAppPath(), '../../../../resources'),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(join(c, 'presets.json'))) ?? candidates[0]!;
}

/** Rendu PDF demandé par le moteur (CdC §16.2) : page HTML locale → `printToPDF` (A4, signets, numéros de page). */
async function renderPdf(req: HostRequest): Promise<string | void> {
  if (req.method !== 'renderPdf') return 'Appel inconnu.';
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  try {
    await win.loadFile(req.params.htmlPath);
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:9px;width:100%;text-align:center;font-family:serif"><span class="pageNumber"></span></div>',
      generateDocumentOutline: true,
    });
    writeFileSync(req.params.pdfPath, pdf);
  } catch (e) {
    return (e as Error).message;
  } finally {
    win.destroy();
  }
}

async function bootstrap(): Promise<void> {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp()] },
    });
  });

  const engineEntry = join(__dirname, 'engine.js');
  const dbPath = join(app.getPath('userData'), 'emilio.db');
  let restore: (raw: EngineClient) => Promise<void> = async () => {};
  const resources = resolveResourcesDir();
  const engine = new EngineHost(
    engineEntry,
    dbPath,
    {
      EMILIO_DATA_DIR: app.getPath('userData'),
      EMILIO_MODELS_DIR: join(resources, 'models'),
      EMILIO_PRESETS_PATH: join(resources, 'presets.json'),
      EMILIO_NORMS_PATH: join(resources, 'norms-profiles.json'),
      EMILIO_QUALITY_WEIGHTS_PATH: join(resources, 'quality-weights.json'),
      EMILIO_RESOURCES_DIR: resources,
    },
    (raw) => restore(raw),
    60_000,
    (payload) =>
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.engineLive, payload)),
    renderPdf,
  );
  const { handlers, restoreKey } = createHandlers({
    engine,
    cipher,
    pickFiles: async (kind: FileKind) => {
      const filters: Record<FileKind, { name: string; extensions: string[] }[]> = {
        field_data: [{ name: 'Tableurs (CSV, XLSX)', extensions: ['csv', 'xlsx'] }],
        template: [{ name: 'Gabarits Word (DOCX)', extensions: ['docx'] }],
        user_document: [
          { name: 'Documents (PDF, DOCX, TXT)', extensions: ['pdf', 'docx', 'txt', 'md'] },
        ],
        institution_guidelines: [
          { name: 'Documents (PDF, DOCX, TXT)', extensions: ['pdf', 'docx', 'txt', 'md'] },
        ],
        existing_work: [
          { name: 'Documents (PDF, DOCX, TXT)', extensions: ['pdf', 'docx', 'txt', 'md'] },
        ],
      };
      const win = BrowserWindow.getFocusedWindow() ?? undefined;
      const opts = {
        title: `Importer : ${FILE_KIND_LABEL_FR[kind]}`,
        properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
        filters: filters[kind],
      };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? [] : r.filePaths;
    },
    revealFile: (path: string) => shell.showItemInFolder(path),
    saveFileAs: async (path: string, filename: string) => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined;
      const opts = { title: 'Enregistrer le fichier', defaultPath: filename };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return false;
      copyFileSync(path, r.filePath);
      return true;
    },
    appInfo: () => ({
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      dev: isDev,
    }),
  });
  restore = restoreKey;
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  }
  app.on('before-quit', () => engine.stop());
  await engine.start();
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(bootstrap);
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
