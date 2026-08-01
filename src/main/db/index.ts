import Database from 'better-sqlite3';
import { app } from 'electron';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Task, TaskStatus } from '../../shared/types';

const DB_FILENAME = 'history.db';

let db: Database.Database | null = null;

function dbPath(): string {
  return join(app.getPath('userData'), DB_FILENAME);
}

function ensureDir(p: string) {
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function openDb(): Database.Database {
  if (db) return db;
  const p = dbPath();
  ensureDir(p);
  db = new Database(p);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id              TEXT PRIMARY KEY,
      kind            TEXT NOT NULL,
      task_class      TEXT NOT NULL,
      status          TEXT NOT NULL,
      region_name     TEXT,
      bbox_west       REAL,
      bbox_south      REAL,
      bbox_east       REAL,
      bbox_north      REAL,
      area_km2        REAL,
      source          TEXT,
      options_json    TEXT,
      progress_json   TEXT,
      started_at      INTEGER,
      ended_at        INTEGER,
      output_path     TEXT,
      log_path        TEXT,
      error           TEXT,
      metadata_json   TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_started  ON tasks(started_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_kind     ON tasks(kind);

    CREATE TABLE IF NOT EXISTS region_presets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT UNIQUE NOT NULL,
      bbox_west       REAL,
      bbox_south      REAL,
      bbox_east       REAL,
      bbox_north      REAL,
      source          TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key             TEXT PRIMARY KEY,
      value_json      TEXT NOT NULL,
      updated_at      INTEGER NOT NULL
    );

  `);
}

// ─── TaskRepository ────────────────────────────────────────────────────

export const Tasks = {
  insert(task: Task) {
    const d = openDb();
    d.prepare(
      `INSERT INTO tasks (
        id, kind, task_class, status,
        region_name, bbox_west, bbox_south, bbox_east, bbox_north, area_km2, source,
        options_json, progress_json,
        started_at, ended_at, output_path, log_path, error, metadata_json,
        created_at
      ) VALUES (
        @id, @kind, @taskClass, @status,
        @regionName, @bboxW, @bboxS, @bboxE, @bboxN, @areaKm2, @source,
        @optionsJson, @progressJson,
        @startedAt, @endedAt, @outputPath, @logPath, @error, @metadataJson,
        @createdAt
      )`
    ).run({
      id: task.id,
      kind: task.kind,
      taskClass: task.taskClass,
      status: task.status,
      regionName: task.region.name,
      bboxW: task.region.bbox[0],
      bboxS: task.region.bbox[1],
      bboxE: task.region.bbox[2],
      bboxN: task.region.bbox[3],
      areaKm2: task.region.area_km2,
      source: task.region.source,
      optionsJson: JSON.stringify(task.options ?? {}),
      progressJson: JSON.stringify(task.progress ?? {}),
      startedAt: task.started_at,
      endedAt: task.ended_at,
      outputPath: task.output_path,
      logPath: task.log_path,
      error: task.error,
      metadataJson: JSON.stringify(task.metadata ?? {}),
      createdAt: task.created_at,
    });
  },

  update(id: string, patch: Partial<Task>) {
    const d = openDb();
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    if (patch.status !== undefined) {
      fields.push('status = @status');
      values.status = patch.status;
    }
    if (patch.started_at !== undefined) {
      fields.push('started_at = @startedAt');
      values.startedAt = patch.started_at;
    }
    if (patch.ended_at !== undefined) {
      fields.push('ended_at = @endedAt');
      values.endedAt = patch.ended_at;
    }
    if (patch.output_path !== undefined) {
      fields.push('output_path = @outputPath');
      values.outputPath = patch.output_path;
    }
    if (patch.log_path !== undefined) {
      fields.push('log_path = @logPath');
      values.logPath = patch.log_path;
    }
    if (patch.error !== undefined) {
      fields.push('error = @error');
      values.error = patch.error;
    }
    if (patch.progress !== undefined) {
      fields.push('progress_json = @progressJson');
      values.progressJson = JSON.stringify(patch.progress);
    }
    if (patch.metadata !== undefined) {
      fields.push('metadata_json = @metadataJson');
      values.metadataJson = JSON.stringify(patch.metadata);
    }

    if (!fields.length) return;
    d.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`).run(values);
  },

  list(filter?: { status?: TaskStatus | 'all' }): Task[] {
    const d = openDb();
    const status = filter?.status ?? 'all';
    const rows = d
      .prepare(
        `SELECT * FROM tasks
         WHERE @status IN ('all', status)
         ORDER BY created_at DESC
         LIMIT 2000`
      )
      .all({ status })
      .map(rowToTask);
    return rows;
  },

  get(id: string): Task | null {
    const d = openDb();
    const row = d.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? rowToTask(row) : null;
  },

  delete(id: string) {
    openDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  },

  clearCompleted() {
    openDb()
      .prepare(`DELETE FROM tasks WHERE status IN ('done','failed','killed','cancelled')`)
      .run();
  },

  clearAll() {
    openDb().prepare('DELETE FROM tasks').run();
  },
};

// ─── ConfigRepo ─────────────────────────────────────────────────────────

export const Config = {
  get(key: string): unknown | null {
    const d = openDb();
    const row = d.prepare('SELECT value_json FROM config WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined;
    return row ? JSON.parse(row.value_json) : null;
  },
  set(key: string, value: unknown) {
    const d = openDb();
    d.prepare(
      `INSERT INTO config (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(value), Date.now());
  },
};

// ─── PresetRepo ────────────────────────────────────────────────────────

export const Presets = {
  save(name: string, bbox: [number, number, number, number], source: string) {
    openDb()
      .prepare(
        `INSERT INTO region_presets (name, bbox_west, bbox_south, bbox_east, bbox_north, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET bbox_west=excluded.bbox_west, bbox_south=excluded.bbox_south, bbox_east=excluded.bbox_east, bbox_north=excluded.bbox_north`
      )
      .run(name, ...bbox, source, Date.now());
  },
  list() {
    return openDb()
      .prepare('SELECT * FROM region_presets ORDER BY created_at DESC')
      .all();
  },
  delete(name: string) {
    openDb().prepare('DELETE FROM region_presets WHERE name = ?').run(name);
  },
};

// ─── rowToTask mapping ─────────────────────────────────────────────────

function rowToTask(row: any): Task {
  return {
    id: row.id,
    kind: row.kind,
    taskClass: row.task_class,
    status: row.status,
    region: {
      name: row.region_name ?? '',
      bbox: [row.bbox_west, row.bbox_south, row.bbox_east, row.bbox_north],
      area_km2: row.area_km2 ?? 0,
      estimated_nodes: 0,
      source: row.source ?? 'preset',
    },
    options: JSON.parse(row.options_json ?? '{}'),
    progress: JSON.parse(row.progress_json ?? '{}'),
    started_at: row.started_at,
    ended_at: row.ended_at,
    output_path: row.output_path,
    log_path: row.log_path,
    error: row.error,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    created_at: row.created_at,
  };
}
