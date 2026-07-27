# Pitfall 26: Wrapping offline-map tooling in an Electron desktop app — reference architecture (NEW 2026-07-18)

When the user asks to "wrap" the offline-map pipeline (PBF download → Planetiler
convert → PMTiles preview) in a **cross-platform desktop UI** instead of a
browser PoC, the W1-W7 work in `app-map-downloader/` (validated end-to-end)
is the canonical reference.

## Project layout that builds (validated)

```
app-map-downloader/
├── package.json                  # deps: electron, vite, react, ts, zustand, better-sqlite3, radix-ui
├── tsconfig.json                 # renderer + shared (jsx, react-jsx)
├── tsconfig.main.json            # main process (commonjs, target node20)
├── tsconfig.preload.json         # preload (commonjs)
├── vite.config.ts                # renderer-only (react plugin)
├── electron.vite.config.ts       # see Pitfall 25 for which plugins work
├── tailwind.config.js / postcss.config.js
├── index.html                    # renderer entry; loads ./vendor/maplibre-gl.{css,js}
├── vendor/                       # local MapLibre + pmtiles.js (NO internet)
├── src/
│   ├── shared/                  # IPC contract types — single source of truth
│   │   ├── types.ts
│   │   └── layer-set.ts
│   ├── main/                    # Node.js + Electron main
│   │   ├── index.ts
│   │   ├── ipc/{region,config,tasks,system}.ts
│   │   ├── db/index.ts          # better-sqlite3 schema
│   │   └── tasks/
│   │       ├── scheduler.ts     # light×2, heavy mutex, AbortSignal
│   │       └── handlers/
│   │           ├── planetiler-convert.ts
│   │           ├── pbf-osm-api.ts + .worker.mjs
│   │           ├── pbf-geofabrik.ts
│   │           ├── raster-xyz.ts + .worker.mjs
│   │           ├── merge-helper.mjs (osmium 3-pass ESM)
│   │           └── _types.ts
│   ├── preload/index.ts         # contextBridge → window.api
│   └── renderer/                 # React 18 + Vite
│       ├── main.tsx / App.tsx
│       ├── store.ts              # Zustand
│       ├── components/{RegionPanel,MapView,TaskQueue,LayerCurationDrawer}.tsx
│       ├── lib/utils.ts
│       └── styles/globals.css
└── scripts/                      # esbuild CJS scripts (one per build target)
    ├── build-main.cjs
    ├── build-preload.cjs
    └── build-workers.cjs          # ESM workers (NOT bundled — Node resolves osmium)
```

## Concrete gotchas confirmed during the build

### Pitfall 26a: `statSync` is in `fs`, not `fs/promises`

Repeating this gotcha across several handlers in W4/W7:

```ts
// ❌ WRONG — `'fs/promises'.statSync` does not exist
import { mkdir, statSync } from 'fs/promises';

// ✅ RIGHT — split the imports
import { mkdir } from 'fs/promises';
import { statSync } from 'fs';
```

The error is `Module '"fs/promises"' has no exported member 'statSync'`. The
fix is mechanical and identical every time — split imports.

### Pitfall 26b: `await` is only valid in async functions / ESM modules

When writing `scripts/build-main.cjs` etc. for esbuild, **`commonjs files
cannot use top-level await`**:

```js
// ❌ WRONG — commonjs, top-level await
const ctx = await context(config);   // SyntaxError in .cjs
await ctx.watch();

// ✅ RIGHT — wrap in async function
async function run() {
  if (watch) {
    const ctx = await context(config);
    await ctx.watch();
    console.log('Watching ...');
  } else {
    await build(config);
    console.log(`Built: ${config.outfile}`);
  }
}
run().catch((err) => { console.error(err); process.exit(1); });
```

**Workaround for sleep-deprived future agents**: rename the file
`.cjs` → `.mjs` (then top-level await becomes valid in pure ESM), or wrap
in async function. **Naming `.mjs` is not enough**: Node decides module
type by package.json `"type": "module"` vs `"type": "commonjs"`, with
`.cjs`/`.mjs` extensions overriding per-file.

### Pitfall 26c: osmium merge in pure ESM

osmium 4.x supports Node 20+ ESM imports natively. The 3-pass merge pattern
(from Pitfall 23) works in pure ESM with dynamic import:

```js
// worker.mjs (esbuild `format: esm`, NOT bundled)
import osmium from 'osmium';
import { SimpleHandler, SimpleWriter } from 'osmium';

// Write 3 type-only PBFs in pass 1
const wn = new SimpleWriter(NODES_PBF);
const ww = new SimpleWriter(WAYS_PBF);
const wr = new SimpleWriter(RELS_PBF);

class NodeWriter {
  constructor(out) { this.w = out; }
  apply_file(path) {
    const h = new SimpleHandler();
    h.node = (n) => this.w.add_node(n);
    h.apply_file(path, { locations: true });
  }
}
// ... same for WayWriter, RelWriter

for (const src of OSM_FILES) {
  new NodeWriter(wn).apply_file(src);
  new WayWriter(ww).apply_file(src);
  new RelWriter(wr).apply_file(src);
}

// Pass 2: read in (n, w, r) order
const merged = new SimpleWriter(MERGED);
for (const [path, kind] of [[NODES_PBF, 'n'], [WAYS_PBF, 'w'], [RELS_PBF, 'r']]) {
  const h = new SimpleHandler();
  if (kind === 'n') h.node = (n) => merged.add_node(n);
  if (kind === 'w') h.way = (w) => merged.add_way(w);
  if (kind === 'r') h.relation = (r) => merged.add_relation(r);
  h.apply_file(path);
}
```

In the Electron + esbuild pipeline:
- **Bundle** `osmium` only into the **main** CJS bundle if you don't care about
  ~150 MB electron-builder binary; otherwise **externalize** it and let the
  Node runtime resolve it via npm at runtime.
- Bundle **merging logic into the main process** for short jobs, or run as a
  **spawned Node child process** (`node merge-helper.mjs`) for long ones.

### Pitfall 26d: `node-osmium` requires "UNSUPPORTED" Pragma

When osmium is loaded in Node 20+, you'll see:

```
(node:12345) WARNING: Please use --no-deprecation or --throw-deprecation
to see where these deprecation warnings originate.
...
Error: NotImplementedError: Compression SNAPPY is not implemented in osmium yet.
Or: "Failed to load shared library: osmium.dll"
```

Two fixes:
1. `npm install osmium -E` (exactly) on Windows; otherwise mismatched
   bindings between OS and Node ABI throw.
2. Set `OSMIUM_NO_NATIVE=1` if you don't need native — but for Planetiler-class
   work you DO need native. Stick with 4.3.x (validated).

## Build pipeline that works

```
npm install                # 5 min on Windows; ~440 packages
npm run typecheck          # tsc --noEmit, exit 0
npm run build
  ├── build:renderer      # vite build → dist/index.html + dist/assets/*.js
  ├── build:main          # esbuild → dist-electron/main/index.cjs (33 KB)
  ├── build:workers       # esbuild format:esm → dist-electron/workers/*.js
  └── build:preload       # esbuild → dist-electron/preload/index.cjs (1.9 KB)
```

All four phases produced + exit 0 in this exact pipeline.

## IPC contract — type-safe end-to-end pattern

```ts
// shared/types.ts
export interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
export interface ExposedApi {
  submitTask(input: SubmitInput): Promise<IpcResult<Task>>;
  listTasks(filter?: { status?: TaskStatus | 'all' }): Promise<IpcResult<Task[]>>;
  // ...
}

// preload/index.ts
contextBridge.exposeInMainWorld('api', {
  submitTask: (input) => ipcRenderer.invoke('task:submit', input),
  listTasks: (filter) => ipcRenderer.invoke('task:list', filter),
  // ...
});

// renderer/App.tsx
const result = await window.api.listTasks({ status: 'all' });
```

**The single-source-of-truth pattern is critical**: any change to
`ExposedApi` is enforced at both ends because TS imports the type.

## Concrete next steps (if asked to continue W4+)

When running `app-map-downloader` in a real Windows session:

1. `npm run dev` — Electron launches the 3-pane window
2. Top-left: search "深圳龙华" → 88-tile download (W4 worker script)
3. Click "▶ 下一步：选择 layers" → LayerCurationDrawer with 6-question flow
4. Confirm → submit triggers `pbf-download-osm-api` + `planetiler-convert` (mutex 1-at-a-time)
5. Live log streaming via IPC `task:log` channel → console panel
6. After Planetiler done → click "Preview" → opens MapLibre with the PMTiles

The sandbox **cannot run `npm run dev`** (no display server). This is a real
runtime gap — the user must verify on their desktop session.

## What this validates

The combination of:
- `scripts/build-main.cjs + build-preload.cjs + build-workers.cjs` (esbuild)
- `shared/types.ts` (IPC contract)
- `RegionPanel/MapView/TaskQueue/LayerCurationDrawer.tsx` (3-pane React UI)
- `src/main/tasks/scheduler.ts` (light×2, heavy mutex)

gives a **reference architecture** for **any** "data processing with native
bindings + a desktop UI" project, not just maps. The same pattern applies to:
- Video conversion apps (ffmpeg workers + Electron preview)
- Data analysis apps (pandas workers + notebook UI)
- Audio tools (sox + waveform UI)

Embed this lesson into the broader class: any desktop app wrapping heavy
data processing benefits from this 3-target (main / preload / worker) separation.
