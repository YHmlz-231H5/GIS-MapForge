# Electron worker: fork() vs spawn(process.execPath)

**Problem**: `child_process.spawn(process.execPath, [workerPath, ...args])` fails silently in Electron main process because `process.execPath` = `electron.exe`, which expects to create a BrowserWindow. Passing a `.js` worker script makes Electron try to boot another Electron app → crash.

**Fix**: Use `child_process.fork()` — it uses the Node.js binary bundled with Electron:

```ts
// ❌ Wrong
import { spawn } from 'child_process';
const child = spawn(process.execPath, [workerPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

// ✅ Right
import { fork } from 'child_process';
const child = fork(workerPath, scriptArgs, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
```

**Key differences after switching**:
1. `fork()` first arg = script path, second arg = args array (NO script path in args)
2. `child.stdout`/`child.stderr` become `Readable | null` → add `?.` before `.on('data', ...)`
3. `stdio` must include `'ipc'` as 4th element

**Files affected**:
- `src/main/tasks/handlers/pbf-osm-api.ts`: spawn → fork
- `src/main/tasks/handlers/raster-xyz.ts`: spawn → fork  
- `src/shared/types.ts`: add `'cancelled'` to TaskStatus

**Also required**: `'cancelled'` status for clear-all flow:
```ts
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'killed' | 'cancelled';
```
