# Playwright Electron Full-Flow E2E Pattern

**When to use**: debugging submit/worker/IPC errors without a Windows desktop.
The test boots Electron headlessly, drives the real UI through all steps
(search → select region → open drawer → submit), and captures ALL console
output from both main process and renderer. Total cold-boot ~25 s.

## Test skeleton

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { existsSync } from 'fs';
import process from 'process';

const PROJECT_DIR = process.cwd();
const DIST_MAIN = join(PROJECT_DIR, 'dist-electron/main/index.cjs');

test('search → drawer → submit → capture ALL logs', async () => {
  test.skip(!existsSync(DIST_MAIN), `Build first: ${DIST_MAIN} missing`);

  const captured: { source: string; type: string; text: string }[] = [];

  const electronApp = await electron.launch({
    args: ['.', '--disable-gpu', '--no-sandbox'],
    cwd: PROJECT_DIR,
    env: { ...process.env, MAP_LOAD_FROM_DIST: '1' },
    timeout: 30_000,
  });

  // Capture MAIN process stderr/stdout — this is where scheduler logs appear
  const proc = electronApp.process();
  if (proc) {
    proc.stdout?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(Boolean).forEach(line =>
        captured.push({ source: 'main-stdout', type: 'info', text: line }));
    });
    proc.stderr?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(Boolean).forEach(line =>
        captured.push({ source: 'main-stderr', type: 'error', text: line }));
    });
  }

  // Capture RENDERER console + page errors
  const window = await electronApp.firstWindow({ timeout: 15_000 });
  window.on('console', (msg) => {
    captured.push({ source: 'renderer', type: msg.type(), text: msg.text() });
  });
  window.on('pageerror', (err) => {
    captured.push({ source: 'renderer', type: 'pageerror', text: String(err) });
  });

  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(6_000); // wait for React mount + basemap probe

  // Drive the UI
  const searchInput = window.locator('input[placeholder*="搜索"]').first();
  await searchInput.fill('深圳龙华');
  await searchInput.press('Enter');
  await window.waitForTimeout(8_000); // Photon + DataV roundtrip

  // Open layer drawer
  const nextBtn = window.locator('button:has-text("下一步")').first();
  if (await nextBtn.count() > 0) {
    await nextBtn.click();
    await window.waitForTimeout(2_000);
  }

  // Submit
  const submitBtn = window.locator('button:has-text("生成 PBF")').first();
  if (await submitBtn.count() > 0 && !(await submitBtn.isDisabled())) {
    await submitBtn.click();
    await window.waitForTimeout(5_000); // IPC roundtrip
  }

  // Print ALL scheduler logs
  for (const m of captured.filter(m => m.text.includes('[scheduler]'))) {
    console.log(m.text);
  }

  // Fail on DB insert failure
  const dbFail = captured.find(m => m.text.includes('DB insert failed'));
  expect(dbFail, `DB insert failed: ${dbFail?.text}`).toBeUndefined();

  await electronApp.close();
}, 90_000);
```

## Key patterns

1. **`MAP_LOAD_FROM_DIST=1`**: bypasses the vite-dev URL routing in main/index.ts,
   forcing `loadFile` to load from `dist/index.html`. Without this, Electron
   tries `process.env.ELECTRON_RENDERER_URL` which is undefined in Playwright.

2. **Main process capture** (`electronApp.process().stdout/stderr`):
   This is where `[scheduler] enqueue called:` and `[scheduler] DB insert failed:`
   appear. Renderer console won't show these.

3. **`--disable-gpu --no-sandbox`**: required for Electron to boot in headless
   CI/sandbox environments. Without them, Electron tries to open a real GPU
   window and fails.

4. **25-second cold-boot**: the full flow (launch + search + drawer + submit)
   takes ~25 s. Assert at 90 s to allow for slow Photon/DataV network calls.

## What this test catches

| Error class | How it surfaces |
|---|---|
| Worker path wrong (`.mjs` vs `.js`, wrong dir) | `Error launching app: Unable to find Electron app at ...` in main-stderr |
| `loadFile` path wrong | `ERR_FILE_NOT_FOUND` in page load, `chrome-error://chromewebdata/` in page state |
| CSP blocks inline script | `Refused to execute inline script because it violates CSP` in renderer errors |
| Scheduler DB insert failure | `[scheduler] DB insert failed:` in main-stderr |
| Preload/IPC not working | `window.api.submitTask is undefined` in renderer errors |
| Photon search broken | Phage error "Search failed: Photon: ..." in renderer alerts |
