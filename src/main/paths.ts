import { join } from 'path';
import { app } from 'electron';
import { Config } from './db';

/**
 * Resolve the user-facing output directory (Settings → 输出目录).
 * Used for both OSM downloads and Planetiler PMTiles — one setting, one place.
 *
 * Priority:
 *   1. MAP_OUTPUT_DIR / MAP_DOWNLOADS_DIR env
 *   2. Config `output_dir` (Settings)
 *   3. Config `downloads_dir` (legacy key)
 *   4. userData/output/
 */
export function resolveOutputDir(): string {
  const fromEnv =
    (process.env.MAP_OUTPUT_DIR as string | undefined)?.trim() ||
    (process.env.MAP_DOWNLOADS_DIR as string | undefined)?.trim();
  if (fromEnv) return fromEnv;

  const fromConfig =
    String(Config.get('output_dir') ?? '').trim() ||
    String(Config.get('downloads_dir') ?? '').trim();
  if (fromConfig) return fromConfig;

  return join(app.getPath('userData'), 'output');
}

/** Alias — downloads (OSM / raster) share the same folder as PMTiles. */
export function resolveDownloadsDir(): string {
  return resolveOutputDir();
}

/**
 * Intermediate Overpass tile cache — under the same output root so users
 * never need to dig into AppData for download artifacts.
 * Final .osm still lands directly in resolveOutputDir().
 */
export function resolveTileCacheDir(cacheKey: string): string {
  return join(resolveOutputDir(), '.tile-cache', cacheKey);
}

/**
 * Cross-task geographic cell cache (exact bbox keys).
 * Survives per-task tile_dir deletion so adjacent regions can reuse cells.
 */
export function resolveSharedGeoCellCacheDir(): string {
  return join(resolveOutputDir(), '.tile-cache', 'geo-cells');
}
