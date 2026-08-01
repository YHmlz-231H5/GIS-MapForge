/**
 * Task scheduler — single-instance per process.
 *
 * Concurrency rules:
 *   - LIGHT tasks can run up to `maxConcurrentLight` in parallel.
 *   - HEAVY tasks run strictly one at a time (Planetiler mutex).
 *
 * The scheduler polls the SQLite task list on each "tick" interval and
 * promotes queued tasks to "running" as slots open up.
 */

import { app, type BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { Tasks, Config } from '../db';
import type { Task, TaskKind, TaskOptions, TaskLogLine } from '../../shared/types';
import { execPbfDownloadOsmApi } from './handlers/pbf-osm-api';
import { execPbfDownloadGeofabrik } from './handlers/pbf-geofabrik';
import { execPlanetilerConvert } from './handlers/planetiler-convert';
import { execRasterDownloadXyz } from './handlers/raster-xyz';
import { execRasterPackArchive } from './handlers/raster-pack';

const TICK_INTERVAL_MS = 1000;
const MAX_LIGHT = 2;

interface RunningTask {
  task: Task;
  abort: AbortController;
}

class Scheduler {
  private window: (() => BrowserWindow | null) | null = null;
  private tickHandle: NodeJS.Timeout | null = null;
  private running: Map<string, RunningTask> = new Map();

  init(getWindow: () => BrowserWindow | null) {
    this.window = getWindow;
    // App restart kills in-memory workers; DB rows left as "running" are zombies.
    this.recoverOrphanedRunningTasks();
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  /** Mark DB "running" tasks as interrupted when no worker is attached (after restart), then auto-requeue downloads. */
  private recoverOrphanedRunningTasks() {
    const orphans = Tasks.list({ status: 'running' }).filter((t) => !this.running.has(t.id));
    for (const t of orphans) {
      const canAutoResume =
        t.kind === 'pbf-download-osm-api' || t.kind === 'pbf-download-geofabrik';
      console.warn(
        '[scheduler] orphaned running task →',
        canAutoResume ? 'queued (auto-resume)' : 'killed',
        t.id,
        t.kind
      );
      if (canAutoResume) {
        // Keep progress + metadata (tile_dir); tick will pick it up and skip cached tiles.
        Tasks.update(t.id, {
          status: 'queued',
          ended_at: null,
          started_at: null,
          error: '软件重启后自动续传',
        });
      } else {
        Tasks.update(t.id, {
          status: 'killed',
          ended_at: Date.now(),
          error: '软件重启导致任务中断，可点「继续」恢复',
        });
      }
      const fresh = Tasks.get(t.id);
      if (fresh) this.broadcastTaskUpdate(fresh);
    }
  }

  enqueue(input: { kind: TaskKind; region: Task['region']; options?: TaskOptions }): Task {
    console.log('[scheduler] enqueue called:', input.kind, input.region.name, input.region.bbox);
    const id = randomUUID();
    const taskClass = input.kind === 'planetiler-convert' ? 'heavy' : 'light';
    const task: Task = {
      id,
      kind: input.kind,
      taskClass,
      status: 'queued',
      region: input.region,
      options: input.options ?? {},
      progress: { ratio: 0 },
      started_at: null,
      ended_at: null,
      output_path: null,
      log_path: null,
      error: null,
      metadata: null,
      created_at: Date.now(),
    } as Task;
    try {
      Tasks.insert(task);
      console.log('[scheduler] task inserted into DB:', id);
    } catch (e) {
      console.error('[scheduler] DB insert failed:', e);
      throw e;
    }
    try {
      this.broadcastTaskUpdate(task);
    } catch (e) {
      console.error('[scheduler] broadcast failed:', e);
    }
    return task;
  }

  cancel(taskId: string) {
    const r = this.running.get(taskId);
    if (r) {
      r.abort.abort();
    } else {
      const t = Tasks.get(taskId);
      if (t && t.status === 'queued') {
        Tasks.update(taskId, { status: 'cancelled', ended_at: Date.now(), error: 'Cancelled before execute' });
      }
    }
  }

  /** Re-queue a stopped/failed task (keeps progress + metadata for resume). */
  resume(taskId: string): Task {
    const t = Tasks.get(taskId);
    if (!t) throw new Error('Task not found');
    if (!['killed', 'failed', 'cancelled'].includes(t.status)) {
      throw new Error(`Task cannot be resumed (status: ${t.status})`);
    }
    Tasks.update(taskId, {
      status: 'queued',
      error: null,
      ended_at: null,
      started_at: null,
    });
    const fresh = Tasks.get(taskId)!;
    this.broadcastTaskUpdate(fresh);
    return fresh;
  }

  /** Return all currently running task entries for external iteration (clearAll). */
  getAllRunning(): Map<string, RunningTask> {
    return this.running;
  }

  /**
   * Graceful shutdown for normal app quit:
   * stop ticker → mark running as killed in DB (progress preserved) → abort workers → wait briefly.
   */
  async shutdown(timeoutMs = 4000): Promise<void> {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }

    const runningIds = [...this.running.keys()];
    console.log('[scheduler] shutdown: stopping', runningIds.length, 'running task(s)');

    for (const id of runningIds) {
      const t = Tasks.get(id);
      if (t && t.status === 'running') {
        Tasks.update(id, {
          status: 'killed',
          ended_at: Date.now(),
          error: '软件关闭导致下载中断，可点「继续」恢复',
        });
        const fresh = Tasks.get(id);
        if (fresh) this.broadcastTaskUpdate(fresh);
      }
      try {
        this.running.get(id)?.abort.abort();
      } catch {
        /* ignore */
      }
    }

    const start = Date.now();
    while (this.running.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.running.size > 0) {
      console.warn('[scheduler] shutdown: force-clear', this.running.size, 'lingering worker(s)');
      this.running.clear();
    }
  }

  /** Periodic tick: promote eligible tasks to running. */
  private async tick() {
    const running = [...this.running.values()];
    const runningLightCount = running.filter((r) => r.task.taskClass === 'light').length;
    const runningHeavy = running.find((r) => r.task.taskClass === 'heavy');

    // Drain finished
    for (const r of running) {
      const t = Tasks.get(r.task.id);
      if (t && t.status !== 'running') {
        this.running.delete(r.task.id);
        this.broadcastTaskUpdate(t);
      }
    }

    // Always have at most one heavy running
    if (!runningHeavy) {
      const queued = Tasks.list({ status: 'queued' });
      const heavy = queued.find((t) => t.taskClass === 'heavy');
      if (heavy) {
        console.log('[scheduler] dispatching heavy:', heavy.id, heavy.kind);
        this.start(heavy);
        return;
      }
      // Also try light tasks if no heavy to dispatch
      if (runningLightCount < MAX_LIGHT) {
        const light = queued.find((t) => t.taskClass === 'light');
        if (light) {
          console.log('[scheduler] dispatching light:', light.id, light.kind);
          this.start(light);
        }
      }
      return;
    }

    // Up to MAX_LIGHT lights
    if (runningLightCount < MAX_LIGHT) {
      const light = Tasks.list({ status: 'queued' })
        .find((t) => t.taskClass === 'light');
      if (light) {
        console.log('[scheduler] dispatching light:', light.id, light.kind);
        this.start(light);
      }
    }
  }

  private async start(task: Task) {
    console.log('[scheduler] start task:', task.id, task.kind);
    Tasks.update(task.id, { status: 'running', started_at: Date.now() });
    const abort = new AbortController();
    this.running.set(task.id, { task, abort });

    // Persisted log path (aligned with app userData/logs; live lines still via pushLog)
    const logPath = join(app.getPath('userData'), 'logs', `${task.id}.log`);
    Tasks.update(task.id, { log_path: logPath });

    // stdout/stderr from worker → main → renderer via 'task:log'
    const pushLog = (stream: 'out' | 'err', line: string) => {
      const payload: TaskLogLine = { ts: Date.now(), task_id: task.id, stream, line };
      this.broadcastLog(payload);
    };
    const pushProgress = (progress: Task['progress']) => {
      Tasks.update(task.id, { progress });
      const fresh = Tasks.get(task.id);
      if (fresh) this.broadcastTaskUpdate(fresh);
    };

    let result: { output_path?: string; metadata?: Record<string, unknown> };
    try {
      switch (task.kind) {
        case 'pbf-download-osm-api':
          result = await execPbfDownloadOsmApi(task, abort.signal, pushLog, pushProgress);
          break;
        case 'pbf-download-geofabrik':
          result = await execPbfDownloadGeofabrik(task, abort.signal, pushLog, pushProgress);
          break;
        case 'planetiler-convert':
          result = await execPlanetilerConvert(task, abort.signal, pushLog, pushProgress);
          break;
        case 'raster-download-xyz':
          result = await execRasterDownloadXyz(task, abort.signal, pushLog, pushProgress);
          break;
        case 'raster-pack-archive':
          result = await execRasterPackArchive(task, abort.signal, pushLog, pushProgress);
          break;
        default:
          throw new Error(`Unknown task kind: ${task.kind}`);
      }
      const prev = Tasks.get(task.id);
      Tasks.update(task.id, {
        status: 'done',
        ended_at: Date.now(),
        output_path: result?.output_path ?? task.output_path,
        progress: {
          ...(prev?.progress ?? {}),
          ratio: 1,
          phase: prev?.progress?.phase ?? 'done',
        },
        metadata: { ...(prev?.metadata ?? {}), ...(result?.metadata ?? {}) },
      });
    } catch (e) {
      const message = (e as Error).message;
      console.error('[scheduler] task failed:', task.id, task.kind, message);
      // If shutdown/cancel already wrote terminal status, don't clobber its message.
      const prev = Tasks.get(task.id);
      if (prev && (prev.status === 'killed' || prev.status === 'cancelled')) {
        // keep existing error text
      } else {
        Tasks.update(task.id, {
          status: abort.signal.aborted ? 'killed' : 'failed',
          ended_at: Date.now(),
          error: message,
        });
      }
    } finally {
      this.running.delete(task.id);
      const fresh = Tasks.get(task.id);
      if (fresh) this.broadcastTaskUpdate(fresh);
    }
  }

  private broadcastTaskUpdate(task: Task) {
    const w = this.window?.();
    if (w && !w.isDestroyed()) {
      w.webContents.send('task:update', task);
    }
  }

  private broadcastLog(line: TaskLogLine) {
    const w = this.window?.();
    if (w && !w.isDestroyed()) {
      w.webContents.send('task:log', line);
    }
  }
}

export const taskScheduler = new Scheduler();
