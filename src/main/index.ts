import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// IPC handlers will be registered here
import { registerRegionHandlers } from './ipc/region';
import { registerTaskHandlers } from './ipc/tasks';
import { registerConfigHandlers } from './ipc/config';
import { registerSystemHandlers } from './ipc/system';
import {
  registerPmtilesRangeHandler,
  registerPmtilesRangeScheme,
} from './pmtiles-range-protocol';
import { taskScheduler } from './tasks/scheduler';
import { closeDb } from './db';

// Must run before app.whenReady() — enables fetch('pmtiles-range://…') from renderer.
registerPmtilesRangeScheme();

// Force stderr logging in production — helps debug "blank window" failures
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

// GPU setup — flags are read at process start.
// Verified against Electron 33 on Windows 11 with Intel iGPU.
// Note: aggressive flags like --use-angle=d3d11 or --ignore-gpu-blocklist
// trigger Chromium's sandboxed WebGL path, which then FAILS to create a
// GL context (GL_VENDOR=Disabled, GL_RENDERER=Disabled, "BindToCurrentSequence
// failed"). We keep GPU flags MINIMAL and rely on the OS-level default.
if (process.env.MAP_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
} else {
  // Default: GPU fully enabled. We keep only the background-throttling flags.
  // NO 'disable-features' or 'use-angle' or any flag that could interfere
  // with WebGL context creation in Electron 33 on Windows 11.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../build/icon.png'), // dev: dist-electron/main → repo/build
    join(process.resourcesPath, 'icon.png'), // packaged extraResources
    join(app.getAppPath(), 'build/icon.png'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: '地图下载器',
    icon: resolveAppIcon(),
    show: false,
    // High-DPI scaling for crisp tiles on retina/HiDPI displays.
    // Match MapView placeholder — if WebGL/canvas hasn't painted yet, don't flash dark slate.
    backgroundColor: '#e6ecf2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false, // we use fs from preload
      contextIsolation: true,
      nodeIntegration: false,
      // Critical for smooth MapLibre panning: don't throttle rendering when
      // the window is in the background. Default is true and causes jank.
      backgroundThrottling: false,
      // Software fallback for systems without hardware GL.
      offscreen: false,
    },
  });

  // CSP is set via <meta http-equiv="Content-Security-Policy"> in index.html
  // (works in BOTH dev vite-served mode and prod file:// mode). The previous
  // approach via webRequest.onHeadersReceived only worked for prod file:// URLs
  // and triggered Electron's "Insecure CSP" warning because dev required
  // 'unsafe-eval' for Vite HMR.

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // electron-vite injects ELECTRON_RENDERER_URL during dev
  // MAP_LOAD_FROM_DIST=1 forces loadFile even in unpackaged (used by e2e tests)
  if (isDev && process.env['ELECTRON_RENDERER_URL'] && !process.env.MAP_LOAD_FROM_DIST) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // __dirname is dist-electron/main/, renderer is at ../../dist/index.html
    mainWindow.loadFile(join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in user's default browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Ensure config + cache dirs exist
  const userDir = app.getPath('userData');
  mkdirSync(join(userDir, 'output'), { recursive: true });
  mkdirSync(join(userDir, 'logs'), { recursive: true });

  registerPmtilesRangeHandler();
  registerRegionHandlers(ipcMain);
  registerTaskHandlers(ipcMain, () => mainWindow);
  registerConfigHandlers(ipcMain);
  registerSystemHandlers(ipcMain);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let isShuttingDown = false;
app.on('before-quit', (event) => {
  if (isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;
  console.log('[main] before-quit: shutting down task scheduler…');
  taskScheduler
    .shutdown(4000)
    .catch((e) => console.error('[main] shutdown error:', e))
    .finally(() => {
      try {
        closeDb();
      } catch (e) {
        console.error('[main] closeDb error:', e);
      }
      app.quit();
    });
});

// Hardening: do not allow navigation to non-app URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (e, url) => {
    const allowed = url.startsWith('http://localhost') || url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });
});
