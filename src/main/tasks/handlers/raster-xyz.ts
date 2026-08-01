import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { HandlerFn } from './_types';
import { resolveOutputDir } from '../../paths';
import { packDirectoryToMbtiles } from './pack-mbtiles';
import { slugifyRegionName } from '../../../shared/slugify';
import { previewTileForBbox, resolveRasterUrl } from '../../../shared/raster-sources';
import { validateRasterTileBytes } from '../../../shared/raster-tile-validate';

/**
 * Raster XYZ download → directory, optionally pack to MBTiles.
 * PMTiles: tiles written as directory + note (reader supports raster; pack via go-pmtiles).
 */
export const execRasterDownloadXyz: HandlerFn = async (task, abort, pushLog, pushProgress) => {
  const rs = task.options.raster_source;
  const urlTemplate = rs?.url_template;
  const minZoom = rs?.min_zoom ?? 0;
  const maxZoom = rs?.max_zoom ?? 20;
  const format = (rs?.format ?? 'png') as 'png' | 'jpeg' | 'webp';
  const container = (rs?.container ?? 'directory') as 'directory' | 'mbtiles' | 'pmtiles';
  const subdomains = rs?.subdomains?.join(',') ?? '';
  const attribution = rs?.attribution ?? '';
  const sourceId = rs?.source_id ?? 'custom';

  if (!urlTemplate) {
    throw new Error('raster_source.url_template is required');
  }

  const downloadsDir = resolveOutputDir();
  const outputDir = resolveOutputDir();
  const slug = slugifyRegionName(task.region.name, {
    bbox: task.region.bbox,
    fallbackId: task.id,
  });
  const tileDir = join(downloadsDir, 'raster', `${slug}-${sourceId}`);
  await mkdir(tileDir, { recursive: true });

  pushLog('out', `[raster] source=${sourceId}`);
  pushLog('out', `[raster] URL: ${urlTemplate}`);
  pushLog('out', `[raster] zoom ${minZoom}..${maxZoom}, format=${format}, container=${container}`);
  pushLog('out', `[raster] tile dir → ${tileDir}`);

  // Sample one mid-zoom tile before bulk fetch — fail fast on Access blocked / HTML.
  await sampleRasterTile(urlTemplate, task.region.bbox, rs?.subdomains, pushLog);

  const workerPath = join(__dirname, '..', 'workers', 'raster-xyz.worker.mjs');
  const scriptArgs = [
    '--url',
    urlTemplate,
    '--bbox',
    task.region.bbox.join(','),
    '--min-zoom',
    String(minZoom),
    '--max-zoom',
    String(maxZoom),
    '--format',
    format,
    '--out-dir',
    tileDir,
    '--concurrency',
    '8',
  ];
  if (subdomains) {
    scriptArgs.push('--subdomains', subdomains);
  }

  await runWorker(workerPath, scriptArgs, abort, pushLog, pushProgress);

  if (container === 'directory') {
    return {
      output_path: tileDir,
      metadata: {
        format,
        container,
        min_zoom: minZoom,
        max_zoom: maxZoom,
        source_id: sourceId,
        tile_dir: tileDir,
        attribution,
      },
    };
  }

  if (container === 'mbtiles') {
    const outFile = resolve(outputDir, `${slug}-${sourceId}.mbtiles`);
    pushLog('out', `[raster] packing MBTiles → ${outFile}`);
    pushProgress?.({ ratio: 0.95, phase: 'pack-mbtiles' });
    const { tiles } = packDirectoryToMbtiles({
      tileDir,
      outputPath: outFile,
      name: `${task.region.name} (${sourceId})`,
      format: format === 'jpeg' ? 'jpg' : format,
      attribution,
      minZoom,
      maxZoom,
      bounds: task.region.bbox,
    });
    pushLog('out', `[raster] packed ${tiles} tiles into MBTiles`);
    return {
      output_path: outFile,
      metadata: {
        format,
        container: 'mbtiles',
        min_zoom: minZoom,
        max_zoom: maxZoom,
        source_id: sourceId,
        tile_dir: tileDir,
        attribution,
        tiles,
      },
    };
  }

  // pmtiles: keep directory; write a sidecar note (JS pmtiles is read-oriented)
  const notePath = join(tileDir, 'PACK-PMTILES.txt');
  await writeFile(
    notePath,
    [
      'Raster tiles were downloaded as a directory (z/x/y).',
      'Use the task card 「打包 PMTiles」 button, or: go-pmtiles convert <tileDir> <out.pmtiles>',
      '',
      `source: ${sourceId}`,
      `url: ${urlTemplate}`,
      `zoom: ${minZoom}..${maxZoom}`,
      `attribution: ${attribution}`,
    ].join('\n'),
    'utf8'
  );
  pushLog(
    'out',
    '[raster] container=pmtiles → tiles left as directory; use task card to pack MBTiles/PMTiles'
  );
  return {
    output_path: tileDir,
    metadata: {
      format,
      container: 'pmtiles-pending',
      min_zoom: minZoom,
      max_zoom: maxZoom,
      source_id: sourceId,
      tile_dir: tileDir,
      attribution,
      note: notePath,
    },
  };
};

/** Fail fast if the provider returns HTML / Access-blocked fakes. */
async function sampleRasterTile(
  urlTemplate: string,
  bbox: [number, number, number, number],
  subdomains: string[] | undefined,
  pushLog: (stream: 'out' | 'err', line: string) => void
): Promise<void> {
  const { z, x, y } = previewTileForBbox(bbox, 10);
  const url = resolveRasterUrl(urlTemplate, z, x, y, subdomains, 0);
  pushLog('out', `[raster] sample tile z${z}/${x}/${y} …`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'app-map-downloader/0.1 (offline map; respectful bulk)',
      Accept: 'image/*,*/*',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(
      `Sample tile HTTP ${res.status} — 该图源当前不可用，请换 Carto / Esri / OpenTopo 等源`
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const check = validateRasterTileBytes(buf);
  if (!check.ok) {
    throw new Error(
      `Sample tile invalid (${check.reason}) — 常见于 OSM 官方 Access blocked，请更换图源`
    );
  }
  pushLog('out', `[raster] sample ok (${buf.length} bytes)`);
}

function runWorker(
  workerPath: string,
  scriptArgs: string[],
  abort: AbortSignal,
  pushLog: Parameters<HandlerFn>[2],
  pushProgress?: Parameters<HandlerFn>[3]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const nodeBin = process.env.HERMES_NODE_BIN || 'node';
    const child = spawn(nodeBin, [workerPath, ...scriptArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let killed = false;
    abort.addEventListener('abort', () => {
      killed = true;
      pushLog('out', '[abort] SIGTERM sent to raster-xyz worker');
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    });

    const onLine = (line: string, stream: 'out' | 'err') => {
      const t = line.trim();
      if (!t) return;
      try {
        const msg = JSON.parse(t) as {
          kind?: string;
          stream?: string;
          line?: string;
          done?: number;
          total?: number;
          bytes?: number;
          label?: string;
        };
        if (msg.kind === 'progress' && pushProgress && msg.total) {
          pushProgress({
            ratio: Math.min(1, (msg.done ?? 0) / msg.total),
            phase: msg.label ?? 'raster',
            bytes: typeof msg.bytes === 'number' ? msg.bytes : undefined,
          });
          return;
        }
        if (msg.kind === 'log' && msg.line) {
          pushLog(msg.stream === 'err' ? 'err' : 'out', msg.line);
          return;
        }
      } catch {
        /* plain text */
      }
      pushLog(stream, t);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) onLine(line, 'out');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) onLine(line, 'err');
    });
    child.on('close', (code) => {
      if (killed) return reject(new Error('Task cancelled'));
      if (code !== 0) return reject(new Error(`Raster worker exited with code ${code}`));
      resolve();
    });
    child.on('error', reject);
  });
}
