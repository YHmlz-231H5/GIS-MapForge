# Playwright Electron: forcing `loadFile` instead of vite-dev URL

## Symptom

When `app-map-downloader` is launched under Playwright (`_electron.launch({args: ['.']})`),
the resulting renderer URL is:

```
url: chrome-error://chromewebdata/
rootHasContent: 0
inputCount: 0
htmlSnippet: <html><head></head><body></body></html>
```

`chrome-error` is the page Chrome shows when navigation fails. The window
is empty. The `loadFile` branch in `main/index.ts` is never reached.

## Why it happens

Default `main/index.ts` routing:

```ts
const isDev = !app.isPackaged;

if (isDev && process.env['ELECTRON_RENDERER_URL']) {
  mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);  // vite dev
} else {
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'));  // prod
}
```

Under Playwright:

- `app.isPackaged === false` (Playwright runs Electron unpackaged) → `isDev = true`
- `process.env.ELECTRON_RENDERER_URL` is **not set** (no vite dev running)
- Branch falls through to `loadURL(undefined)` → Chrome error page

## Fix

Add an explicit escape hatch — `MAP_LOAD_FROM_DIST` env var overrides the
vite-dev branch in test mode:

```ts
// src/main/index.ts
if (isDev && process.env['ELECTRON_RENDERER_URL'] && !process.env.MAP_LOAD_FROM_DIST) {
  mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  mainWindow.webContents.openDevTools({ mode: 'detach' });
} else {
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}
```

In your Playwright spec, set the env var:

```ts
const electronApp = await electron.launch({
  args: ['.', '--disable-gpu', '--no-sandbox'],
  cwd: PROJECT_DIR,
  env: {
    ...process.env,
    MAP_LOAD_FROM_DIST: '1',  // ← skip vite-dev URL routing
  },
});
```

## Verification

After fix, dump the page state:

```ts
const dump = await window.evaluate(() => ({
  url: window.location.href,
  title: document.title,
  rootHasContent: document.getElementById('root')?.children?.length ?? 0,
}));
// expect: url = "file:///.../dist/index.html"  (NOT chrome-error)
// expect: title = "地图下载器"
// expect: rootHasContent >= 1  (React mounted)
```

## Don't forget: relative asset paths

`base: './'` in vite.config.ts (Pitfall 40) is required too. `loadFile`
uses `file://` protocol, where absolute `/assets/x.js` resolves to
`file:///D:/assets/x.js` (filesystem root, doesn't exist). Relative
`./assets/x.js` is what Electron needs.

## Alternative: skip Electron entirely

If you only need renderer-state tests (no IPC, no `loadFile` branching
complexity), use Playwright's regular Chromium with `vite dev`:

```ts
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('http://localhost:5173/');  // vite dev URL
```

This is faster but loses the Electron-specific IPC channel tests.
Use `_electron.launch()` for full-stack, `chromium.launch()` for
renderer-only.

## Related

- **Pitfall 37** (electron-playwright-headless.md) — full Playwright Electron recipe
- **Pitfall 40** (electron-vite-base-path.md) — vite 6 `base` config gotcha
- **Pitfall 39** (electron-playwright-headless.md) — `__dirname` vs `process.cwd()` in specs
