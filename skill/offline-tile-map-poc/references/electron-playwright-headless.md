# Headless Electron testing with Playwright (NEW 2026-07-20)

When you need to verify Electron app behavior in a sandbox without a real
desktop session, `@playwright/test`'s `_electron.launch()` API boots the
actual Electron binary in headless mode and gives you a real `Page` object
you can drive. This unlocks:

- console warning/error capture and assertion
- IPC roundtrip testing (renderer → main → renderer)
- screenshot capture for visual regression
- DOM assertions on the React tree

Reference: https://playwright.dev/docs/api/class-electron

## Minimal setup (5 min)

```bash
cd app-map-downloader
npm i -D @playwright/test
mkdir e2e
```

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,                  // Electron can't run multiple instances
  reporter: [['list'], ['json', { outputFile: 'test-results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  timeout: 60_000,
  projects: [{ name: 'electron-sandbox', use: { ...devices['Desktop Chrome'] } }],
});
```

`tsconfig.json` (exclude e2e from main project):
```json
"exclude": ["node_modules", "dist", "dist-electron", "release", "e2e", "tests", "playwright.config.ts"]
```

## Spec template — boot + capture console

`e2e/gpu-warnings.spec.ts`:
```ts
import { test, expect, _electron as electron, ConsoleMessage } from '@playwright/test';
import { join } from 'path';
import { existsSync } from 'fs';
import process from 'process';

const PROJECT_DIR = process.cwd();
const DIST_MAIN = join(PROJECT_DIR, 'dist-electron/main/index.cjs');

test.describe('Electron warnings suppression', () => {
  test('boots without SwiftShader / GroupMarker warnings', async () => {
    test.skip(!existsSync(DIST_MAIN), `Build first: ${DIST_MAIN} missing`);

    const electronApp = await electron.launch({
      args: ['.', '--disable-gpu', '--no-sandbox'],
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        MAP_DOWNLOADS_DIR: require('os').tmpdir(),
        MAP_LOAD_FROM_DIST: '1',  // force loadFile in dev branch (Pitfall 41)
      },
      timeout: 30_000,
    });

    const captured: { type: string; text: string }[] = [];
    const window = await electronApp.firstWindow({ timeout: 15_000 });
    window.on('console', (msg) =>
      captured.push({ type: msg.type(), text: msg.text() })
    );

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(3_000);  // let probes settle

    const errors = captured.filter((m) => m.type === 'error');
    const warnings = captured.filter((m) => m.type === 'warning');
    console.log(JSON.stringify({ error_count: errors.length, warning_count: warnings.length }, null, 2));

    // Assert forbidden warnings are gone
    const forbidden = ['Automatic fallback to software WebGL', 'GroupMarkerNotSet'];
    for (const phrase of forbidden) {
      const found = captured.find((m) => m.text.includes(phrase));
      expect(found, `"${phrase}" must be suppressed`).toBeUndefined();
    }

    await electronApp.close();
  }, 60_000);
});
```

Run:
```bash
npm run build                 # build main/preload/workers first
npx playwright test e2e/gpu-warnings.spec.ts --reporter=list
```

Cold-boot time: ~4 s. The full capture (build + test) is ~10 s.

## Three critical pitfalls when wiring this up

1. **`__dirname` trap** — when Playwright runs your spec, `cwd` is the
   project root, but `__dirname` points to `e2e/` (the spec's directory).
   Use `process.cwd()` to get the project root, NOT `join(__dirname, '..')`.
   Symptom: `test.skip` fires with "Build first: ... missing" even when the
   file exists. Fix: `const PROJECT_DIR = process.cwd()`.

2. **`args: ['.', '--disable-gpu', '--no-sandbox']`** — the `'.'` tells
   Electron to load `package.json`'s `main` field. `--disable-gpu` and
   `--no-sandbox` are required for the Linux container / sandbox case.
   Without them the launch either crashes or hangs.

3. **`firstWindow()` timeout** — the renderer may take 5-15 s to load on
   first launch (Vite cold-start, OSM tile probe, etc). Use a generous
   timeout (15 000 ms is fine for warmup, but extend to 30 000 for first
   run). After `firstWindow()`, add `await window.waitForTimeout(3000)`
   so any post-load probes complete before assertions run.

## Capture modes for debugging

| Need | Method |
|---|---|
| All console messages (incl. warnings) | `window.on('console', cb)` |
| Uncaught page errors | `window.on('pageerror', cb)` |
| Network requests | `electronApp.process().stdout.on('data', ...)` (low-level) |
| Screenshot at end of test | `await window.screenshot({ path: 'out.png' })` |
| Trace (full event timeline) | `use: { trace: 'retain-on-failure' }` in config |

## What this CAN'T do

- True visual rendering (you can screenshot but can't see it run interactively)
- WebGL frame-rate measurement (Playwright doesn't expose FPS APIs);
  for FPS, use `requestAnimationFrame` instrumentation inside the spec
- Pinned-version Electron (Playwright bundles an Electron version; for
  your own use `args: [path-to-electron]`)
- Production-style packaged apps (Playwright drives the unpackaged dev binary)

## When to fall back to user-side manual testing

- UI layout issues that need eyeballs (typography, color contrast, animation timing)
- Native OS dialogs (file picker, save dialog) — Playwright can't drive
  the modal that opens *outside* the BrowserWindow
- Multi-window interactions (drag-and-drop between windows, OS-level shortcuts)

For everything else — console warnings, IPC roundtrip, state machine
behavior, error handling — Playwright Electron + sandbox is enough.

## Related references

- `electron-gpu-csp-fixes.md` — full GPU flag + CSP setup (Pitfall 33-35)
- `electron-vite-base-path.md` — vite 6 `base: './'` top-level gotcha (Pitfall 40)
- `electron-loadfile-url-routing.md` — `MAP_LOAD_FROM_DIST` env var recipe (Pitfall 41)
