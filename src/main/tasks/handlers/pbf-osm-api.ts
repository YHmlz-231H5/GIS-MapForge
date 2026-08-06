import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';
import { statSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { DownloadTileProgress, TaskProgress } from '../../../shared/types';
import type { HandlerFn } from './_types';
import { resolveOutputDir, resolveTileCacheDir, resolveSharedGeoCellCacheDir } from '../../paths';
import { Tasks } from '../../db';
import { slugifyRegionName } from '../../../shared/slugify';
import { expandBbox, DEFAULT_BBOX_EXPAND_DEG } from '../../../shared/planetiler-options';

/**
 * Download OSM data for bbox via Overpass tiled HTTP requests → merged .osm.
 *
 * Downloads an expanded bbox (≈1.5× z14 tile) beyond region.bbox so Planetiler
 * edge tiles contain real OSM detail, not only coarse Natural Earth fills.
 *
 * Cells use a global 0.02° grid and a shared geo-cell cache so adjacent regions
 * can reuse exact-bbox hits. Clipped edge cells are keyed by their clipped
 * bounds — they never satisfy a later full-cell request.
 */
export const execPbfDownloadOsmApi: HandlerFn = async (task, abort, pushLog, pushProgress) => {
  const downloadsDir = resolveOutputDir();
  await mkdir(downloadsDir, { recursive: true });

  const slug = slugifyRegionName(task.region.name, {
    bbox: task.region.bbox,
    fallbackId: task.id,
  });
  const cacheKey = `${slug}-${task.id.slice(0, 8)}`;
  const finalPath = join(downloadsDir, `${cacheKey}.osm`);

  const regionBbox = task.region.bbox;
  const expandDeg =
    typeof task.options?.download_expand_deg === 'number' && Number.isFinite(task.options.download_expand_deg)
      ? Math.max(0, task.options.download_expand_deg)
      : DEFAULT_BBOX_EXPAND_DEG;
  const downloadBbox = expandDeg > 0 ? expandBbox(regionBbox, expandDeg) : regionBbox;

  const existingTileDir = task.metadata?.tile_dir as string | undefined;
  const preferredTileDir = resolveTileCacheDir(cacheKey);
  // Resume: keep existing cache wherever it was (legacy AppData or new output/.tile-cache).
  const tileDir =
    existingTileDir && existsSync(existingTileDir) ? existingTileDir : preferredTileDir;
  const sharedCache = resolveSharedGeoCellCacheDir();

  await mkdir(tileDir, { recursive: true });
  await mkdir(sharedCache, { recursive: true });

  Tasks.update(task.id, {
    metadata: {
      ...(task.metadata ?? {}),
      tile_dir: tileDir,
      shared_geo_cache: sharedCache,
      output_dir: downloadsDir,
      region_bbox: regionBbox,
      download_bbox: downloadBbox,
      download_expand_deg: expandDeg,
    },
  });

  // Push once so renderer gets output_dir for「打开文件夹」during download.
  pushProgress?.({
    ratio: task.progress?.ratio ?? 0,
    phase: task.progress?.phase ?? 'starting',
    bytes: task.progress?.bytes,
    tiles: task.progress?.tiles,
  });

  pushLog('out', `[osm-api] region bbox: ${regionBbox.join(',')}`);
  pushLog(
    'out',
    expandDeg > 0
      ? `[osm-api] download bbox: ${downloadBbox.join(',')} (edge buffer ±${expandDeg.toFixed(4)}°)`
      : `[osm-api] download bbox: ${downloadBbox.join(',')} (no edge buffer — exact region)`
  );
  pushLog('out', `[osm-api] output dir: ${downloadsDir}`);
  pushLog('out', `[osm-api] task tile dir: ${tileDir}`);
  pushLog('out', `[osm-api] shared geo-cell cache: ${sharedCache}`);
  if (existingTileDir && existsSync(existingTileDir)) {
    pushLog('out', `[osm-api] resuming from task-local tiles when present`);
  }
  pushLog('out', `[osm-api] source: Overpass (api.openstreetmap.org often blocked)`);

  const measureTileBytes = () => {
    try {
      if (!existsSync(tileDir)) return 0;
      return readdirSync(tileDir)
        .filter((f) => f.startsWith('tile_') && f.endsWith('.osm'))
        .reduce((sum, f) => sum + statSync(join(tileDir, f)).size, 0);
    } catch {
      return 0;
    }
  };

  const workerPath = join(__dirname, '..', 'workers', 'pbf-osm-api.worker.mjs');
  const scriptArgs = [
    '--w',
    String(downloadBbox[0]),
    '--s',
    String(downloadBbox[1]),
    '--e',
    String(downloadBbox[2]),
    '--n',
    String(downloadBbox[3]),
    '--tile-dir',
    tileDir,
    '--shared-cache',
    sharedCache,
  ];

  return new Promise((resolve, reject) => {
    const nodeBin = process.env.HERMES_NODE_BIN || 'node';
    const args = [workerPath, ...scriptArgs];
    console.log('[pbf-osm-api] spawning:', nodeBin, args[0], args.slice(1, 5).join(' '));
    const child = spawn(nodeBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let killed = false;
    let tiles: DownloadTileProgress[] = task.progress?.tiles?.length
      ? task.progress.tiles.map((t) => ({ ...t }))
      : [];
    let stdoutBuf = '';

    abort.addEventListener('abort', () => {
      pushLog('out', '[abort] SIGTERM sent to pbf-osm-api worker');
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    });

    const emitProgress = (partial: Partial<TaskProgress> & { ratio: number; phase?: string }) => {
      const bytes = measureTileBytes();
      const progress: TaskProgress = {
        ratio: partial.ratio,
        phase: partial.phase,
        bytes: bytes || partial.bytes,
        tiles: tiles.length ? tiles.map((t) => ({ ...t })) : undefined,
      };
      pushProgress?.(progress);
    };

    const handleMsg = (msg: any) => {
      if (msg.kind === 'tile-plan') {
        const cells = (msg.cells as Array<[number, number, number, number]>) ?? [];
        const statuses = (msg.statuses as Array<'pending' | 'done' | 'failed'> | undefined) ?? [];
        tiles = cells.map((bbox, i) => ({
          bbox,
          status: statuses[i] ?? 'pending',
        }));
        const doneCount = tiles.filter((t) => t.status === 'done').length;
        const ratio = tiles.length > 0 ? doneCount / tiles.length : 0;
        emitProgress({
          ratio,
          phase:
            doneCount > 0
              ? `${doneCount}/${tiles.length} resumed`
              : `0/${tiles.length} tiles`,
        });
        pushLog(
          'out',
          `[tiles] planned ${tiles.length} cells` +
            (doneCount > 0 ? ` (${doneCount} already cached / reusable)` : '')
        );
      } else if (msg.kind === 'progress') {
        const { done, total, label, tileIndex, tileStatus } = msg as {
          done: number;
          total: number;
          label?: string;
          tileIndex?: number;
          tileStatus?: 'done' | 'failed';
        };
        if (typeof tileIndex === 'number' && tiles[tileIndex] && tileStatus) {
          tiles[tileIndex] = { ...tiles[tileIndex], status: tileStatus };
        }
        // Prefer live tile statuses so resume/retry never jumps to index/total.
        const doneFromTiles = tiles.length
          ? tiles.filter((t) => t.status === 'done').length
          : done;
        const denom = tiles.length || total || 1;
        const ratio = Math.min(1, doneFromTiles / denom);
        emitProgress({
          ratio,
          phase: label
            ? `${doneFromTiles}/${denom} ${label}`
            : `${doneFromTiles}/${denom}`,
        });
        pushLog('out', `[progress] ${doneFromTiles}/${denom} ${label ?? ''}`);
      } else if (msg.kind === 'log') {
        console.log('[pbf-osm-api]', msg.line);
        pushLog(msg.stream === 'err' ? 'err' : 'out', msg.line);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleMsg(JSON.parse(line));
        } catch {
          pushLog('out', line);
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      console.error('[pbf-osm-api] stderr:', text);
      pushLog('err', text);
    });
    child.on('close', async (code) => {
      if (stdoutBuf.trim()) {
        try {
          handleMsg(JSON.parse(stdoutBuf));
        } catch {
          /* ignore trailing fragment */
        }
        stdoutBuf = '';
      }
      if (killed) return reject(new Error('Task cancelled'));

      const failedCount = tiles.filter((t) => t.status === 'failed').length;
      const doneCount = tiles.filter((t) => t.status === 'done').length;
      const totalTiles = tiles.length || 1;

      if (code !== 0) {
        // Persist tile statuses so MapView keeps amber cells and「继续」can retry.
        emitProgress({
          ratio: doneCount / totalTiles,
          phase:
            failedCount > 0
              ? `${doneCount}/${tiles.length} · ${failedCount} 格失败`
              : `worker exit ${code}`,
        });
        const msg =
          failedCount > 0
            ? `${failedCount} 个下载格失败，范围有空洞。请点「继续」仅重试失败格，全部成功后再生成矢量瓦片。`
            : `Worker exited with code ${code}`;
        console.error('[pbf-osm-api]', msg);
        return reject(new Error(msg));
      }

      const mergedOsm = join(tileDir, 'merged.osm');
      const mergedPbf = join(tileDir, 'merged.osm.pbf');
      const mergedPath = existsSync(mergedOsm) ? mergedOsm : mergedPbf;
      if (!existsSync(mergedPath)) {
        const msg = `Worker exited 0 but merged output missing in ${tileDir}`;
        console.error('[pbf-osm-api]', msg);
        return reject(new Error(msg));
      }
      // Safety: never accept a "success" that still has failed cells (old workers / races).
      if (failedCount > 0 || tiles.some((t) => t.status === 'pending')) {
        emitProgress({
          ratio: doneCount / totalTiles,
          phase: `${doneCount}/${tiles.length} incomplete`,
        });
        return reject(
          new Error(
            `下载格子未全部成功（失败 ${failedCount}）。请点「继续」重试后再转换。`
          )
        );
      }
      const outPath = mergedPath.endsWith('.osm.pbf')
        ? finalPath.replace(/\.osm$/, '.osm.pbf')
        : finalPath;
      await copyFile(mergedPath, outPath);
      const size = statSync(outPath).size;
      pushLog('out', `[done] wrote ${outPath} (${size} bytes)`);
      console.log('[pbf-osm-api] success:', outPath, size, 'bytes');
      emitProgress({ ratio: 1, phase: 'done' });
      resolve({
        output_path: outPath,
        metadata: {
          tile_count: tiles.length,
          bytes: size,
          bbox: regionBbox,
          region_bbox: regionBbox,
          download_bbox: downloadBbox,
          download_expand_deg: expandDeg,
          tile_dir: tileDir,
          shared_geo_cache: sharedCache,
          output_dir: downloadsDir,
          tiles_complete: true,
        },
      });
    });
    child.on('error', (e) => {
      console.error('[pbf-osm-api] spawn error:', e.message);
      reject(e);
    });
  });
};

async function copyFile(src: string, dst: string) {
  const { copyFile: cp } = await import('fs/promises');
  await cp(src, dst);
}
