# Electron Worker Paths (esbuild .mjs → .js pitfall)

Handlers reference worker files via `join(__dirname, ...)`. After esbuild bundles:

- `__dirname` = `dist-electron/main/` (not `src/main/tasks/handlers/`)
- Workers are built to `dist-electron/workers/` with `.js` extension (not `.mjs`)

## Two fixes

1. Path: `join(__dirname, '..', 'workers', ...)` — up one level
2. Extension: `.js` not `.mjs` — esbuild emits `.js`

Also fix dynamic imports inside workers: `import('./merge-helper.js')`.

## Symptom

`Error launching app: Unable to find Electron app at D:\...\dist-electron\main\pbf-osm-api.worker.mjs`
