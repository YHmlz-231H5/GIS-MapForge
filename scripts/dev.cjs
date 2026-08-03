#!/usr/bin/env node
/**
 * dev.js — start vite dev server + electron with proper env injection.
 *
 * In development, the renderer loads via http://localhost:<port> for
 * HMR; the main process loads preload from `dist-electron/preload/index.cjs`
 * (already built by build:preload) and the main from `dist-electron/main/index.cjs`.
 *
 * Usage: `npm run dev` will run this script.
 * Env overrides:
 *   MAP_DISABLE_GPU=1  → app.disableHardwareAcceleration() at startup
 *   ELECTRON_LOG_FILE=path  → write main process logs to file
 *
 * This script does NOT auto-build main/preload — run those in another
 * shell as `npm run dev:main` (watch) and `npm run dev:preload` (one-shot).
 */

const { spawn } = require('child_process');
const path = require('path');
const { build } = require('vite');

const ROOT = path.resolve(__dirname, '..');

async function buildPreload() {
  console.log('[dev] Building preload...');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(ROOT, 'scripts/build-preload.cjs'),
    ], { stdio: 'inherit', cwd: ROOT });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('preload build failed')));
  });
}

async function buildMain() {
  console.log('[dev] Building main...');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(ROOT, 'scripts/build-main.cjs'),
    ], { stdio: 'inherit', cwd: ROOT });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('main build failed')));
  });
}

async function buildWorkers() {
  console.log('[dev] Building workers...');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(ROOT, 'scripts/build-workers.cjs'),
    ], { stdio: 'inherit', cwd: ROOT });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('workers build failed')));
  });
}

async function startViteAndElectron() {
  // Spawn vite dev server with custom port + stdio passthrough.
  const vite = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules/vite/bin/vite.js')],
    { stdio: 'inherit', cwd: ROOT, env: { ...process.env, FORCE_COLOR: '1' } }
  );

  // Wait for vite to announce ready port (parsed from stdout) — minimum 2 s.
  await new Promise((r) => setTimeout(r, 3000));

  // Vite default port is 6284 (see vite.config.ts server.port).
  const RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:6284';

  console.log(`[dev] Launching electron with ELECTRON_RENDERER_URL=${RENDERER_URL}`);
  const electronArgs = ['.'];
  // Only pass --disable-gpu if user explicitly asked for it (e.g. on a
  // machine where the GPU process is unstable). Default = GPU ON so WebGL
  // can create a context and MapLibre renders tiles smoothly.
  if (process.env.MAP_DISABLE_GPU === '1') {
    electronArgs.push('--disable-gpu');
  }
  const electron = spawn(
    path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    electronArgs,
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: RENDERER_URL,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_ENABLE_STACK_DUMPING: '1',
        HERMES_NODE_BIN: process.argv0,  // pass real node path to Electron main
      },
    }
  );

  electron.on('exit', (code) => {
    console.log(`[dev] electron exited code ${code}`);
    vite.kill();
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    electron.kill('SIGINT');
    vite.kill('SIGINT');
  });
}

(async () => {
  try {
    await buildPreload();
    await buildMain();
    await buildWorkers();
    await startViteAndElectron();
  } catch (err) {
    console.error('[dev] failed:', err);
    process.exit(1);
  }
})();
