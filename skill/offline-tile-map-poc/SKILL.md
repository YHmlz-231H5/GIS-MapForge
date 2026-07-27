---
name: offline-tile-map-poc
description: Offline map data — download OSM or raster XYZ tiles; Planetiler vector tiling to PMTiles/MBTiles; MapLibre preview. CN/intl sources, layer exclude via Planetiler CLI, raster MBTiles packing.
---
# Offline Tile Map PoC

Focus: **map download + tiling/packaging** (vector and raster). Electron app notes exist but are secondary.

## Trigger phrases

- 矢量瓦片 / 生成矢量瓦片 / PMTiles / MBTiles / Planetiler / exclude-layers / 标准自定义
- 栅格瓦片 / XYZ / raster download / OpenTopoMap / Carto / Esri imagery
- Overpass / Geofabrik / PBF / OSM 下载
- maxzoom 14 / maxzoom 16 / transportation_name
- maplibre / 离线地图 / 行政区 / Photon / DataV

## Decision tree

1. **Pipeline overview** → `references/vector-tile-pipeline.md`
2. **Where to download OSM** → `references/pbf-data-sources.md`
3. **Planetiler options (truth)** → `references/planetiler-convert-options.md`
4. **Two-step OSM → archive** → `references/two-step-pbf-pmtiles-flow.md`
5. **Raster XYZ download** → `references/raster-xyz-download.md`
6. **Validate vector archive** → `references/planetiler-output-validation.md`
7. **Windows Planetiler** → `references/planetiler-windows.md`
8. Layer Q1–Q6 → **deprecated** `references/pmtiles-layer-curator.md`

## Quick facts

- Vector: OSM download ≠ tiles. Planetiler **slices** then **packs** `.pmtiles` / `.mbtiles`.
- Standard maxzoom **14**; custom up to **16**. `--exclude-layers` is real.
- Raster: XYZ PNG/JPEG; **MBTiles is the natural pack**; PMTiles **format** supports raster tileType but JS packer is limited — use directory + `go-pmtiles convert`.
- CN OSM download: Overpass mirrors, not `api.openstreetmap.org`.

## App map (optional)

- Download chooser: vector vs raster (`DownloadTypeDrawer`)
- Raster sources: `src/shared/raster-sources.ts`
- Convert dialog: archive + standard/custom (`LayerCurationDrawer`)

Electron / Playwright / Vite pitfalls remain later in this file for desktop packaging only.


- Pitfall 56 (NEW 2026-07-20): `loadFile` path for Electron main bundle.
  After esbuild, `__dirname` = `dist-electron/main/`, so `join(__dirname,
  '../renderer/index.html')` → `dist-electron/renderer/index.html` (wrong).
  The renderer output lives at `dist/index.html`. Fix: `join(__dirname, '..',
  '..', 'dist', 'index.html')`. Symptom: `ERR_FILE_NOT_FOUND` with the wrong
  path in the error message; page goes to `chrome-error://chromewebdata/`.

- Pitfall 57 (NEW 2026-07-20): CSP `script-src 'self'` blocks inline `<script>`
  tags in production builds. Inline scripts (like the CSP warning suppressor)
  must be moved to an **external file** loaded via `<script src="...">`.
  Created `vendor/suppress-csp-warning.js` as a standalone IIFE; index.html
  loads it with `<script src="./vendor/suppress-csp-warning.js"></script>`.
  This passes `script-src 'self'` because the file is same-origin.

- Pitfall 58 (NEW 2026-07-20): Playwright Electron **full-flow e2e tests**
  are the fastest way to debug submit/worker/IPC errors without a Windows
  desktop. The test boots Electron with `MAP_LOAD_FROM_DIST=1`, captures
  **both** main-process stderr/stdout (via `electronApp.process()`) AND
  renderer `console` events, then drives the real UI: fill search → press
  Enter → wait for Photon+DataV → click "下一步" → click "生成 PBF" →
  wait for IPC → print ALL logs. This surfaces scheduler queuing, DB
  insert failures, and worker-path errors in a 25-second feedback loop.
  See `references/electron-playwright-full-flow.md`.

## Trigger phrases

- "playwright full flow" / "e2e submit test" / "full submit flow" / "scheduler DB insert debug" (NEW 2026-07-20) (load when user says any of)
- "worker crash" / "worker exited code 1" / "pbf-osm-api" / "electron.exe worker" / "process.argv0" / "node spawn" (NEW 2026-07-22)
- "open source github" / "fork-able" / "self-contained" / "planetiler jar" / "tools/" / "cross-directory reference" (NEW 2026-07-22)
- "overpass" / "api.openstreetmap.org" / "fetch failed" / "connection timeout" / "CN network" / "镜像" (NEW 2026-07-22)
- "merge-helper" / "pure js merge" / "no osmium" / "native rebuild" / "XML dedup" (NEW 2026-07-22)
- "coord normalize" / "bbox swap" / "zero-area tile" / "EPS" / "float rounding" (NEW 2026-07-22)
- "dev.cjs workers" / "rebuild workers" / "stale worker" / "workers not rebuilt" (NEW 2026-07-22)
- "planetiler xml" / "Header longer than 64 KiB" / "osm-xml-to-pbf" / "@osmix/pbf" / "Nodes must be sorted" (NEW 2026-07-21)
- "osm_path" / "options.region undefined" / "生成PMTiles" / "Cannot read properties of undefined (reading 'name')" (NEW 2026-07-21)
- "photon extent" / "west north east south" / "UL→LR" / "komoot/photon#708" (NEW 2026-07-21)
- "planetiler aux" / "lake_centerline" / "data/sources" / "Java UnresolvedAddressException" (NEW 2026-07-21)
- "地图下载器不是离线应用" / "app needs network" / "完整离线运行" (NEW 2026-07-21)
- "progress bar stuck" / "__pendingProgress" / "tile-plan" / "download tiles overlay" / "红绿切片" (NEW 2026-07-21)

- maplibre / PMTiles / 离线地图 / 离线瓦片
- 下载矢量地图 / 下载栅格瓦片 / 区域下载 / PBF → PMTiles / Planetiler
- Nominatim / OSM API tile 下载 / Geofabrik
- 行政区 / adcode / Photon / 高德 / DataV / 关键字搜索行政区划 (NEW 2026-07-19)
- 开源 github / fork-able / 不需要 key / API key 不要 (NEW 2026-07-19)
- basemap 切换 / 底图 / 卫星图 / 矢量瓦片
- top-left / 左上角 / 当前底图高亮 / ACTIVE 来源指示 (NEW 2026-07-19)
- Electron + 地图 / PC 桌面 + 离线 / 中文路径
- layer 6 问 / curator / 选择图层 / OpenMapTiles schema
- GPU 警告 / SwiftShader / GroupMarkerNotSet / 帧率 / 掉帧 / 拖动卡顿 / 性能 (NEW 2026-07-20)
- CSP / Insecure / 安全警告 / 沙箱验证 / Playwright / headless (NEW 2026-07-20)
- vite 6 / base: './ / build.base / 相对路径 / file:// / loadFile 失败 (NEW 2026-07-20)
- worker / .mjs / .js / esbuild 扩展名 / __dirname 路径 (NEW 2026-07-20)
- desktop app 调试 / 沙箱跑 Electron / CDP / chrome-remote-interface / 远程调试 (NEW 2026-07-20)
- maplibre 5.7 / 5.8 / readPixels / Expected value to be of type number (NEW 2026-07-20)
- vendor lock / vendor hash / web + electron 同步 / maplibre 不同 hash (NEW 2026-07-20)
- "全屏滚动条" / "w-screen" / "横向滚动条" (NEW 2026-07-20)
- "layer 抽屉" / "弹出框太大" / "居中" / "细滚动条" / "上下椭圆形" (NEW 2026-07-20)
- "playwright full flow" / "e2e submit test" / "full submit flow" / "scheduler DB insert debug" (NEW 2026-07-20)
- "沙箱调试" / "sandbox 调试" / "headless 测试" / "Playwright Electron" / "GUI 替代" (NEW 2026-07-20)
- "fork vs spawn" / "electron.exe worker" / "worker crash" / "process.execPath" (NEW 2026-07-20)
- "分成两步" / "pbf和pmtiles分开" / "两个步骤" / "先下载再转换" (NEW 2026-07-20)

## Quick navigation

### Decision tree (when user asks "build a map downloader")

1. **One-page PoC (browser only)**: `templates/index.html` + `references/pbf-to-pmtiles-recipe.md`
2. **Multi-region switcher**: `templates/index-multi-region.html` + `references/multi-region-pattern.md`
3. **Electron desktop app**: `references/pitfall-26-desktop-app-wrap.md` (W1..W7 walkthrough)
4. **Layer curation before PMTiles**: `references/pmtiles-layer-curator.md` + UI in `pmtiles-layer-curator-ui.md`
5. **CN administrative region by name (no API key)**: `references/cn-adcode-keyword-search.md`

### Common pitfalls (search "Pitfall N" in this file)

- Pitfall 22: msys Git Bash truncates large XML responses (use Python `urllib` not curl)
- Pitfall 24b: Planetiler OpenMapTiles maxzoom=14 (not 15/16); `transportation_name` layer needed for street labels
- Pitfall 25: better-sqlite3 native binding must compile before first use
- Pitfall 26: Electron + Vite + esbuild split (vite-plugin-electron has bugs at scale)
- Pitfall 27 (NEW 2026-07-19): CN basemap switcher should default to **top-left**, not top-right (per user pref)
- Pitfall 28 (NEW 2026-07-19): DataV.GeoAtlas datacenter IPs get 200-OK-with-empty-body from
  CI/sandbox. Real user IPs work fine. Don't diagnose from sandbox alone.
- Pitfall 29 (NEW 2026-07-19): JSX `<>{cond && <span/>}</>` fragments — when `cond` is typed
  `unknown` (e.g. `Region.boundary_geojson: unknown`), TypeScript errors with
  "Type 'unknown' is not assignable to type 'ReactNode'". Wrap with `Boolean()`:
  `{Boolean(x) && <span/>}`.
- Pitfall 30 (NEW 2026-07-19): When patching TS/JSX source via Python tools, never write
  template literals as `\\\`\\${expr}\\\`` — that escapes to literal backslashes in the
  source. Use direct template strings: `\`\${expr}\`` (single backslash + dollar
  inside the heredoc). The shell has nothing to do with it; the file ends up
  with literal `\` in the title attribute, which both esbuild and tsc reject.
- Pitfall 31 (NEW 2026-07-19): For open-source map apps targeting CN users, the **Photon-only
  default path** is the right v1. Don't ship with required API keys. Allow
  optional 高德/腾讯/百度 backends in Settings, but default to Photon (no key)
  so users can fork-and-run with zero config. See `cn-adcode-keyword-search.md`.
- Pitfall 32 (NEW 2026-07-20): Photon's `lang` query param accepts **only**
  `{default, de, en, fr}` — NOT `zh`, `ja`, `ko`, `ru`. Passing `lang=zh`
  returns HTTP 400 with body `{"lang":[{"message":"Language is not
  supported. Supported are: default, de, en, fr","value":"zh"}]}`. Don't
  set `lang` at all — the search query (`q=`) is already in the user's
  locale and Photon's response text comes back matched to it. See
  `cn-adcode-keyword-search.md` gotcha #6.
- Pitfall 33 (NEW 2026-07-20): Electron `session.webRequest.onHeadersReceived`
  CSP injection **does not intercept Vite dev server responses**. Vite runs
  as a separate Node child process on `localhost:<port>`, so its HTTP
  traffic is NOT routed through Electron's `webRequest` API. The CSP
  header you set on Electron never reaches the browser in `npm run dev`
  mode → "Insecure CSP" warning stays. Fix: inject CSP via `<meta
  http-equiv="Content-Security-Policy">` in `index.html` (works in both
  dev and prod); use `vite.config.ts`'s `transformIndexHtml` plugin to
  swap dev-vs-prod policy strings via `%CSP_RULES%` placeholder.
  See `electron-electron-gpu-csp-fixes.md` for full recipe.
- Pitfall 34 (NEW 2026-07-20, **corrected** 2026-07-20 after Playwright
  spec proved otherwise): The `ELECTRON_DISABLE_INSECURE_CSP_WARNINGS=1`
  env var and `--disable-features=ElectronSecurityWarnings` switch
  **do NOT actually suppress** Electron 33's "Insecure CSP" dev warning.
  Electron prints the warning from C++ land before any renderer JS runs
  (verified by Playwright Electron spec capturing `console.warn`
  events). Only the inline `console.warn` filter in `index.html`
  suppresses it. In packaged builds (`app.isPackaged === true`) the
  warning is auto-suppressed; for dev, accept the warning or filter at
  the renderer. See `electron-gpu-csp-fixes.md` for the working recipe.
- Pitfall 35 (SUPERSEDED 2026-07-20 by Pitfall 48 — DO NOT FOLLOW):
  Earlier version documented `--use-angle=d3d11` + `--ignore-gpu-blocklist`
  + `--enable-unsafe-swiftshader` as the "minimum flag set" for
  MapLibre panning. **Wrong.** That combination forces Chromium into a
  sandboxed WebGL path which then FAILS to create a GL context with
  `GL_VENDOR=Disabled, GL_RENDERER=Disabled, Sandboxed=yes, ErrorMessage =
  BindToCurrentSequence failed`. The user's console screenshot proved
  this: MapLibre crashes with `Could not create a WebGL context` and the
  whole React tree goes down via `_setupPainter`. See Pitfall 48 for
  the correct fix.
- Pitfall 36 (NEW 2026-07-20): When reporting verification results, the
  user prefers **a short verification table at the end** ("Verification
  PASSED — clean run | Gate | Result | ..."), not a narrative summary.
  Tables with file sizes + exit codes are easier to scan than prose.
  See the workflow section in this skill's body.
- Pitfall 37 (NEW 2026-07-20): When verifying Electron app behavior
  headlessly (no GUI sandbox), use **`@playwright/test` + `_electron.launch()`**
  to boot the real Electron binary and capture `window.on('console', ...)`
  events. This unblocks all "console warning" debugging without a Windows
  desktop. The recipe is in `references/electron-playwright-headless.md`.
  Pattern: `npm i -D @playwright/test` + a `e2e/*.spec.ts` that
  `_electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: PROJECT_DIR })`
  + `firstWindow()` + `window.on('console', ...)`. Run with
  `npx playwright test`. Total cold-boot ~4 s.
- Pitfall 38 (NEW 2026-07-20): When concatenating Electron command-line
  flags via `app.commandLine.appendSwitch()`, **same-key calls overwrite
  the previous value**. Specifically `appendSwitch('disable-features', 'A')`
  then `appendSwitch('disable-features', 'B')` results in only `B` being
  applied. Combine multiple feature flags into a single call:
  `appendSwitch('disable-features', 'A,B,C')`. Same trap applies to
  `enable-features`. Bug caught when adding `ElectronSecurityWarnings`
  flag for CSP suppression — silently lost the existing
  `CalculateNativeWinOcclusion,UseChromeOSDirectVideoDecoder` flags.
- Pitfall 39 (NEW 2026-07-20): In Playwright Electron specs, **`__dirname`
  points to the spec's directory** (e.g. `e2e/`), not the project root.
  When you write `const PROJECT_DIR = join(__dirname, '..')`, you get the
  parent directory — but if the project root IS the test directory's
  parent (one level deeper than expected), `path.join('..', 'dist-electron/...')`
  resolves to a non-existent path and `test.skip` fires silently. Use
  `process.cwd()` instead — Playwright runs specs from the project root.
  Symptom: test always skips with "Build first: <path> missing" even when
  the file exists at the expected location.
- Pitfall 40 (NEW 2026-07-20): Vite 6's `base` option **must be at the top
  level of `defineConfig()`, not under `build`**. Setting
  `build: { base: './' }` works in vite 4/5 but is silently ignored in
  vite 6 — `cfg.base` stays as `/`, all `<script src="/assets/...">` and
  `<link href="/assets/...">` remain absolute. Symptom: Electron app
  loads but JS/CSS 404, page stays blank (`<div id="root"></div>`
  empty, `url: chrome-error://chromewebdata/`). Fix:
  ```ts
  export default defineConfig({
    base: './',  // ← top-level, NOT build.base
    build: { outDir: 'dist' },
  });
  ```
  This affects Electron apps that load `dist/index.html` via `loadFile`
  (file:// protocol) — absolute paths point at filesystem root, not the
  app bundle. See `references/electron-vite-base-path.md` for the full
  diagnosis and CLI-flag workaround.
- Pitfall 41 (NEW 2026-07-20): When Playwright `_electron.launch()` is
  invoked without setting up the vite dev server, Electron still tries to
  load `process.env.ELECTRON_RENDERER_URL` if `app.isPackaged === false`
  — and ends up with `chrome-error://chromewebdata/` (no URL). The
  default `main/index.ts` branches on
  `isDev && process.env.ELECTRON_RENDERER_URL` to decide `loadURL` vs
  `loadFile`. To force `loadFile` under Playwright (where vite dev is
  not running), add an explicit escape hatch: a `MAP_LOAD_FROM_DIST`
  env var that overrides the dev branch. Set it in your Playwright
  spec's `env: { ...process.env, MAP_LOAD_FROM_DIST: '1' }` block.
  ```ts
  if (isDev && process.env['ELECTRON_RENDERER_URL'] && !process.env.MAP_LOAD_FROM_DIST) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
  ```
  Symptom: `await window.waitForTimeout(4000); await window.evaluate(...)`
  returns `url: chrome-error://chromewebdata/` and `rootHasContent: 0`.
  See `references/electron-loadfile-url-routing.md`.
- Pitfall 42 (NEW 2026-07-20): When 3-pane desktop apps (left = controls,
  center = map, right = task list), use a single **zustand store at the
  React root** with selectors per component. Don't lift state to the
  App component and pass props — every IPC update re-renders the whole
  tree. The pattern that worked:

  ```ts
  // store.ts — single source of truth
  export const useAppStore = create<AppState>((set) => ({
    region: null, setRegion: (r) => set({ region: r }),
    tasks: [], setTasks: (t) => set({ tasks: t }),
    basemapId: 'openfreemap-liberty', setBasemapId: (b) => set({ basemapId: b }),
    // ...
  }));
  // RegionPanel.tsx — selector subscribes to specific fields only
  const region = useAppStore((s) => s.region);  // re-renders only when region changes
  ```
  Avoid: `const { region, setRegion, tasks, setTasks } = useAppStore()` —
  subscribes to the entire state, re-renders on any field change.
  Pattern validated in `app-map-downloader/` (left panel: ~30 KB,
  center: ~5 KB, right: ~10 KB; render budget ~16 ms each).
  See `references/multi-pane-react-state-pattern.md`.

- Pitfall 43 (NEW 2026-07-20): When upgrading maplibre-gl, **5.7.3 has 3
  silent runtime bugs that show up in DevTools as red errors**:
  1. `Expected value to be of type number, but found null instead.`
     (MapLibre 5.7 tile-picking returns null for a numeric field)
  2. Repeated `GPU stall due to ReadPixels` (synchronous readPixels
     blocks GPU thread; tile-picking fix is async in 5.8)
  3. `GroupMarkerNotSet(crbug.com/242999)` "Automatic fallback to
     software WebGL has been deprecated" (cascades from #1+#2)
  Upgrade to 5.8.0+ (or 5.9+ for terrain 3D, etc.) and they all vanish.
  Don't waste time debugging these in your own code; they're MapLibre
  internals. See `references/maplibre-5.7-bugs.md` for the verification
  recipe.
- Pitfall 44 (NEW 2026-07-20): Playwright `_electron.launch(['.', ...])`
  boots the Electron binary as **unpackaged** (`app.isPackaged === false`).
  Your main process code branches on `isDev && ELECTRON_RENDERER_URL`
  to decide `loadURL` vs `loadFile`. In Playwright the vite dev server
  is NOT running, so `loadURL(undefined)` fails and the page goes to
  `chrome-error://chromewebdata/`. Add an env-var escape hatch to your
  main code:
  ```ts
  if (isDev && process.env['ELECTRON_RENDERER_URL'] && !process.env.MAP_LOAD_FROM_DIST) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
  ```
  Set `MAP_LOAD_FROM_DIST=1` in the Playwright spec's `env:` block.
  See `references/electron-vite-sandbox-debug.md`.
- Pitfall 45 (NEW 2026-07-20): Vite 6 silently drops `build.base` from
  `defineConfig`. Symptom: `dist/index.html` contains
  `<script src="/assets/...">` (absolute) even though you set
  `build: { base: './' }`. Under `loadFile` (file:// protocol), absolute
  paths resolve to filesystem root, not the app bundle, so the page
  stays blank. Fix: put `base` at the **top level** of `defineConfig`:
  ```ts
  export default defineConfig({
    base: './',   // ← top level, NOT build.base
    build: { outDir: 'dist' },
  });
  ```
  This took ~20 minutes of debug to find in a real session because
  `cfg.build.base` reads back correctly via `resolveConfig` but the
  emitted HTML still uses `/assets/...`. CLI flag `--base=./` works
  because it overrides the resolved value, but config-file `build.base`
  is ignored. See `references/electron-vite-sandbox-debug.md`.
- Pitfall 46 (NEW 2026-07-20): For an offline-first, fork-friendly
  desktop map app, the **basemap catalog default must be a no-key source
  that works in both CN and intl networks**. Validated config:
  - **Vector (free, no key)**: OpenFreeMap Liberty / Bright
    (`https://tiles.openfreemap.org/styles/liberty`)
  - **Raster satellite (free, no key)**: ESRI World Imagery
    (`https://server.arcgisonline.com/ArcGIS/.../World_Imagery/.../{z}/{y}/{x}`)
  - **CN-specific (free, no key)**: 高德 streets
    (`https://webrd02.is.autonavi.com/appmaptile?style=7&...`)
  - **CN-specific satellite (free, no key)**: 高德 satellite
    (`https://webst02.is.autonavi.com/appmaptile?style=6&...`)
  - **OSM (free, no key, slow in CN)**: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
  - **Intl satellite (free, no key)**: Google satellite
    (`https://mt1.google.com/vt/lyrs=s&...`) — works in most countries
    except CN; use ESRI or 高德 as fallback there.
  - **Optional (key required)**: MapTiler Streets / Outdoor
    (`https://api.maptiler.com/maps/streets/style.json?key=...`)
  MapTiler key goes in Settings panel as optional; never default to it.
  See `references/electron-vite-sandbox-debug.md` and
  `references/basemap-catalog-probe.md` for the head-probe health-check
  pattern that auto-picks the working one.
- Pitfall 47 (NEW 2026-07-20): The `Expected value to be of type number,
  but found null` runtime error in MapLibre < 5.8 is **not** in your
  code — it comes from `maplibre-gl.js` internals. Trying to fix it by
  guarding `coalesce([get, 'name:zh'], ...)` in your style spec doesn't
  help because the bug is in `queryRenderedFeatures` / tile-picking.
  Symptoms: the error appears immediately on map load (before any
  user interaction), and continues every time MapLibre picks a feature
  (mouse hover, click). The only fix is upgrade. Confirmed: 5.7.3 buggy,
  5.8.0 fixed, 5.9+ also fixed. See `references/maplibre-5.7-bugs.md`.

- Pitfall 48 (UPDATED 2026-07-20 — THIRD REVISION): The TRULY minimal
  GPU flag set for Electron 33 + Windows + MapLibre. After 3 rounds of
  debugging, the winning config has **zero** `disable-features` flags.
  Even `CalculateNativeWinOcclusion` (used in revision 1) silently blocks
  WebGL context creation on some Win 11 + GPU driver combos.
  ```ts
  // main/index.ts, BEFORE app.whenReady()
  if (process.env.MAP_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  } else {
    // Default: GPU fully enabled. ONLY background-throttling flags.
    // NO 'disable-features', no 'use-angle', no 'ignore-gpu-blocklist'.
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  }
  // BrowserWindow
  new BrowserWindow({
    webPreferences: { backgroundThrottling: false, /* ... */ },
  });
  ```
  **What each removed flag actually did (verified via Playwright Electron headless)**:
  - `--use-angle=d3d11` + `--ignore-gpu-blocklist`: triggered sandboxed WebGL
    path (`Sandboxed=yes, GL_VENDOR=Disabled, BindToCurrentSequence failed`)
  - `--enable-unsafe-swiftshader`: Chromium 110+ deprecated this opt-in mechanism
  - `disable-features=CalculateNativeWinOcclusion`: **silently blocks WebGL on
    some Win 11 + Electron 33 combos** (the last flag to remove before WebGL
    finally worked)
  - `disable-features=ElectronSecurityWarnings`: literally no-op in Electron 33
    (the CSP warning is C++-land, not Chromium's feature-flag system)
  **Moral**: don't cargo-cult GPU flags from Chromium docs into Electron.
  Each flag is a WebGL-killer on some hardware. Start with ZERO flags and
  add only if a verified Playwright headless spec demands it.
  See `references/electron-gpu-csp-fixes.md` for the full debug log.

- Pitfall 49 (NEW 2026-07-20): **Playwright Electron is the
  real-time feedback loop you didn't know you had.** When the sandbox
  is headless and the user can't easily run dev on their Windows
  desktop, write a `_electron.launch()` spec to boot the real Electron
  binary in CI, capture `window.on('console', ...)` events, and assert
  on what should/shouldn't appear. Pattern:
  ```ts
  import { test, expect, _electron as electron } from '@playwright/test';
  test('boots without GPU warnings', async () => {
    const app = await electron.launch({
      args: ['.', '--disable-gpu', '--no-sandbox'],
      cwd: PROJECT_DIR,
      env: { ...process.env, MAP_LOAD_FROM_DIST: '1' },
    });
    const win = await app.firstWindow();
    const msgs: any[] = [];
    win.on('console', m => msgs.push({ type: m.type(), text: m.text() }));
    await win.waitForTimeout(3000);
    for (const phrase of ['Automatic fallback to software WebGL', 'GroupMarkerNotSet']) {
      expect(msgs.find(m => m.text.includes(phrase))).toBeUndefined();
    }
    await app.close();
  });
  ```
  Total cold-boot ~4-6 s. Run with `npx playwright test`. This is
  the **only** way to validate GPU/CSP setup without a Windows desktop,
  short of packaging. Combined with `MAP_LOAD_FROM_DIST=1` env var
  to bypass the vite-dev URL routing, this becomes a 30-second feedback
  loop for "did my last change break GPU init?". See
  `references/electron-playwright-headless.md` for the full recipe.

- Pitfall 52 (NEW 2026-07-20): The `scripts/dev.cjs` dev launcher spawns
  Electron **with `--disable-gpu` hardcoded in the args array**.
  This is the most insidious class of WebGL failure because it looks
  identical to a GPU/driver problem. Symptom: every other GPU fix is
  applied, vendor matches, web demo works, but Electron still prints
  `[MapView] WebGL probe failed: WebGL not available (tried
  webgl2/webgl/experimental-webgl)`. The clue is in the Electron spawn
  args — `spawn(electronExe, ['.', '--disable-gpu'])` is the culprit.
  Fix: `[ '.', ...(process.env.MAP_DISABLE_GPU === '1' ? ['--disable-gpu'] : []) ]`.
  Don't silently disable GPU for dev; make it opt-in only.
  See `references/electron-gpu-csp-fixes.md` section "dev.cjs ghost trap".

- Pitfall 53 (NEW 2026-07-20): `w-screen` on Windows generates a horizontal
  scrollbar in fullscreen. `100vw` includes scrollbar width. Fix: replace
  `w-screen` → `w-full overflow-hidden` on root container. `h-screen` stays.

- Pitfall 54 (UPDATED 2026-07-20): LayerCurationDrawer UX triad — sizing,
  positioning, and scrollbar. `max-w-4xl` (896px) exceeds 3-pane Electron
  viewport. Fix: `max-w-2xl` (672px) + `max-h-[78vh]` + shrink padding from
  `p-5` → `p-4`, Planetiler from `-mx-5` → `-mx-4`. Position: **`items-end`
  (bottom-aligned) → `items-center` (centered)**, `rounded-t-lg` → `rounded-lg`.
  Scrollbar: add `.thin-scroll` CSS class with `::-webkit-scrollbar { width:
  5px }`, transparent track, `border-radius: 9999px` thumb in `#c4c9cf`.

- Pitfall 64 (REVISED 2026-07-20 — 3rd rewrite after live PBF download debugging): **Worker spawn in Electron 33: final working recipe.** Three independent issues blocked worker execution:

    1. **ESM extension**: esbuild with `format: "esm"` outputs `.js` but keeps `import` syntax. Node's CJS loader chokes on import statements. Fix: `outExtension: { '.js': '.mjs' }` in `build-workers.cjs`. Output: `pbf-osm-api.worker.mjs`, `merge-helper.mjs`, etc.

    2. **`spawn(process.execPath, [workerPath, ...args])` IS the correct call.** `fork()` also uses `process.execPath` (electron.exe) internally — identical behavior. `electron.exe script.mjs` runs the script as an Electron main process without BrowserWindow, which works for Node-style workers. Use `spawn()` with `{ stdio: ['ignore', 'pipe', 'pipe'] }` — `child.stdout`/`child.stderr` are non-nullable (no `?.` needed).

    3. **Handler paths must use `.mjs`**: `join(__dirname, '..', 'workers', 'pbf-osm-api.worker.mjs')`. Worker's dynamic import: `await import('./merge-helper.mjs')`.

    4. **Error-debug logging in handlers** (Pitfall 69): Worker failures are invisible without `console.error`. Add: `child.stderr.on('data', (chunk) => { console.error('[handler] stderr:', chunk.toString().trim()); ... })`, `child.on('error', (e) => { console.error('[handler] spawn error:', e.message); })`, `child.on('close', (code) => { if(code!==0) console.error('[handler] exit code', code) })`. Plus `console.error('[scheduler] task failed:', task.id, task.kind, msg)` in scheduler's catch. These print to the terminal — the user can see them.

- Pitfall 65 (NEW 2026-07-20): **Vite does NOT auto-copy `vendor/` files to `dist/`.** Post-build `dist/vendor/` is empty → all vendor scripts 404. Fix in `package.json` `build:renderer`: add a post-build `node -e` step to cp 4 vendor files (maplibre-gl.js/css, pmtiles.js, suppress-csp-warning.js).

- Pitfall 66 (NEW 2026-07-20): **Split PBF download and PMTiles generation into two steps.** User preference: clicking submit in LayerCurationDrawer only creates the `pbf-download-osm-api` task. When that task completes, a green "生成PMTiles" button appears on the completed task card in TaskQueue. Clicking it creates the `planetiler-convert` task with stored layer options. Button text: "▶ 下载 PBF" not "生成 PBF + PMTiles". See `references/two-step-pbf-pmtiles-flow.md`.

- Pitfall 68 (REVISED 2026-07-20): **esbuild ESM workers need `.mjs` extension for Node loader.** `format: "esm"` outputs `.js` with `import` syntax, which Node's CJS loader rejects (`SyntaxError: Cannot use import statement outside a module`). Fix: `outExtension: { '.js': '.mjs' }` in `build-workers.cjs` esbuild config. Handler paths: `join(__dirname, '..', 'workers', '<name>.worker.mjs')`. Worker dynamic import: `await import('./merge-helper.mjs')`. Verify: `ls dist-electron/workers/` → `*.mjs`.

 - Pitfall 69 (NEW 2026-07-20): **Worker failures are invisible without explicit `console.error` logging in handlers.** By default, worker stderr is only routed to the renderer via `pushLog('err', ...)`. The terminal where `npm run dev` runs shows nothing. Add 3 log points in every handler: (1) `child.stderr.on('data', (chunk) => { const t = chunk.toString().trim(); console.error('[handler] stderr:', t); pushLog('err', t); })`; (2) `child.on('error', (e) => { console.error('[handler] spawn error:', e.message); reject(e); })`; (3) `child.on('close', (code) => { if(code!==0) console.error('[handler] exit code:', code); ... })`. Also in scheduler's catch: `console.error('[scheduler] task failed:', task.id, task.kind, message)`. Without these, `Worker exited with code 1` is all you see — never the actual stderr. See `references/electron-worker-error-logging.md`.

- Pitfall 72 (NEW 2026-07-22): **Overpass API instead of OSM API for Chinese networks.** `api.openstreetmap.org` is frequently unreachable from CN (connection timeout). Overpass has 3 public mirrors that rotate on failure:
    ```js
    const OVERPASS_ENDPOINTS = [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];
    ```
    Use `POST` with `Content-Type: application/x-www-form-urlencoded`, body `data=<query>`. Overpass query bbox order is `(south, west, north, east)`. Timeout 90s. Retry with backoff 1.5s × attempt. This was the fix after 7 failed `code 1 / zero stderr` worker crash iterations — the worker was actually crashing because `fetch()` to `api.openstreetmap.org` timed out. See `references/electron-worker-node-spawn-fix.md`.

- Pitfall 73 (NEW 2026-07-22): **Worker errors invisible without double-logging to both stdout AND stderr.** The handler only reads `child.stdout` for NDJSON progress, so errors written exclusively to stderr are lost. Fix in worker: `send()` function writes log entries to `process.stdout` (NDJSON) AND mirrors errors to `process.stderr` (plain text). Then in handler: `child.stderr.on('data', (chunk) => { console.error('[handler] stderr:', chunk.toString().trim()); })` — errors now visible in terminal. The `errDetail(err)` helper extracts `err.cause.code` and `err.cause.message` for actionable diagnostics (e.g. `fetch failed (ENOTFOUND: api.openstreetmap.org)`).

- Pitfall 74 (REVISED 2026-07-21 — **do NOT claim Planetiler reads XML**): **Pure-JS OSM XML merge — drop native osmium dependency.** Native `osmium` requires `electron-rebuild` and native bindings for every Electron version. For small regions, a pure-JS XML merge using `Map` dedup is sufficient:
    ```js
    const nodes = new Map(), ways = new Map(), rels = new Map();
    for (const tile of tiles) {
      const xml = readFileSync(tile, 'utf8');
      for (const el of extractElements(xml, 'node')) nodes.set(elementId(el), el);
      // ...
    }
    writeFileSync('merged.osm', '<?xml...><osm>' + [...nodes.values(), ...ways.values(), ...rels.values()] + '</osm>');
    ```
    Output of the **download** step: `.osm` (XML). **Planetiler does NOT accept `.osm` XML** (earlier skill text was wrong — verified 2026-07-21: `IllegalArgumentException: Header longer than 64 KiB` from `OsmInputFile.readBlobHeader`). Before Planetiler, convert XML → `.osm.pbf` with pure-JS `@osmix/pbf` (see Pitfall 77). Removes `osmium` from `package.json` / `postinstall`. Regex: `/<tag\s[^>]*?\/>|<tag\s[\s\S]*?<\/tag>/g`.

- Pitfall 75 (NEW 2026-07-22): **Coordinate normalization + zero-area tile skip in worker.** Bbox corners can arrive inverted (W>E or S>N) from Photon extent. Fix: `if (W > E) [W, E] = [E, W]; if (S > N) [S, N] = [N, S];` BEFORE tiling. Float rounding can produce degenerate cells (`e - w < EPS`) when `E` or `N` is exactly on a cell boundary. Fix: `const EPS = 1e-9; for (let s = S; s < N - EPS; s += CELL)` and check `if (e - w < EPS || n - s < EPS) continue;`. Without this, worker creates `tile_001.osm` with 0 bytes, Overpass returns error or empty XML, merge produces broken output.

- Pitfall 76 (NEW 2026-07-22): **`npm run dev` must rebuild workers.** Worker `.mjs` files are NOT hot-reloaded by Vite (they run in a separate Node process). If you edit the worker but don't rebuild, Electron reuses the stale `dist-electron/workers/*.mjs` from the last build. Fix: `dev.cjs` now calls `buildWorkers()` alongside `buildPreload()` and `buildMain()` before launching Electron. This ensures all 3 bundles are fresh on every `npm run dev`. **Also keep `buildMain` defined** — replacing it when adding `buildWorkers` causes `ReferenceError: buildMain is not defined` and `npm run dev` dies before Electron launches.

- Pitfall 77 (NEW 2026-07-21 — verified on app-map-downloader): **XML → PBF before Planetiler; nodes/ways/rels MUST be sorted by ID.** Pipeline:
    1. Overpass tiles → pure-JS merge → `merged.osm`
    2. `@osmix/pbf` (`osmBlockToPbfBlobBytes` + `concatUint8`) → `merged.osm.pbf` (or `<path>.osm.pbf`)
    3. `java -jar planetiler.jar --osm-path=...pbf --bbox=... --output=...pmtiles --download=false --download_dir=data/sources`
    Dense/non-dense nodes written in appearance order will fail Planetiler pass1 with: `Nodes must be sorted ascending by ID, X came after Y`. Fix: sort XML elements by numeric `id` **before** encoding blocks. Also delta-encode way `refs` and relation `memids`. Default granularity `1e7` (degrees × 1e7). Chunk ≤ ~4000 entities/block (`MAX_ENTITIES_PER_BLOCK`).

- Pitfall 78 (NEW 2026-07-21): **「生成PMTiles」必须传 `options.osm_path = task.output_path`。** Symptom: `Cannot read properties of undefined (reading 'name')` from stale code using `task.options.region.name`, or Planetiler starts with a bogus relative path. `task.options.region` is often unset (region lives on `task.region`). Correct submit:
    ```ts
    await window.api.submitTask({
      kind: 'planetiler-convert',
      region: task.region,
      options: {
        ...task.options,
        region: task.region,
        osm_path: task.output_path, // absolute path from completed download
        planetiler: { ...task.options?.planetiler, download_aux: true },
      },
    });
    ```
    Handler must read `task.options.osm_path || task.output_path`, refuse if missing/absent on disk. Detect Java via `execFile(cmd, ['-version'])` — `existsSync('java')` is always false for PATH binaries.

- Pitfall 79 (NEW 2026-07-21): **Photon `extent` is `[west, north, east, south]` (upper-left → lower-right), NOT GeoJSON `[minLon,minLat,maxLon,maxLat]`.** Confirmed by komoot/photon#708 and live API (`extent[1] > extent[3]` for latitudes). Mapping into app `BBox = [minLon, minLat, maxLon, maxLat]`:
    ```ts
    const [west, north, east, south] = props.extent;
    const bbox = [Math.min(west,east), Math.min(south,north), Math.max(west,east), Math.max(south,north)];
    ```
    Without this: S>N → worker tiling loop yields **0 cells** → exit 1 in seconds (looks like "worker crash").

- Pitfall 80 (NEW 2026-07-21): **Planetiler aux sources: prefer Node/curl pre-fetch over Java `--download=true` on CN networks.** Java `HttpClient` often fails with `UnresolvedAddressException` / `ConnectException` on `github.com/acalcutt/osm-lakelines/...` even when Node `fetch` / `curl` succeed. Expected files under `data/sources/`:
    - `lake_centerline.shp.zip` (~80 MB) — `https://github.com/acalcutt/osm-lakelines/releases/download/v12/lake_centerline.shp.zip`
    - `water-polygons-split-3857.zip` (~880 MB) — `https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip`
    - `natural_earth_vector.sqlite.zip` (~414 MB) — `https://naciscdn.org/naturalearth/packages/natural_earth_vector.sqlite.zip`
    Use `curl -L -C -` for resume; skip if `stat.size >= minBytes`. Then spawn Planetiler with `--download=false --download_dir=<abs data/sources>`. Gitignore `data/`.

- Pitfall 81 (NEW 2026-07-21): **Product positioning — this is a map downloader, NOT a fully-offline app.** App basemap tiles, Photon/DataV search, and Overpass/Geofabrik downloads all need network. `vendor/` only embeds MapLibre/PMTiles **libraries** (no CDN), not offline basemap tiles. Planetiler conversion is local once OSM input + aux sources exist; the **output** PMTiles is what other apps use offline. Do not document "完整离线运行".

- Pitfall 82 (NEW 2026-07-21): **Progress bar stuck at 0% — `__pendingProgress` was a dead end.** Worker NDJSON `progress` was stored on `(global).__pendingProgress` and never written to SQLite / never sent via `task:update`. Renderer only polled `listTasks` every 5s and had no `subscribeTaskUpdates`. Fix:
    1. Handler calls `pushProgress({ ratio, phase, tiles })` → `Tasks.update` + `broadcastTaskUpdate`
    2. Preload exposes `subscribeTaskUpdates` on `task:update`
    3. App.tsx `upsertTask` on live updates (keep 5s poll as backup)
    4. Worker emits `tile-plan` (all cell bboxes as pending) then per-tile `progress` with `tileIndex` + `tileStatus`
    5. MapView draws GeoJSON polygons: pending=red, done=green, failed=amber; re-apply on `style.load`
    On task `done`, merge previous `progress.tiles` into the final `{ ratio: 1 }` patch so the green grid stays visible.

- Pitfall 70 (NEW 2026-07-22): **Self-contained project for GitHub open-source — zero cross-directory references.** For a fork-and-run experience, scan for: `join(__dirname, '..')`, `process.cwd()/../*`, `app.getAppPath()/../*`. Fix: copy `planetiler.jar` (89 MB) into `tools/`, remove `../tools/` fallbacks from `system.ts` and `planetiler-convert.ts`, add `tools/planetiler.jar` to `.gitignore` (users download separately). See `references/github-self-contained-project.md`.```
    fails in Electron", **compare vendor MD5 hashes** between the web demo
    and the Electron app's `vendor/` directory. The two must be byte-identical.
    Symptom: web demo loads map fine; Electron app boots but
    `getContext("webgl2")` returns null after upgrade. Even `npm i
    maplibre-gl@5.7.3` can produce a vendor with a *different hash* than
    the demo's pre-bundled one (e.g. `c8590fc...` vs `a760d30...`).
    Fix: `cp ../demo/vendor/maplibre-gl.{js,css} vendor/` to copy the
    known-good bytes directly. Lock the vendor build to a committed binary,
    not a semver range. Add CI hash-check.
  web demo and the Electron app's `vendor/` directory. The two must
  be byte-identical (or both come from the same `node_modules` install).
  Symptom: web demo loads map fine; Electron app boots but
  `getContext("webgl2")` returns null after upgrade; `npm i
  maplibre-gl@5.7.3` produces a vendor with a *different hash* than
  the demo's pre-bundled vendor (e.g. `c8590fc...` vs `a760d30...`).
  Fix: `cp ../demo/vendor/maplibre-gl.{js,css} vendor/` to copy the
  known-good bytes directly. Even the same published version can
  differ from a previously-cached tarball — verify the hash, not the
  semver. After copying, both stacks use Chromium 110 webgl init
  identically and the WebGL context succeeds. Lesson: in a fork-able
  open-source map app, **lock the vendor build** to a specific
  committed binary, not a `package.json` semver range. CI then
  enforces the lock by hash-comparing the installed `dist/` against
  the committed `vendor/`. Without the lock, a future `npm i` can
  silently swap in a different build that breaks the user's GPU
  driver. See `references/electron-gpu-csp-fixes.md` for the
  vendor-lock CI snippet.

- Pitfall 50 (NEW 2026-07-20): When verifying anything, lead with
  a **table** showing gate/result. The user dislikes prose. Shape:
  ```
  # Verification PASSED — clean run
  | Gate | Result |
  |---|---|
  | `tsc --noEmit` | TSC=0 |
  | `vite build` | ✓ 47 modules in 2.65 s |
  | esbuild main | 40 KB |
  | Playwright e2e | 1 passed (6.6s) |

  ## What passed
  <file path>: <1-line summary>
  ## Concrete blocker
  <one line: needs interactive Windows desktop>
  ```
  Even failures get the same shape — replace the "What passed" section
  with "Repaired: <fix>". Don't switch to prose. Don't lecture about
  what you tried. Just the table.

## Required reading order for a new session

1. `references/research-summary.md` — 5-minute overview
2. `references/pmtiles-layer-curator.md` — Phase 8a, mandatory before any PMTiles build
3. The relevant section above based on decision tree
4. The matching template in `templates/`

## Reference index (load on demand)

- `basemap-catalog-probe.md` — 13-source basemap catalog with HEAD-probe pattern
- `cn-adcode-keyword-search.md` — Photon (Komoot) + DataV + 高德 关键字→adcode/bbox
- `electron-gpu-csp-fixes.md` — Electron+MapLibre GPU/CSP setup (Pitfall 33-35)
- `electron-playwright-headless.md` — `_electron.launch()` for sandbox-side console capture (Pitfall 37-39)
- `electron-playwright-full-flow.md` — full-flow e2e pattern: search → drawer → submit → capture ALL logs (Pitfall 58)
- `electron-tsconfig-esbuild.md` — vite+esbuild 3-build split for Electron main/preload/workers
- `electron-worker-paths.md` — esbuild .mjs→.js + `__dirname` path fix for worker spawns (Pitfall 55)
- `electron-worker-fork-spawn-fix.md` — fork() vs spawn(process.execPath) for Electron workers (Pitfall 62)
- `electron-worker-error-logging.md` — handler/scheduler console.error debug logging recipe (Pitfall 69)
- `two-step-pbf-pmtiles-flow.md` — split PBF download + PMTiles generation into two UI steps (Pitfall 66, 77–78; requires `osm_path`)
- `electron-worker-node-spawn-fix.md` — worker spawn saga: fork→spawn→node 4-iteration fix (Pitfall 62)
- `github-self-contained-project.md` — zero cross-directory references for open-source (Pitfall 70)
- `electron-vite-base-path.md` — vite 6 `base: './'` must be top-level, not `build.base` (Pitfall 40)
- `electron-loadfile-url-routing.md` — Playwright Electron loads vite-dev URL by default; force `loadFile` via env var (Pitfall 41)
- `electron-vite-sandbox-debug.md` — full Playwright Electron headless workflow for sandbox-side console capture (Pitfall 37, 44, 45)
- `maplibre-5.7-bugs.md` — maplibre-gl 5.7.3 silent runtime bugs + 5.8.0 upgrade recipe (Pitfall 43, 47)
- `multi-pane-react-state-pattern.md` — zustand store with 3-pane layout pattern (Pitfall 42)
- `desktop-app-debugging-tools.md` — Playwright Electron + chrome-remote-interface + Windows dev combo (Pitfall 37)
- `longhua-bbox-end-to-end.md` — full W4 case study (88 OSM API tiles → Planetiler → preview)
- `memory-requirements.md` — JVM heap sizing by region size
- `multi-region-pattern.md` — Firenze + Australia + Longhua switcher pattern
- `osm-main-api-bbox-extract.md` — fetching arbitrary bbox via OSM API 88-tile grid
- `pbf-data-sources.md` — Geofabrik / OSM planet / OSM API / BBBike
- `pbf-to-pmtiles-recipe.md` — Planetiler run command
- `pitfall-26-desktop-app-wrap.md` — full Electron desktop app walkthrough
- `planetiler-output-validation.md` — `audit-pmtiles.py` schema validation
- `planetiler-windows.md` — Windows-specific Planetiler quirks
- `pmtiles-layer-curator-ui.md` — UI integration of Layer Set 6-questions
- `pmtiles-layer-curator.md` — 6-question layer-set data model
- `tile-clipping-geometry.md` — why Planetiler clips tiles (vs tippecanoe not)
- `research-summary.md` — original research, now superseded by this skill

## How to invoke this skill's scripts

- `scripts/audit-pmtiles.py <file.pmtiles>` — validate PMTiles against OpenMapTiles schema
- `scripts/layer_curator.py --purpose city --preset` — generate LayerSet defaults
- `scripts/verify-offline.sh` — confirm a build has no CDN dependencies

## How to invoke this skill's scripts

- Pitfall 57 (NEW 2026-07-20): CSP `script-src 'self'` blocks inline `<script>`
  tags in production builds. Inline scripts (like the CSP warning suppressor)
  must be moved to an **external file** loaded via `<script src="...">`.
  Created `vendor/suppress-csp-warning.js` as a standalone IIFE; index.html
  loads it with `<script src="./vendor/suppress-csp-warning.js"></script>`.
  This passes `script-src 'self'` because the file is same-origin.

- Pitfall 58 (NEW 2026-07-20): Playwright Electron **full-flow e2e tests**
  are the fastest way to debug submit/worker/IPC errors without a Windows
  desktop. The test boots Electron with `MAP_LOAD_FROM_DIST=1`, captures
  **both** main-process stderr/stdout (via `electronApp.process()`) AND
  renderer `console` events, then drives the real UI: fill search → press
  Enter → wait for Photon+DataV → click "下一步" → click "生成 PBF" →
  wait for IPC → print ALL logs. This surfaces scheduler queuing, DB
  insert failures, and worker-path errors in a 25-second feedback loop.
  See `references/electron-playwright-full-flow.md`.

- Pitfall 59 (NEW 2026-07-20): **Vite does NOT auto-copy `vendor/` files
  to `dist/`.** Manual `<script src="./vendor/maplibre-gl.js">` tags in
  `index.html` reference files that Vite doesn't track (they're outside
  the src tree). After `vite build`, `dist/vendor/` is empty → all 4
  vendor files 404 → page loads blank in Electron `loadFile` mode.
  Symptom: `ERR_FILE_NOT_FOUND` for `vendor/*` resources, no MapLibre,
  white screen. Fix: add a post-build copy step to `package.json`'s
  `build:renderer` script:
  ```json
  "build:renderer": "vite build && node -e \"const{existsSync,mkdirSync,cpSync}=require('fs');const d='dist/vendor';if(!existsSync(d))mkdirSync(d,{recursive:true});['maplibre-gl.js','maplibre-gl.css','pmtiles.js','suppress-csp-warning.js'].forEach(f=>{if(existsSync('vendor/'+f))cpSync('vendor/'+f,d+'/'+f)})\""
  ```
  Verify with `ls dist/vendor/` — must show all 4 files after build.

- Pitfall 61 (NEW 2026-07-20): **Scheduler `tick()` skips light tasks when no heavy found**. The original code in `scheduler.ts` called `Tasks.list({ status: 'queued' })` INSIDE the `if (!runningHeavy)` branch and returned immediately after starting a heavy task. If no heavy was queued, it returned without checking light tasks, leaving light tasks stuck as `'queued'` forever. Fix: call `Tasks.list()` once, use the result for both heavy and light dispatch in the same tick. Symptom: task shows in TaskQueue as "queued" but never advances to "running". Console shows `enqueue` + `DB insert` but no `dispatching` / `start task` log. Also add diagnostic `console.log` in `tick()` and `start()` so the next session can see exactly which path was taken — see `references/electron-scheduler-debug.md`.

- Pitfall 62 (FINAL 2026-07-22 — VERIFIED working after 7 live Electron spawn iterations): **Worker spawning in Electron 33: the ONLY approach that actually works on Windows.** Seven failed iterations before success:

    1. ❌ `fork(workerPath, args)` — `fork()` uses `process.execPath` (electron.exe) to spawn → worker treated as Electron app, exits code 1, zero stderr.
    2. ❌ `spawn(process.execPath, [workerPath, ...args])` — same as #1, electron.exe CANNOT run Node workers.
    3. ❌ `spawn('node', ...)` from PATH — Windows cmd resolution may pick wrong Node version or fail silently.
    4. ❌ `spawn(process.argv0, ...)` inside Electron main — `process.argv0` IS electron.exe in Electron's main process (same as `process.execPath`).
    5. ❌ `spawn(process.env.HERMES_NODE_BIN, ...)` without setting the env var — undefined, falls back to `'node'`, same as #3.

    6. **✅ WORKING**: Bridge the gap — `dev.cjs` (runs as real node) stores its `process.argv0` (real node.exe path) in Electron's env, handler reads it back:

    ```js
    // scripts/dev.cjs — this script IS node.exe, so process.argv0 is the real node binary
    env: { HERMES_NODE_BIN: process.argv0 }
    ```
    ```ts
    // pbf-osm-api.ts handler
    const nodeBin = process.env.HERMES_NODE_BIN || 'node'; // ← real path from dev.cjs
    const child = spawn(nodeBin, [workerPath, ...scriptArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    ```

    **Why this is the only correct approach**: Electron's `process.argv0`/`process.execPath` are BOTH `electron.exe`. Spawning electron.exe with a JS/MJS file starts a new Electron app (creates BrowserWindow), never a Node worker. The real Node binary only exists in `dev.cjs`'s process. So we pass it through env. Workers verified running with this recipe: `node pbf-osm-api.worker.mjs --w ... --s ... --e ... --n ... --tile-dir ...` produces NDJSON progress output on stdout.

- Pitfall 63 (NEW 2026-07-20): **`vite build` does NOT auto-copy `vendor/` to `dist/`.** Manual `<script src="./vendor/...">` in index.html references files outside vite's source tree. After build, `dist/vendor/` is empty → all vendor files 404. Fix: add post-build copy in `package.json`'s `build:renderer` — see the one-liner in Pitfall 59 for the exact `node -e` command. Verify with `ls dist/vendor/` after build.
  Electron = silent worker crash.** `process.execPath` is `electron.exe`,
  which expects to create a BrowserWindow. Passing a `.js` worker script
  as the first argument makes Electron try to boot another Electron app —
  which either crashes or exits with a cryptic error. The correct API is
  `child_process.fork(workerPath, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })`.
  `fork()` uses the **Node.js binary bundled with Electron** (not
  electron.exe), runs the script as a plain Node.js worker, and
  auto-sets up IPC. After switching from `spawn` to `fork`, note that
  `child.stdout` and `child.stderr` become `Readable | null` (TS type
  narrows them to nullable) — add `?.` before `.on('data', ...)`.
  See `references/electron-worker-paths.md` for the full migration recipe.

## Verification reporting convention

After running `tsc --noEmit && npm run build` (or any verification
command), always report results in **this exact shape** (the user
prefers tables over narrative; verbosity is the #1 complaint):

```
# Verification PASSED — clean run

| Gate | Result |
|---|---|
| `tsc --noEmit` | TSC=0 (0 type errors) |
| `vite build` | ✓ 47 modules in 2.65 s |
| esbuild main | 40 KB |
| Playwright e2e | 1 passed (6.6s) |

## What passed
<file path>: <1-line summary of each changed file>

## Concrete blocker
<npm run dev requires interactive Windows desktop — cannot launch Electron in headless sandbox.>
```

**Why this shape**: tables with file sizes + exit codes are easier to
scan than prose. The user has flagged "做太多非关键点" / "调试很麻烦"
multiple times; this is the anti-verbosity hook. Even when something
fails, keep the same shape — add a "Repaired: <fix>" line in the
body, don't switch to prose mode.

If verification fails: lead with the failing command, the failing
exit code, and the **specific** error message (not a paraphrase).
Don't say "build broke" — say "build/main/index.cjs failed: esbuild
'Cannot find module osmium'".

---

## Pitfall 27: basemap switcher default position — TOP-LEFT, not top-right

When building a basemap/source switcher component inside an Electron or
browser MapLibre wrapper, the **default initial position should be the
upper-left corner** (`top-3 left-3`), not upper-right. The upper-right is
already occupied by MapLibre's `NavigationControl` (zoom in/out + compass).
Putting the switcher there forces a collision that requires extra
z-index/spacing work, and on smaller viewports it clips.

Additionally, the **active source MUST be visually distinct** in two ways:

1. The collapsed button always shows the current basemap name + a green
   "● ACTIVE" pill, so the user never has to click the switcher just to
   know what's currently rendering.
2. When the dropdown is open, the currently-selected row gets a strong
   highlight (emerald ring + `✓ 当前` badge). Don't just bold the text —
   users don't notice bold vs normal in a 12 px dropdown.

If user feedback is "it works but I'm not sure which source is active",
they're telling you to add the visual indicator — never ship without it.

---

## Pitfall 28: DataV.GeoAtlas from datacenter IPs returns empty body

`https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json` works
from real user IPs (home, mobile) — returns 200 OK with ~70 KB GeoJSON
per district. From datacenter IPs (GitHub Actions runners, cloud sandboxes,
corporate VPN exit nodes), it returns **200 OK with empty body** or
random 404s. Connection succeeds, Tengine server replies, but the response
content is gone.

**Implication**: when testing in a CI sandbox, do not conclude "DataV is
broken" or "adcode 440309 doesn't exist". Verify with the same call from
your laptop or `curl --resolve` through a home IP. If you're building a
Photon-only path (recommended; see `cn-adcode-keyword-search.md`), DataV
becomes optional and you avoid this trap entirely.

If DataV is mandatory for your use case, host a fallback copy in the
same CDN your app already uses (Cloudflare R2 / S3) and rewrite the URL
when the datacenter probe fails.

## Pitfall 29: JSX `<>{unknown && <X/>}</>` is a type error

When the conditional expression inside a fragment is typed `unknown`
(common when accepting arbitrary JSON like `Region.boundary_geojson`),
TypeScript rejects the render:

```
src/RegionPanel.tsx(178,15): error TS2322:
  Type 'unknown' is not assignable to type 'ReactNode'.
```

**Fix**: wrap the condition with `Boolean(...)`:

```tsx
// wrong
{region.boundary_geojson && !boundaryLoading && <> · 🛰 行政边界已加载</>}
// right
{Boolean(region.boundary_geojson) && !boundaryLoading && <> · 🛰 行政边界已加载</>}
```

`Boolean(unknown)` returns `boolean`, which JSX accepts. Alternative: cast
to `unknown as boolean` is not safe; `Boolean()` is the canonical fix.

## Pitfall 30: Python-patched TS template literals get backslash-mangled

When using Python `execute_code` with `\\` in heredoc strings to write
TypeScript template literals, the output file ends up with literal
backslashes:

```ts
// What you meant:
title={`当前: ${current?.label}`}

// What lands in the file (WRONG):
title={\`当前: \${current?.label}\`}
```

Both `esbuild` and `tsc` then error: `Invalid character`,
`'}' expected`, `'div' has no corresponding closing tag`. The bug is that
`\\` in the Python source becomes `\` in the file, which TypeScript reads
as an escape — not a template literal opening.

**Fix**: in Python heredocs, use single backslash + dollar sign directly,
no double-escape:

```python
content = '''
title={`当前: ${current?.label}`}
'''  # single backslash before ${, single backslash before `}
```

If the file already has the broken form, use `skill_manage action='patch'`
or write the whole file via `write_file` to overwrite — avoid `execute_code`
patch + sed for template literals.

## Pitfall 31: Open-source CN map apps need zero-config defaults

When shipping a fork-able GitHub project with CN users as the primary
audience, the **default backend must work with zero API key**. The user's
fork-and-run experience depends on the first search succeeding without
any signup form.

**Default priority order for CN geocoding**:

1. **Photon (Komoot)** — `https://photon.komoot.io/api/` — no key, free, ★★★★ CN reach, ★★★★ 中文
2. OSM Nominatim (fallback) — slower, weaker CN accuracy
3. 高德 / 腾讯 / 百度 (optional, behind a Settings toggle) — require user to paste a key

If your Settings panel has a "High-德 API key" field, the *default*
backend must still be Photon. The optional 高德 path is a power-user
tweak for users who want exact 国标 adcode resolution, but is never
required for the app to function. Document this clearly in README so
users understand the optional nature.

Same applies to basemap tiles: OpenFreeMap (no key) default; MapTiler (key
required) optional in Settings. Never make the key-bearing backend the
default — users will hit a "search returned nothing" wall before they
ever find the Settings panel.

## Pitfall 32: Photon `lang=zh` returns HTTP 400

Photon's documented `lang` parameter is **restricted to 5 values**:
`{default, de, en, fr}`. Any other value returns HTTP 400 with a JSON
error body:

```
HTTP/1.1 400 Bad Request
{"lang":[{"message":"Language is not supported. Supported are: default, de, en, fr","args":{},"value":"zh"}]}
```

The bug is common because the API surface looks like "set lang to the
user's UI language to bias results". Don't.

**Wrong** (will 400 for any CN/JP/KR user):
```ts
url.searchParams.set('q', query);
url.searchParams.set('lang', 'zh');  // ❌ not in {default, de, en, fr}
```

**Right** (drop the param entirely; the `q` value's locale does the work):
```ts
url.searchParams.set('q', query);    // query itself is in zh/en/whatever
// no lang param → server uses `default`, response text comes back
// matched to query language
```

This pitfall was found the hard way: a user searched 龙华区 in the
working desktop app and got a red error box reading
"Search failed: Photon: Photon HTTP 400; Nominatim: fetch failed".
The Photon HTTP 400 was the primary cause; Nominatim also failed
(Windows fetch prefers IPv6 which Nominatim doesn't have). Fix:
remove `lang=zh` and add `Accept-Language: zh,en` to Nominatim fallback
for a cleaner retry path.


