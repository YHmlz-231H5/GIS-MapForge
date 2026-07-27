# Electron + Vite 6 `base: './'` — must be top-level, not `build.base`

## Symptom

```
$ npm run build:renderer
✓ built in 2.6 s
$ grep 'src=' dist/index.html
    <script src="/vendor/maplibre-gl.js"></script>
    <script type="module" crossorigin src="/assets/index-Df8lgJbY.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-DtpszV1G.css">
```

All `<script>` and `<link>` hrefs start with `/`, even though `vite.config.ts`
has `build: { base: './' }`. When the Electron app loads the file via
`mainWindow.loadFile()`, those absolute paths resolve to filesystem
**root** (e.g. `file:///D:/assets/...`) — which doesn't exist. App loads
HTML but no JS, no CSS, no React. Page is `<div id="root"></div>`
empty, console quiet.

```
url: chrome-error://chromewebdata/
rootHasContent: 0
inputCount: 0
```

## Root cause

Vite 6 changed how `base` is resolved:

- **Vite 4/5**: `build: { base: './' }` propagated to top-level `cfg.base`
- **Vite 6**: `build.base` is silently ignored; `cfg.base` stays as `/`

Verify by reading config:
```bash
$ node -e "const v=require('vite'); v.resolveConfig('vite.config.ts','build').then(c=>console.log(c.base,c.build.base))"
/ .
```

`top-level base: /`, `build.base: .` — exactly the silent bug.

## Fix

Move `base` to top level of `defineConfig()`:

```ts
// ❌ WRONG in vite 6
export default defineConfig(({ command }) => ({
  build: { outDir: 'dist', base: './' },  // ignored
}));

// ✅ RIGHT
export default defineConfig(({ command }) => ({
  base: './',  // top-level, propagates
  build: { outDir: 'dist' },
}));
```

After this, output is:
```html
<script src="./vendor/maplibre-gl.js"></script>
<script type="module" crossorigin src="./assets/index-Df8lgJbY.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-DtpszV1G.css">
```

## CLI-flag workaround (when you can't edit config)

`vite build --base=./` (command-line override) DOES work in vite 6 —
only the config-form `build.base` is broken. If you can't modify the
config file, prepend `--base=./` to your build script:

```json
{
  "scripts": {
    "build:renderer": "vite build --base=./"
  }
}
```

But the top-level fix is the right answer — CLI flag loses self-documentation.

## Why this matters for Electron

Electron apps load bundled assets via two paths:

| Path | URL scheme | Absolute `/assets/x.js` resolves to |
|---|---|---|
| `vite dev` (npm run dev) | `http://localhost:5173` | `localhost:5173/assets/x.js` ✓ |
| `loadFile` (production) | `file://` | `file:///D:/assets/x.js` ✗ |

Relative `./assets/x.js` works in both. So **Electron apps need `base: './'`**
from day 1 — and vite 6 silently ignores `build.base`.

## Verification

After fix:
```bash
$ npm run build:renderer
$ grep -E '(src|href)=' dist/index.html | head -5
    <script src="./vendor/maplibre-gl.js"></script>
    <script src="./vendor/pmtiles.js"></script>
    <script type="module" crossorigin src="./assets/index-XXX.js"></script>
```

If `src=` still starts with `/`, your `base` setting is in the wrong place.

## Related pitfalls

- **Pitfall 41** (electron-loadfile-url-routing.md) — Even with relative
  paths, Playwright Electron needs `MAP_LOAD_FROM_DIST` env var to force
  `loadFile` instead of trying to load `ELECTRON_RENDERER_URL`.
- **Pitfall 33** (electron-gpu-csp-fixes.md) — CSP needs to be `<meta>`
  in `index.html`, not `session.webRequest.onHeadersReceived` (which
  doesn't see vite dev traffic).

## Source

Verified 2026-07-20 against vite 6.0.5 + `@playwright/test` 1.61.1 +
Electron 33.2.1 on Windows 11.
