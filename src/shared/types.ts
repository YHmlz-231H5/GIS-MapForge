/**
 * Shared types between main process, preload, and renderer.
 * Single source of truth — IPC contract + domain models.
 */

import type { PlanetilerConvertForm } from './planetiler-options';

export type { PlanetilerConvertForm, ConvertMode, ArchiveFormat } from './planetiler-options';
export {
  OPENMAPTILES_LAYERS,
  createDefaultPlanetilerForm,
  buildPlanetilerCliFlags,
} from './planetiler-options';

// ─── Region selection ──────────────────────────────────────────────────

/** Lon/Lat bbox — [minLon, minLat, maxLon, maxLat], decimal degrees */
export type BBox = [west: number, south: number, east: number, north: number];

export interface Region {
  /** Display name, e.g. "深圳市龙华区" */
  name: string;
  /** Lon/Lat bbox */
  bbox: BBox;
  /** Area in km², computed from bbox */
  area_km2: number;
  /** Estimated OSM node count for this bbox (rough heuristic) */
  estimated_nodes: number;
  /** How this region was obtained */
  source: 'nominatim' | 'photon' | 'datav' | 'manual' | 'json-import' | 'map-draw' | 'preset';
  /** Original JSON if imported, undefined otherwise */
  imported_geojson?: unknown;
  /** OSM id (R=relation, W=way, N=node) if Photon/Nominatim lookup */
  osm_id?: number;
  osm_type?: string;
  /** adcode if DataV lookup (6-digit national admin code, e.g. 440309 = 龙华区) */
  adcode?: string;
  /** Optional DataV polygon boundary — drawn as overlay when present */
  boundary_geojson?: unknown;
}

// ─── Task queue ────────────────────────────────────────────────────────

export type TaskKind =
  | 'pbf-download-geofabrik'
  | 'pbf-download-osm-api'
  | 'planetiler-convert'
  | 'raster-download-xyz' // Phase 2
  | 'raster-pack-archive';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'killed'
  | 'cancelled';

/** Planteriler or PBF download — heavy tasks hold the mutex */
export type TaskClass = 'light' | 'heavy';

export interface DownloadTileProgress {
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  status: 'pending' | 'done' | 'failed';
}

export interface TaskProgress {
  /** 0..1 */
  ratio: number;
  /** Current phase label, e.g. "osm_pass2" / "3/12 tiles" */
  phase?: string;
  /** Bytes transferred (downloader only) */
  bytes?: number;
  /** Total bytes (downloader only) */
  totalBytes?: number;
  /** Optional ETA seconds */
  eta_seconds?: number;
  /** Last log lines, e.g. for live console stream */
  log_tail?: string[];
  /** Per-tile download grid (OSM API / Overpass path) for map overlay */
  tiles?: DownloadTileProgress[];
}

export interface TaskOptions {
  /** Region this task operates on (optional; task.region is authoritative) */
  region?: Region;
  /** Absolute path to OSM .osm / .osm.pbf input (for planetiler-convert) */
  osm_path?: string;
  /**
   * Full Planetiler convert dialog state (mode + layers + official CLI params).
   * Preferred over the legacy `planetiler` partial below.
   */
  planetiler_form?: PlanetilerConvertForm;
  /** Planetiler specific options (legacy / summary fields) */
  planetiler?: {
    /** zoom 0..max zoom override (default 14) */
    zoom_min?: number;
    zoom_max?: number;
    /** Java heap, e.g. "6g" */
    java_heap?: string;
    /** bbox clip, default = region bbox */
    bbox_clip?: BBox;
    /** Download auxiliaries (natural_earth + lake_centerlines + water_polygons) */
    download_aux?: boolean;
    languages?: string[];
    /** Override output filename inside output dir */
    output_filename?: string;
  };
  /** PBF download source */
  pbf_source?: 'geofabrik' | 'osm-api';
  /**
   * OSM download edge buffer in degrees (each side).
   * `0` = exact region.bbox; omit = handler default (legacy ≈1.5×z14).
   */
  download_expand_deg?: number;
  /** Geofabrik-specific: full URL for the country/state extract */
  geofabrik_url?: string;
  /** Raster XYZ download (image tiles) */
  raster_source?: {
    source_id?: string;
    url_template: string;
    subdomains?: string[];
    attribution?: string;
    /** Optional bounds override — if not set we use region.bbox */
    bbox?: [number, number, number, number];
    min_zoom?: number;
    max_zoom?: number;
    /** Output image format */
    format: 'png' | 'jpeg' | 'webp';
    /**
     * directory = z/x/y tree;
     * mbtiles = SQLite raster archive;
     * pmtiles = directory + pack note (use go-pmtiles convert)
     */
    container: 'directory' | 'mbtiles' | 'pmtiles';
  };
  /** Pack an existing raster tile directory into MBTiles / PMTiles */
  raster_pack?: {
    tile_dir: string;
    archive: 'mbtiles' | 'pmtiles';
    format?: 'png' | 'jpeg' | 'webp';
    attribution?: string;
    source_id?: string;
    min_zoom?: number;
    max_zoom?: number;
    bbox?: [number, number, number, number];
  };
}

export interface Task {
  id: string;
  kind: TaskKind;
  taskClass: TaskClass;
  status: TaskStatus;
  region: Region;
  options: TaskOptions;
  progress: TaskProgress;
  started_at: number | null;
  ended_at: number | null;
  output_path: string | null;
  log_path: string | null;
  error: string | null;
  /** Free-form metadata from worker (e.g. feature counts from audit) */
  metadata: Record<string, unknown> | null;
  /** Created at epoch ms */
  created_at: number;
}

export interface TaskLogLine {
  /** Stream timestamp (epoch ms) */
  ts: number;
  task_id: string;
  /** stdout ('out') or stderr ('err') */
  stream: 'out' | 'err';
  line: string;
}

// ─── IPC contract (Electron contextBridge) ─────────────────────────────

export interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Methods exposed via window.api.* (preload uses contextBridge).
 * Mirrors file: src/preload/index.ts
 */
export interface ExposedApi {
  // Region selection
  searchRegion(query: string): Promise<IpcResult<Region[]>>;
  resolveRegionFromGeoJson(json: unknown): Promise<IpcResult<Region>>;
  /** Fetch DataV.GeoAtlas admin boundary by 6-digit adcode (no key required). */
  fetchRegionBoundary(adcode: string): Promise<IpcResult<unknown>>;
  /** Best-effort adcode lookup from name + bbox (heuristic bridge Photon → DataV). */
  guessRegionAdcode(payload: { name: string; bbox: [number, number, number, number] }): Promise<IpcResult<{ adcode: string | null; boundary?: unknown }>>;
  saveRegionPreset(region: Region): Promise<IpcResult<void>>;
  listRegionPresets(): Promise<IpcResult<Region[]>>;

  // Tasks
  submitTask(input: {
    kind: TaskKind;
    region: Region;
    options?: Omit<TaskOptions, 'region'>;
  }): Promise<IpcResult<Task>>;
  listTasks(filter?: { status?: TaskStatus | 'all' }): Promise<IpcResult<Task[]>>;
  cancelTask(taskId: string): Promise<IpcResult<void>>;
  resumeTask(taskId: string): Promise<IpcResult<Task>>;
  deleteTask(
    taskId: string,
    opts?: { deleteFiles?: boolean }
  ): Promise<IpcResult<{ deletedPaths?: string[]; fileErrors?: string[] }>>;
  clearCompletedTasks(): Promise<IpcResult<void>>;
  clearAllTasks(): Promise<IpcResult<void>>;

  // Live log stream
  subscribeTaskLogs(
    taskId: string,
    cb: (line: TaskLogLine) => void
  ): () => void; // returns unsubscribe fn
  /** Live task row updates (status/progress/output_path). */
  subscribeTaskUpdates(cb: (task: Task) => void): () => void;

  // Config
  getConfig(): Promise<IpcResult<Record<string, unknown>>>;
  setConfig(key: string, value: unknown): Promise<IpcResult<void>>;

  // Planetiler / java / pmtiles
  detectJava(): Promise<IpcResult<{ path: string; version: string } | null>>;
  resolvePlanetilerJar(): Promise<IpcResult<{ path: string; size: number } | null>>;
  openFolder(path: string): Promise<IpcResult<void>>;
  /** Resolved Settings output dir (creates it if missing). */
  resolveOutputDir(): Promise<IpcResult<string>>;
  /** Native folder picker; returns null if user cancels. */
  pickDirectory(): Promise<IpcResult<string | null>>;
  /** Native open-file dialog; returns null if user cancels. */
  pickOpenFile(opts?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
  }): Promise<IpcResult<string | null>>;
  /** List .pmtiles files in a directory (non-recursive). */
  listPmtiles(dir: string): Promise<
    IpcResult<Array<{ name: string; path: string; size: number; mtimeMs: number }>>
  >;
  /** Read a UTF-8 text file (style JSON, etc.). */
  readTextFile(filePath: string): Promise<IpcResult<string>>;
  /** Write multiple UTF-8 files under a directory (creates dirs). */
  writeTextFiles(
    dir: string,
    files: Array<{ relativePath: string; contents: string }>
  ): Promise<IpcResult<{ dir: string; written: string[] }>>;
  /** Read one raster tile file under a z/x/y directory. */
  readRasterTileFile(
    tileDir: string,
    z: number,
    x: number,
    fileName: string
  ): Promise<IpcResult<ArrayBuffer>>;
  /** Read one tile from a raster MBTiles (XYZ → TMS row flip inside). */
  readMbtilesTile(
    mbtilesPath: string,
    z: number,
    x: number,
    y: number
  ): Promise<IpcResult<ArrayBuffer>>;

  // Misc
  version(): Promise<IpcResult<string>>;
}

declare global {
  interface Window {
    api: ExposedApi;
  }
}
