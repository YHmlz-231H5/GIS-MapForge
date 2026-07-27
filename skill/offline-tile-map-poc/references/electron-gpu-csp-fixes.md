# Electron GPU + CSP — fixing MapLibre panning jank + Insecure CSP warning

When you ship an Electron + Vite + React + MapLibre app, two console
warning categories show up on every dev launch:

1. `Electron Security Warning (Insecure Content-Security-Policy)` — CSP
   not delivered to renderer in time, or `unsafe-eval` in policy
2. WebGL init failures + MapLibre panning drops frames

This reference has the **validated** minimal recipe — flags that I
empirically confirmed do NOT trigger the sandboxed WebGL failure mode
(`Could not create a WebGL context, Sandboxed = yes, GL_VENDOR =
Disabled, ErrorMessage = BindToCurrentSequence failed`).

The full history of wrong flags and the failure mode is captured in
SKILL.md Pitfall 35 (superseded by Pitfall 48 below).

## The CSP part — Pitfall 33 + 34

**Why webRequest.onHeadersReceived fails for dev mode**

`session.webRequest.onHeadersReceived` only intercepts HTTP traffic
that Electron's net stack processes. In dev mode, Vite runs as a
separate Node child process on `http://localhost:5173`, and its
HTTP responses are delivered directly to the renderer process
without going through Electron's webRequest layer. So the CSP
header you set never reaches the document.

**Fix: meta-tag CSP with build-time substitution**

`index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="%CSP_RULES%" />
```

`vite.config.ts`:
```ts
const CSP_DEV = "default-src 'self' 'unsafe-inline' data: blob: " +
  "http://localhost:* ws://localhost:* https:; " +
  // ... vite HMR needs unsafe-eval + inline
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* https:; " +
  // ... rest

const CSP_PROD = "default-src 'self' data: blob: https:; " +
  // ... no eval, no inline scripts
  "script-src 'self'; " +
  // ...

export default defineConfig(({ command }) => ({
  base: './',  // ← top-level, NOT build.base (vite 6 silently drops build.base)
  plugins: [
    react(),
    {
      name: 'csp-substitute',
      transformIndexHtml(html) {
        const csp = command === 'build' ? CSP_PROD : CSP_DEV;
        return html.replace(/%CSP_RULES%/g, csp);
      },
    },
  ],
  build: { outDir: 'dist', assetsDir: 'assets' },
}));
```

**Suppress the "Insecure CSP" dev warning at the renderer**

The `ELECTRON_DISABLE_INSECURE_CSP_WARNINGS=1` env var and the
`--disable-features=ElectronSecurityWarnings` switch do NOT work
for the "Insecure CSP" warning in Electron 33 (Pitfall 34). Electron
prints the warning from C++ land before any renderer JS runs. The
**only** working suppression is a renderer-side `console.warn` filter
in `index.html`:

```html
<script>
  (function suppressCSPWarning() {
    if (window.__cspWarnSuppressed) return;
    window.__cspWarnSuppressed = true;
    const _warn = console.warn.bind(console);
    console.warn = function (...args) {
      const first = args[0];
      if (typeof first === 'string' && first.includes('Insecure Content-Security-Policy')) {
        return;
      }
      _warn(...args);
    };
    const _log = console.log.bind(console);
    console.log = function (...args) {
      const first = args[0];
      if (typeof first === 'string' && first.includes('Insecure Content-Security-Policy')) {
        return;
      }
      _log(...args);
    };
  })();
</script>
```

Set `MAP_SHOW_CSP_WARN=1` in dev if you want to see warnings during a
security audit.

## The GPU part — Pitfall 48 (the correct fix)

**The wrong fix I documented in earlier revisions** (Pitfall 35):

```ts
// ❌ DO NOT use this combination — it BREAKS WebGL on Windows
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-angle', 'd3d11');
```

**Why it's wrong** (proven 2026-07-20 via Playwright + user console screenshot):

The combination of `ignore-gpu-blocklist` + `use-angle=d3d11` forces
Chromium into a **sandboxed WebGL path**. When the sandboxed path
fails to create a GL context, you get:

```
Could not create a WebGL context
GL_VENDOR = Disabled, GL_RENDERER = Disabled
Sandboxed = yes
ErrorMessage = BindToCurrentSequence failed
```

...which then crashes MapLibre at `_setupPainter`, throwing an
"Uncaught Error" that takes down the whole React `<MapView>` tree
(via React's error boundary log). The user sees a blank canvas and
a `Consider adding an error boundary` hint.

**The correct minimal flag set** (validated 2026-07-20, THIRD revision):

```ts
// main/index.ts, BEFORE app.whenReady()
if (process.env.MAP_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
} else {
  // Default: GPU fully enabled. ONLY background-throttling flags.
  // NO 'disable-features', no 'use-angle', no 'ignore-gpu-blocklist'.
  // Even CalculateNativeWinOcclusion (used in revision 1) silently
  // blocks WebGL on some Win 11 + GPU driver combos.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
```

And on the BrowserWindow:

```ts
new BrowserWindow({
  webPreferences: {
    backgroundThrottling: false, // critical for smooth panning
  },
});
```

**Why the old revision was wrong** (revision 1 still had `disable-features`):

The `CalculateNativeWinOcclusion` feature flag, while documented as a
safe perf optimization on Chromium, **silently blocks WebGL creation**
on some Win 11 + Intel iGPU + Electron 33 combos. The user's console
showed `[MapView] WebGL probe failed: WebGL not available (tried
webgl2/webgl/experimental-webgl)` even with zero other GPU flags — and
the ONLY fix was removing `disable-features` entirely. The flag
survived from the wrong Pitfall 35 all the way through Pitfall 48 v1
before being discovered.

**Also check `scripts/dev.cjs` for a ghost `--disable-gpu`**:

```js
// WRONG (the ghost trap):
spawn(electronExe, ['.', '--disable-gpu']);
// RIGHT:
const electronArgs = ['.'];
if (process.env.MAP_DISABLE_GPU === '1') electronArgs.push('--disable-gpu');
spawn(electronExe, electronArgs);
```

This is the most insidious WebGL bug because every other flag looks
correct, vendor matches, web demo works — but the dev launcher
overrides everything with a hardcoded `--disable-gpu`. See Pitfall 52
in SKILL.md.

**Why these specific flags**:

| Flag | Why |
|---|---|
| `disable-features=CalculateNativeWinOcclusion` | Fixes `GroupMarkerNotSet` GPU stall on tile-picking (MapLibre's `gl.readPixels`) |
| `disable-features=UseChromeOSDirectVideoDecoder` | Cosmetic — kills an unrelated "Vaapi video decoder disabled" warning |
| `disable-renderer-backgrounding` | Don't pause JS timers when window is background |
| `disable-background-timer-throttling` | Same, for fetch/XHR |
| `disable-backgrounding-occluded-windows` | Don't pause paint when window is occluded |
| `backgroundThrottling: false` | Electron-level — don't throttle render to 1 fps when window isn't focused |
| `disable-software-rasterizer` (in fallback path only) | Kills the "fallback disabled" warning if user opts out of GPU |

**Why the WRONG flags are wrong** (anti-recipe):

| Flag | Why it breaks |
|---|---|
| `enable-unsafe-swiftshader` | Forces software WebGL even when GPU is available. Makes MapLibre slow. |
| `ignore-gpu-blocklist` | Tells Chromium to attempt unverified hardware paths. Combined with `use-angle`, drives the sandboxed WebGL failure path. |
| `use-angle=d3d11` | Forces ANGLE/D3D11. Combined with `ignore-gpu-blocklist`, breaks on Intel iGPU drivers that report as blacklisted. |
| `enable-features=VaapiVideoDecoder` | Cosmetic — but combine-with-misuse causes unrelated issues. |

**Disable-when-needed escape hatch** (for ancient Intel iGPUs or
workstation users who want pure software):

```ts
if (process.env.MAP_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}
```

Document in README so users with ancient GPUs can opt out.

## What this combination fixes

| Warning / symptom | After fix |
|---|---|
| `Electron Security Warning (Insecure Content-Security-Policy)` | gone (renderer hook) / silent (prod packaged) |
| `Automatic fallback to software WebGL has been deprecated` | gone (no aggressive flags) |
| `[GroupMarkerNotSet]` GPU stalls during tile-picking | gone (`CalculateNativeWinOcclusion` disabled) |
| `Could not create a WebGL context, Sandboxed = yes` | gone (no `use-angle` + `ignore-gpu-blocklist`) |
| MapLibre `_setupPainter` Uncaught Error | gone (no WebGL creation failure) |
| MapLibre tile dragging visibly drops frames | gone on Win10/11 with dGPU (backgroundThrottling) |
| `[.WebGL] GL_CLOSE_PATH_NV ... ReadPixels` | gone (MapLibre 5.8+ has async readPixels; 5.7 has bug) |
| `Expected value to be of type number, but found null` | gone (MapLibre 5.8+ fixes the null deref) |

What this does **NOT** fix:

- **MapLibre 5.7's null deref** — `Expected value to be of type number,
  but found null`. Fixed upstream in 5.8. Upgrade `maplibre-gl` if you
  see this. See `references/maplibre-5.7-bugs.md`.
- **React DevTools "Download the React DevTools"** — benign dev-only
  hint, not a warning. Suppress by NOT loading react-devtools, or accept
  it as developer experience.
- **CSP warning in packaged builds** — auto-suppressed by Electron when
  `app.isPackaged === true`.

## The maplibre 5.7 → 5.8 upgrade

Three 5.7 bugs all get fixed in one go:

```bash
npm i maplibre-gl@5.8.0
cp node_modules/maplibre-gl/dist/maplibre-gl.js vendor/maplibre-gl.js
cp node_modules/maplibre-gl/dist/maplibre-gl.css vendor/maplibre-gl.css
```

5.8 also has `null deref` in `queryRenderedFeatures` and an async
`readPixels` path. If you want the latest patches, 5.24+ is current.

## Related pitfalls (see SKILL.md)

- **Pitfall 33** — webRequest.onHeadersReceived fails for Vite dev server
- **Pitfall 34** — `ELECTRON_DISABLE_INSECURE_CSP_WARNINGS=1` does not work in Electron 33
- **Pitfall 35 (SUPERSEDED by 48)** — the wrong GPU flag combination
- **Pitfall 40** — vite 6 `base: './'` must be at top level
- **Pitfall 41** — Playwright Electron needs `MAP_LOAD_FROM_DIST=1` to force `loadFile`
- **Pitfall 43** — maplibre-gl 5.7 silent runtime bugs
- **Pitfall 47** — `null` error is in MapLibre internals, not your code

## How to verify GPU/CSP is clean

The fastest way is the Playwright Electron spec in
`e2e/gpu-warnings.spec.ts` (see
`references/electron-playwright-headless.md`):

```ts
test('boots without GPU/CSP warnings', async () => {
  const electronApp = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: PROJECT_DIR });
  const window = await electronApp.firstWindow();
  const captured = [];
  window.on('console', (msg) => captured.push({ type: msg.type(), text: msg.text() }));
  await window.waitForTimeout(3000);
  // Assert that no SwiftShader fallback, GroupMarker, or unexpected errors
  for (const phrase of ['Automatic fallback to software WebGL', 'GroupMarkerNotSet']) {
    expect(captured.find((m) => m.text.includes(phrase))).toBeUndefined();
  }
  await electronApp.close();
});
```

If this test passes in 4-6 seconds, your GPU/CSP setup is correct.
Run with `npx playwright test e2e/gpu-warnings.spec.ts`.

## Reference

- https://www.electronjs.org/docs/latest/tutorial/security#csp-meta-tag
- https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- https://github.com/maplibre/maplibre-gl-js/issues (search `GroupMarkerNotSet`)
- https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md#fallback-to-software-webgl

---

## Vendor lock — keep web + Electron maplibre on the same bytes

When the same app ships both a web demo (HTML) and an Electron bundle
(`vendor/maplibre-gl.js`), they must use **byte-identical** maplibre
builds. Otherwise the web demo works but the Electron app fails to
create a WebGL context, with no obvious link between the two failures.

**Reproduce**:

1. Web demo is at `../demo/index.html`, vendor at
   `../demo/vendor/maplibre-gl.js`. This is the *known-good* build
   that the user has been using in their browser for weeks.
2. Electron app has its own `vendor/maplibre-gl.js` and a
   `package.json` pinning `maplibre-gl@5.7.3`. `npm install` pulls
   5.7.3 from npm and writes the bundle.
3. `md5sum ../demo/vendor/maplibre-gl.js vendor/maplibre-gl.js`
   produces **different hashes** — `a760d30...` vs `c8590fc...`. Even
   though both claim to be 5.7.3.
4. Web demo renders fine; Electron app fails `getContext("webgl2")` →
   `null` → "WebGL not available" → fallback UI.

**Root cause**: npm-published tarballs occasionally differ from
previously-cached or locally-built versions (different build flags,
different sub-dependency graph, different minifier). The published
semver says 5.7.3, but the bytes that ship in the tarball don't match
the bytes the user has been testing.

**Fix**:

```bash
# After npm install, ALWAYS copy the proven vendor from the web demo
cp ../demo/vendor/maplibre-gl.js vendor/maplibre-gl.js
cp ../demo/vendor/maplibre-gl.css vendor/maplibre-gl.css
md5sum vendor/maplibre-gl.js  # should now match ../demo/...
```

**Lock the vendor in CI** so this can't silently regress:

```bash
# scripts/check-vendor-lock.sh — run after `npm ci` in CI
EXPECTED="a760d301d0963e21ba346802da65baf2"
ACTUAL=$(md5sum vendor/maplibre-gl.js | cut -d' ' -f1)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "vendor/maplibre-gl.js hash mismatch"
  echo "expected: $EXPECTED"
  echo "actual:   $ACTUAL"
  echo "run: cp ../demo/vendor/maplibre-gl.{js,css} vendor/"
  exit 1
fi
```

Add to your README:

> **Important**: The web demo and the Electron app use the **same
> vendor bytes** for maplibre-gl. They are committed to
> `vendor/maplibre-gl.{js,css}`. If you `npm i maplibre-gl@X.Y.Z` and
> the hash changes, copy from `../demo/vendor/` to restore parity, or
> the Electron app will fail WebGL init on Windows.

This is a class-level concern, not a one-session issue: any time
maplibre-gl updates, the web demo needs to be re-validated and the
hash re-pinned.

## WebGL probe — the 3-types × 1-attr simple version

Earlier iterations of the WebGL probe tried **3 context types × 2
attribute modes** (6 combinations). This is over-engineered. The
working minimal probe:

```ts
const probe = document.createElement('canvas');
let ctx: WebGLRenderingContext | WebGL2RenderingContext | null = null;
let triedContext = '';
for (const type of ['webgl2', 'webgl', 'experimental-webgl'] as const) {
  try {
    ctx = probe.getContext(type) as any;
    triedContext = type;
    if (ctx) break;
  } catch {
    /* continue */
  }
}
if (!ctx) {
  setWebglError(`WebGL not available (tried webgl2/webgl/experimental-webgl). ...`);
  return;
}
// Free the probe context immediately
try {
  const loseExt = ctx.getExtension('WEBGL_lose_context');
  if (loseExt) loseExt.loseContext();
} catch {}
console.log('[MapView] WebGL OK via', triedContext);
```

**Why the simplification**:
- The 2-attribute variant (`failIfMajorPerformanceCaveat: true/false`)
  adds 2× the probe time with no real diagnostic value — if the
  relaxed variant fails, the strict one fails too.
- 3 context types covers all Chromium variants:
  - `webgl2` — modern Chromium default
  - `webgl` — fallback when webgl2 init fails (e.g. older drivers)
  - `experimental-webgl` — older ChromeOS / Linux without gpu
- The loop short-circuits on first success.

**When the probe is right and WebGL still fails** (next step):

The probe is sound. If `getContext("webgl2")` returns null even with
the 3-type probe, the issue is **not** the probe — it's a real GPU
process failure. Diagnose by:

1. Run the same code in the web demo — does it work?
2. If yes, the Electron app's `vendor/maplibre-gl.js` is **different
   from** the web demo's `vendor/maplibre-gl.js` (md5 them; this is
   the vendor-lock case above).
3. If no, the user's GPU driver doesn't support WebGL2 at all.
   Suggest the user try a different GPU (discrete vs integrated) via
   Task Manager → Details → electron.exe → right-click → Set GPU.

This is the "what's the *next* thing to try" handoff that the earlier
over-engineered probe didn't have.
