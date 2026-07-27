# TSConfig templates for Electron 3-target build (vite + esbuild)

How to drive **Vite (renderer)** + **esbuild (main/preload)** builds without
`vite-plugin-electron`. Validated 2026-07-18 in `app-map-downloader/`.

These exist because `vite-plugin-electron` (v0.29.x) silently only builds the renderer —
leaving `dist-electron/` empty. Use plain Vite + esbuild instead for reliability.

---

## tsconfig.main.json (CommonJS, node20, emits to dist-electron/main)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "noEmit": false,
    "outDir": "dist-electron/main",
    "rootDir": "./src/main",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": false,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/main/**/*.ts", "src/shared/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Key points:
- `rootDir` is the entry-point subdir (e.g. `src/main`), not `./src`. If you set
  `./src`, tsc emits everything under `outDir/src/main/...` which **breaks** the
  `package.json` `"main": "dist-electron/main/index.cjs"` path.
- `module: "CommonJS"` — main process is Node.js, not ESM.
- `target: "ES2022"` matches Electron 33's bundled Node.js 20.
- `noEmit: false` is mandatory — without it, tsc won't write JS even though
  you asked for a build.
- Force `"strict": false` here; the renderer tsconfig is the strict one.

## tsconfig.preload.json (same shape, but for src/preload)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "noEmit": false,
    "outDir": "dist-electron/preload",
    "rootDir": "./src/preload",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": false,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/preload/**/*.ts", "src/shared/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Identical config, swap the `rootDir`/`outDir`/`include`.

## Shared/ utility include trick

`src/shared/types.ts` is imported by both `src/main/*` and `src/preload/*`. The
simplest way to keep both builds working is to put it in **both configs' `include` array**.
TSC will emit shared to **both** output dirs, so:

- `dist-electron/main/shared/types.js` ← emitted when building main
- `dist-electron/preload/shared/types.js` ← emitted when building preload

This means the same source file appears in two output dirs at build time, but it
saves you from coordinating a shared-only sub-build.

## Esbuild alternative (cleaner — what we use)

After fighting tsc + tsconfig.rootDir quirks, we switched to **esbuild** for
main + preload, leaving tsc only for typechecking:

```js
// scripts/build-main.cjs (CommonJS due to top-level await restriction)
const { build, context } = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');
const config = {
  entryPoints: [path.resolve(__dirname, '../src/main/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'better-sqlite3'],
  outfile: path.resolve(__dirname, '../dist-electron/main/index.cjs'),
  sourcemap: true,
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const ctx = await context(config);
    await ctx.watch();
    console.log('Watching main process for changes...');
  } else {
    await build(config);
    console.log(`Built: ${config.outfile}`);
  }
}
run().catch((err) => { console.error(err); process.exit(1); });
```

Three reasons esbuild wins over tsc-split for Electron bundles:

1. **No `rootDir` directory-nesting bug.** Esbuild emits the entry output
   exactly where you say (`dist-electron/main/index.cjs`), not nested
   under `src/`.
2. **No per-target tsconfig.json** to maintain — esbuild reads the
   same `tsconfig.json` already in the repo (or picks up defaults).
3. **No copy step for shared/ files.** Esbuild inlines imports into
   the bundle, so `shared/types.ts` ends up inside `dist-electron/main/index.cjs`.

For preload, the script is identical except `entryPoints` and `outfile`. `external`
drops to `['electron']` (preload runs in the renderer process, so `better-sqlite3`
is NOT available there).

## package.json scripts (the full pipeline)

```json
{
  "scripts": {
    "dev:renderer": "vite",
    "dev:main": "node scripts/build-main.cjs --watch",
    "dev:preload": "node scripts/build-preload.cjs --watch",
    "dev": "electron .",
    "build:renderer": "vite build",
    "build:main": "node scripts/build-main.cjs",
    "build:preload": "node scripts/build-preload.cjs",
    "build": "npm run build:renderer && npm run build:main && npm run build:preload",
    "electron:build": "npm run build && electron-builder",
    "typecheck": "tsc --noEmit"
  }
}
```

## Gotchas

- **`node scripts/build-main.cjs` fails with `await is only valid in async functions`** —
  wrap top-level body in `async function run() {...}; run()`. This is the #1 error
  when porting esbuild watch scripts from `vite.config.ts` to standalone `.cjs`.
- **CJS `.cjs` extension is required** for Node.js to interpret `require()` correctly
  when `package.json` doesn't have `"type": "module"`. If package.json has
  `"type": "module"` (which Vite recommends), name the script `.cjs` AND keep
  using CommonJS.
- **esbuild `external: []` is mandatory** — Electron is a runtime-only module;
  if you bundle it, the 200 MB Electron ABI gets crammed into your 30 KB bundle.
  Same for `better-sqlite3` (native `.node`) and any other native binding.
- **`better-sqlite3` native binding takes 5–10 min to compile** during `npm install`
  on Windows. Watch for `Scanning dependencies of <native>` in the npm log; don't
  kill mid-compile or you'll have to delete `node_modules/better-sqlite3/build/`.

## Verification

After `npm run build`, all four artifacts must exist:

```bash
$ ls dist/index.html
-rw-r--r-- 1 47384 197609  504 Jul 19 14:53 dist/index.html

$ ls dist-electron/main/index.cjs
-rw-r--r-- 1 47384 197609 30K Jul 19 14:53 dist-electron/main/index.cjs

$ ls dist-electron/preload/index.cjs
-rw-r--r-- 1 47384 197609 1.9K Jul 19 14:53 dist-electron/preload/index.cjs

$ npm run typecheck   # 0 errors
$ npm run build       # exit 0
$ node -e "require('./dist-electron/main/index.cjs')"   # no module error
```

If `dist-electron/` is empty after `npm run build`, you are hitting the
Pitfall 25 silent vite-plugin-electron skip — switch to the esbuild pipeline
above.
