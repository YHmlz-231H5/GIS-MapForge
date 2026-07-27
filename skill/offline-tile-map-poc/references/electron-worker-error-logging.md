# Electron Worker Error Logging Recipe

HOW worker failures become visible in the terminal (essential for debugging).

## Problem

When a handler spawns a worker and the worker crashes (exit code 1, SyntaxError, etc.),
the handler's `child.on('close', ...)` calls `reject(new Error(...))`, which the scheduler catches
and records as task-failed. But the **actual error output** (stderr) is only visible in the
renderer's TaskQueue log, not in the terminal where `npm run dev` is running.

## Pattern: Add 3 log points in every handler

For both `pbf-osm-api.ts` and `raster-xyz.ts`:

### 1. stderr → terminal

```typescript
child.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString().trim();
  console.error('[handler-name] stderr:', text);  // ← ADD THIS
  pushLog('err', text);
});
```

### 2. spawn error → terminal

```typescript
child.on('error', (e) => {
  console.error('[handler-name] spawn error:', e.message);  // ← WRAP reject
  reject(e);
});
```

### 3. close → terminal (exit code)

```typescript
child.on('close', async (code) => {
  if (killed) return reject(new Error('Task cancelled'));
  if (code !== 0) {
    const msg = `Worker exited with code ${code}`;
    console.error('[handler-name]', msg);  // ← ADD THIS
    return reject(new Error(msg));
  }
  // ... success path
});
```

## Also: scheduler catch

In `scheduler.ts`, the catch block that records task-failure should log:

```typescript
} catch (e) {
  const message = (e as Error).message;
  console.error('[scheduler] task failed:', task.id, task.kind, message);  // ← ADD THIS
  Tasks.update(task.id, { ... });
}
```

## Before vs After

### Before (silent):
```
[scheduler] task failed: abc123 pbf-download-osm-api Worker exited with code 1
```
User has no idea WHY.

### After (debuggable):
```
[pbf-osm-api] stderr: SyntaxError: Cannot use import statement outside a module
[pbf-osm-api] stderr:     at Object.compileFunction (node:vm:360:18)
[pbf-osm-api] Worker exited with code 1
[scheduler] task failed: abc123 pbf-download-osm-api Worker exited with code 1
```
User immediately sees it's an ESM/CJS mismatch → can fix the `.mjs` extension.
