/**
 * Collect & delete disk artifacts owned by a task (output, tile cache, logs).
 * Best-effort: missing paths are skipped; errors are collected, not thrown.
 */
import { existsSync, lstatSync, rmSync } from 'fs';
import type { Task } from '../../shared/types';

export function collectTaskDiskPaths(task: Task): string[] {
  const paths = new Set<string>();
  const add = (p: unknown) => {
    if (typeof p === 'string' && p.trim()) paths.add(p.trim());
  };

  add(task.output_path);
  add(task.log_path);
  add(task.metadata?.tile_dir);
  // Do NOT delete shared_geo_cache / .tile-cache/geo-cells — cross-task reuse.
  add(task.metadata?.output_dir); // only if it's a dedicated task folder — see filter below

  // Raster / convert may stash more under metadata
  add(task.metadata?.out_file);
  add(task.metadata?.pmtiles_path);

  // Do NOT delete options.osm_path — that usually belongs to a parent download task.

  // output_dir is often the shared downloads root; only delete it if it looks
  // like a per-task directory (contains task id slug / is under tile-cache).
  const outDir = typeof task.metadata?.output_dir === 'string' ? task.metadata.output_dir : null;
  if (outDir) {
    const lower = outDir.replace(/\\/g, '/').toLowerCase();
    const isSharedRoot =
      lower.endsWith('/downloads') ||
      lower.endsWith('/output') ||
      /\/map-downloader\/?$/.test(lower);
    if (isSharedRoot) paths.delete(outDir);
  }

  return [...paths];
}

export function deleteTaskDiskFiles(task: Task): { deleted: string[]; errors: string[] } {
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const p of collectTaskDiskPaths(task)) {
    try {
      if (!existsSync(p)) continue;
      const st = lstatSync(p);
      rmSync(p, { recursive: st.isDirectory(), force: true });
      deleted.push(p);
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
  }

  return { deleted, errors };
}
