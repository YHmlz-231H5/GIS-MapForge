# Worker Spawn Fix — Electron 33 + Windows (FINAL)

## The 7-iteration saga

### Attempt 1: `fork()`
```ts
const child = fork(workerPath, scriptArgs, { stdio: [...] });
```
**Result**: Exit code 1, zero stderr. `fork()` uses `process.execPath` = `electron.exe`.

### Attempt 2: `spawn(process.execPath, [workerPath, ...args])`
Same result. electron.exe treats the worker as an Electron app, creates BrowserWindow, crashes.

### Attempt 3: `spawn('node', ...)` from PATH
Exit code 1 on some machines. Windows cmd resolution may fail or pick wrong version.

### Attempt 4: `spawn(process.argv0, ...)`
`process.argv0` in Electron main IS still `electron.exe`. Same failure as #1.

### Attempt 5: `.js` → `.mjs` extension fix
ESM syntax kept but Node needs `.mjs` to recognize it. Fix: esbuild `outExtension: { '.js': '.mjs' }`.

### Attempt 6: `process.env.HERMES_NODE_BIN` without setting it
Undefined → falls back to `'node'` → same as #3.

### Attempt 7 ✅: Bridge via env var
**`dev.cjs`** (runs as real node.exe) stores its `process.argv0` in Electron's env:
```js
env: { HERMES_NODE_BIN: process.argv0 }
```
**Handler** reads it back:
```ts
const nodeBin = process.env.HERMES_NODE_BIN || 'node';
const child = spawn(nodeBin, [workerPath, ...scriptArgs], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
});
```

## Required supporting fixes

### ESM extension (esbuild)
```js
format: "esm",
outExtension: { '.js': '.mjs' },
```

### Handler paths
```ts
const workerPath = join(__dirname, '..', 'workers', 'pbf-osm-api.worker.mjs');
```

### Worker dynamic imports
```js
const { mergePbf } = await import('./merge-helper.mjs');
```

### Error logging (critical!)
```ts
child.stderr.on('data', (chunk) => {
  console.error('[handler] stderr:', chunk.toString().trim());
  pushLog('err', text);
});
child.on('error', (e) => {
  console.error('[handler] spawn error:', e.message);
  reject(e);
});
```
Scheduler:
```ts
console.error('[scheduler] task failed:', task.id, task.kind, message);
```
