# Electron Task Scheduler Debug Recipe

## Symptoms

Tasks appear in TaskQueue as `queued` but never advance to `running`. Console shows:
```
[scheduler] enqueue called: pbf-download-osm-api ...
[scheduler] task inserted into DB: <uuid>
[scheduler] enqueue called: planetiler-convert ...
[scheduler] task inserted into DB: <uuid>
```
But NO `[scheduler] dispatching` or `[scheduler] start task` log appears.

## Root Causes (3 common)

### 1. Scheduler tick skips light tasks (FIXED)

The original `tick()` called `Tasks.list({ status: 'queued' })` inside the `if (!runningHeavy)` branch and returned immediately after starting a heavy task. If no heavy was queued, it returned without checking light tasks.

**Fix** (already applied in scheduler.ts):
```ts
// Call Tasks.list() ONCE, use for both heavy + light
const queued = Tasks.list({ status: 'queued' });
const heavy = queued.find((t) => t.taskClass === 'heavy');
if (heavy) { this.start(heavy); return; }
const light = queued.find((t) => t.taskClass === 'light');
if (light) this.start(light);
```

### 2. Worker spawn fails silently

`spawn(process.execPath, [workerPath, ...])` uses `electron.exe` — crashes the worker silently. Use `fork(workerPath, args)` instead. See Pitfall 62.

### 3. DB path / permission issue

`Tasks.insert()` throws if `app.getPath('userData')` is unavailable (called before `app.whenReady()`). The `registerTaskHandlers` call must be inside `app.whenReady().then(...)`.

## Diagnostic logs to add

Add these `console.log` calls to `scheduler.ts`:

```ts
// In enqueue()
console.log('[scheduler] enqueue called:', input.kind, input.region.name);

// In tick()
console.log('[scheduler] tick: heavy=', !!runningHeavy, 'lightCount=', runningLightCount);

// In start()
console.log('[scheduler] start task:', task.id, task.kind);

// In dispatch switch
console.log('[scheduler] dispatching handler for:', task.kind);
```

This gives a full breadcrumb trail: `enqueue → tick → start → dispatch → handler output`.

## Verification

In the full-flow Playwright spec, grep the captured logs for `scheduler`:
```
[scheduler] enqueue called: pbf-download-osm-api ...
[scheduler] task inserted into DB: ...
[scheduler] dispatching light: ...
[scheduler] start task: ...
```

If `dispatching` appears but `start task` doesn't → bug in `start()` method.
If neither appears → tick loop not finding queued tasks → DB query issue.
