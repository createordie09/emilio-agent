import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { APP_NAME } from '@emilio/shared';
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

async function bootstrap(): Promise<void> {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp()] },
    });
  });

  const engineEntry = join(__dirname, 'engine.js');
  const dbPath = join(app.getPath('userData'), 'emilio.db');
  let restore: (raw: EngineClient) => Promise<void> = async () => {};
  const engine = new EngineHost(engineEntry, dbPath, (raw) => restore(raw));
  const { handlers, restoreKey } = createHandlers({
    engine,
    cipher,
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
