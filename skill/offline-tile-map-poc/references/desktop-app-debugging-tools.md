# Desktop app debugging — when the user can't run the app

When you build an Electron desktop app, you face a recurring challenge:
the **sandbox** (this hermes agent's runtime) has **no GUI**, but the
**user's Windows desktop** has a GUI but isn't running interactively
with you. Each console warning you want to debug requires the user to
launch `npm run dev`, copy-paste the error to you, wait for a fix,
restart, repeat. Slow.

This reference catalogs every debugging approach that worked across
the `app-map-downloader` and `osmtile-poc` projects.

## Approaches ranked by utility

### 1. `@playwright/test` + `_electron.launch()` — **BEST**

Boot the real Electron binary in headless mode, capture all console
events via `window.on('console', ...)`, assert no errors, run from
the sandbox.

- ✅ Works in headless sandbox (no GUI needed)
- ✅ Real Electron binary, real Vite, real React, real MapLibre
- ✅ Captures console warnings, errors, page errors, network
- ✅ Reproduces user-reported bugs in seconds, not minutes
- ❌ Can't see actual visual rendering (only screenshots)
- ❌ Multi-window and native dialogs not testable

```bash
cd app-map-downloader
npm i -D @playwright/test      # 3 packages, 3 s
npx playwright test e2e/      # cold-boot ~4 s per spec
```

See `references/electron-playwright-headless.md` for the full recipe.

### 2. CDP `--remote-debugging-port=9222` — for live debugging

When the user runs `npm run dev` on their Windows, you can attach
your sandbox to the running Electron via Chrome DevTools Protocol.
The user runs the app, you see everything.

```ts
// main/index.ts
mainWindow.webContents.openDevTools({ mode: 'detach' });

// OR run with flag:
const child = spawn('electron', ['.', '--remote-debugging-port=9222'], {...});

// Sandbox attaches:
const CDP = require('chrome-remote-interface');
const client = await CDP({ port: 9222 });
await client.Runtime.enable();
client.Runtime.consoleAPICalled((msg) => console.log(msg));
```

- ✅ Real-time console capture, network, profiling
- ✅ User's actions visible as `Runtime.consoleAPICalled` events
- ❌ Requires user to launch dev with the port flag
- ❌ One-shot per session — user must restart for next debug round

Use when: user reports "this happens when I click X". You don't want
them to keep clicking while you iterate.

### 3. Static analysis + dev console handoff

When Playwright can't reproduce (e.g. GPU fallback warnings are
hardware-dependent), trust the user to copy the console. Make the
console **structured** so they can paste a one-liner.

Add a structured log line at app startup:

```ts
// main/index.ts
console.log(JSON.stringify({
  env: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  gl: process.versions.glib || 'n/a',
  flags: process.argv.filter((a, _, arr) => arr.indexOf(a) < 5),
}, null, 2));
```

User pastes one block; you see everything. No "what version of X
are you on?" follow-ups.

### 4. Dump DOM state on test failure

When a Playwright test fails, dump the renderer state to a structured
report so you can debug without re-running:

```ts
test('...', async () => {
  const window = await electronApp.firstWindow();
  const dump = await window.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    rootChildren: document.getElementById('root')?.children?.length ?? 0,
    inputs: Array.from(document.querySelectorAll('input')).map(i => i.placeholder),
    visibleText: document.body.innerText.slice(0, 500),
  }));
  console.log(JSON.stringify(dump, null, 2));
  // ... assertions
});
```

If test fails, the dump appears in stdout even before the error
message — fast feedback.

### 5. Screenshot on failure

```ts
// playwright.config.ts
use: { screenshot: 'only-on-failure' }
```

Output saved to `test-results/<spec-name>/test-failed-1.png`. Inspect
later. Works headlessly. Not as good as seeing the live app but better
than nothing.

## When to ask the user to run dev

The sandbox can verify **structural** correctness:
- Build succeeds, no type errors, no console errors on boot
- IPC roundtrip works (Photon search → bbox → region state)
- Layer curation drawer renders 6 questions
- Task queue submits and updates

The user must verify **visual** correctness:
- "Does the basemap look right?"
- "Is the layer drawer styled correctly?"
- "Is the text readable at different zoom levels?"
- "Does panning feel smooth?"

Reserve `npm run dev` requests for visual confirmation only. Use
Playwright for everything else.

## Checklist before declaring an issue "fixed"

1. ✅ `tsc --noEmit` exits 0
2. ✅ `npm run build` produces all 7 expected artifacts
3. ✅ Playwright Electron spec passes (real Electron, real DOM)
4. ✅ Spec asserts on the specific behavior the user reported
5. ✅ User confirms visual correctness in dev

If any of (3) or (4) is missing, you're guessing. Write the spec, run
it, then claim the fix.

## Source

Battle-tested across app-map-downloader (2026-07-18 → 2026-07-20) and
osmtile-poc (2026-07-11 → 2026-07-15) sessions. Playwright Electron
turned a "we can't verify anything" pain point into a 4-second feedback
loop. Without it, every GPU warning or IPC bug required the user to
restart `npm run dev` and copy console output by hand.
