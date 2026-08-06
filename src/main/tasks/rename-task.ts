/**
 * Rename a completed download task's display name and on-disk artifacts.
 * Updates path fields so later convert/pack still resolve correctly.
 */
import { existsSync, renameSync } from 'fs';
import { basename, dirname, join, resolve, normalize } from 'path';
import type { Task } from '../../shared/types';
import { slugifyRegionName } from '../../shared/slugify';
import { Tasks } from '../db';

const RENAMEABLE_KINDS = new Set([
  'pbf-download-osm-api',
  'pbf-download-geofabrik',
  'raster-download-xyz',
]);

function splitKnownExt(name: string): { stem: string; ext: string } {
  const lower = name.toLowerCase();
  for (const e of ['.osm.pbf', '.pmtiles', '.mbtiles', '.osm']) {
    if (lower.endsWith(e)) {
      return { stem: name.slice(0, -e.length), ext: name.slice(name.length - e.length) };
    }
  }
  return { stem: name, ext: '' };
}

function uniquePath(candidate: string): string {
  if (!existsSync(candidate)) return candidate;
  const dir = dirname(candidate);
  const base = basename(candidate);
  const { stem, ext } = splitKnownExt(base);
  for (let i = 2; i < 1000; i++) {
    const next = join(dir, `${stem}-${i}${ext}`);
    if (!existsSync(next)) return next;
  }
  return join(dir, `${stem}-${Date.now()}${ext}`);
}

/** Replace oldSlug in basename; fall back to rebuilding stem with newSlug. */
export function proposeRenamedPath(
  oldPath: string,
  oldSlug: string,
  newSlug: string,
  taskId: string
): string {
  const abs = resolve(normalize(oldPath));
  const dir = dirname(abs);
  const base = basename(abs);
  const { stem, ext } = splitKnownExt(base);
  let nextStem: string;
  if (oldSlug && stem.includes(oldSlug)) {
    nextStem = stem.split(oldSlug).join(newSlug);
  } else {
    const id8 = taskId.slice(0, 8);
    const idSuffix = stem.endsWith(`-${id8}`) ? `-${id8}` : '';
    // Keep trailing -sourceId for raster dirs like `slug-carto-light`
    const afterOld = oldSlug && stem.startsWith(`${oldSlug}-`) ? stem.slice(oldSlug.length) : idSuffix;
    nextStem = `${newSlug}${afterOld || idSuffix}`;
  }
  if (!nextStem) nextStem = newSlug;
  return uniquePath(join(dir, `${nextStem}${ext}`));
}

function renamePath(oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  if (!existsSync(oldPath)) {
    throw new Error(`文件不存在: ${oldPath}`);
  }
  if (existsSync(newPath)) {
    throw new Error(`目标已存在: ${newPath}`);
  }
  renameSync(oldPath, newPath);
}

function rewritePathValue(value: unknown, mapping: Map<string, string>): unknown {
  if (typeof value !== 'string' || !value) return value;
  const abs = resolve(normalize(value));
  for (const [from, to] of mapping) {
    if (abs === from || abs.toLowerCase() === from.toLowerCase()) return to;
    if (abs.startsWith(from + '\\') || abs.startsWith(from + '/')) {
      return to + abs.slice(from.length);
    }
  }
  return value;
}

export type RenameTaskResult = {
  task: Task;
  renamed: Array<{ from: string; to: string }>;
  updatedDependentIds: string[];
};

export function renameCompletedDownloadTask(
  taskId: string,
  newNameRaw: string
): RenameTaskResult {
  const task = Tasks.get(taskId);
  if (!task) throw new Error('任务不存在');
  if (task.status !== 'done') throw new Error('仅已完成的下载任务可改名');
  if (!RENAMEABLE_KINDS.has(task.kind)) {
    throw new Error('该任务类型不支持改名（仅下载任务）');
  }

  const newName = newNameRaw.trim();
  if (!newName) throw new Error('名称不能为空');
  if (newName === task.region.name) {
    return { task, renamed: [], updatedDependentIds: [] };
  }

  const oldSlug = slugifyRegionName(task.region.name, {
    bbox: task.region.bbox,
    fallbackId: task.id,
  });
  const newSlug = slugifyRegionName(newName, {
    bbox: task.region.bbox,
    fallbackId: task.id,
  });
  if (!newSlug) throw new Error('名称无效');

  const candidates: string[] = [];
  const add = (p: unknown) => {
    if (typeof p === 'string' && p.trim()) candidates.push(resolve(normalize(p.trim())));
  };
  add(task.output_path);
  add(task.metadata?.tile_dir);
  add(task.metadata?.out_file);
  add(task.metadata?.pmtiles_path);

  // Deduplicate while preserving order
  const uniqueCandidates = [...new Set(candidates)];

  // Block if a queued/running dependent task references these paths
  const all = Tasks.list({ status: 'all' });
  const pathSet = new Set(uniqueCandidates.map((p) => p.toLowerCase()));
  const busy = all.filter((t) => {
    if (t.id === task.id) return false;
    if (t.status !== 'queued' && t.status !== 'running') return false;
    const refs = [
      t.options?.osm_path,
      t.options?.raster_pack?.tile_dir,
      t.output_path,
    ];
    return refs.some((r) => typeof r === 'string' && pathSet.has(resolve(normalize(r)).toLowerCase()));
  });
  if (busy.length) {
    throw new Error('有进行中的打包/切片任务正使用该文件，请等完成后再改名');
  }

  const mapping = new Map<string, string>();
  const renamed: Array<{ from: string; to: string }> = [];

  // Rename longest paths first so nested dirs are handled correctly
  const existing = uniqueCandidates
    .filter((p) => existsSync(p))
    .sort((a, b) => b.length - a.length);

  for (const from of existing) {
    const to = proposeRenamedPath(from, oldSlug, newSlug, task.id);
    renamePath(from, to);
    mapping.set(from, to);
    renamed.push({ from, to });
  }

  // Also map missing paths that only exist as DB strings (file already gone)
  for (const from of uniqueCandidates) {
    if (mapping.has(from)) continue;
    mapping.set(from, proposeRenamedPath(from, oldSlug, newSlug, task.id));
  }

  const nextOutput =
    typeof task.output_path === 'string'
      ? (rewritePathValue(task.output_path, mapping) as string)
      : task.output_path;

  const nextMeta: Record<string, unknown> = { ...(task.metadata ?? {}) };
  for (const key of ['tile_dir', 'out_file', 'pmtiles_path'] as const) {
    if (key in nextMeta) {
      nextMeta[key] = rewritePathValue(nextMeta[key], mapping);
    }
  }

  const nextRegion = { ...task.region, name: newName };
  Tasks.update(taskId, {
    region: nextRegion,
    output_path: nextOutput,
    metadata: nextMeta,
  });

  const updatedDependentIds: string[] = [];
  for (const t of all) {
    if (t.id === taskId) continue;
    let dirty = false;
    const opts = { ...(t.options ?? {}) };
    const osm = rewritePathValue(opts.osm_path, mapping);
    if (osm !== opts.osm_path) {
      opts.osm_path = osm as string;
      dirty = true;
    }
    if (opts.raster_pack?.tile_dir) {
      const td = rewritePathValue(opts.raster_pack.tile_dir, mapping);
      if (td !== opts.raster_pack.tile_dir) {
        opts.raster_pack = { ...opts.raster_pack, tile_dir: td as string };
        dirty = true;
      }
    }
    if (!dirty) continue;
    // Keep dependent task's region label aligned when paths were rewritten
    const region =
      t.region.name === task.region.name ? { ...t.region, name: newName } : t.region;
    Tasks.update(t.id, { options: opts, region });
    updatedDependentIds.push(t.id);
  }

  const fresh = Tasks.get(taskId);
  if (!fresh) throw new Error('改名后读取任务失败');
  return { task: fresh, renamed, updatedDependentIds };
}
