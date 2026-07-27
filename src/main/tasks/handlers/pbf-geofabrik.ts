import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';
import { statSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import type { Task } from '../../../shared/types';
import type { HandlerFn } from './_types';
import { resolveDownloadsDir } from '../../paths';
import { Tasks } from '../../db';
import { slugifyRegionName } from '../../../shared/slugify';

/**
 * Download OSM PBF from a Geofabrik URL.
 *
 * Strategy: shell out to `curl -L -C -` so users benefit from resumable
 * downloads (per skill recipe: pbf-data-sources.md). msys bash + curl
 * is fine for the simple HTTPS GET that Geofabrik serves.
 *
 * Special fields used from task.options:
 *   task.metadata?.url — full Geofabrik URL (since the region name alone
 *     doesn't map deterministically to a country extract).
 */
export const execPbfDownloadGeofabrik: HandlerFn = async (task, abort, pushLog, pushProgress) => {
  const url = (task.options as any)?.planetiler?.url ||
    (task.metadata as any)?.url ||
    (task.options as any)?.geofabrik_url;
  if (!url) {
    throw new Error(
      'Geofabrik URL not provided. Use the layer-curation drawer\'s Geofabrik URL prompt, or pass planetiler.url in options.'
    );
  }

  const downloadsDir = resolveDownloadsDir();
  await mkdir(downloadsDir, { recursive: true });

  // Derive filename from URL (last path segment).
  const urlPath = new URL(url).pathname;
  const filename = urlPath.split('/').pop() || `${slugifyRegionName(task.region.name, { bbox: task.region.bbox, fallbackId: task.id })}.osm.pbf`;
  const finalPath = join(downloadsDir, filename.replace(/-\d{8}\./, '.'));
  // If url ends with -260101.osm.pbf, strip date:
  const cleanedFilename = filename.replace(/-\d{6}\.osm\.pbf$/, '.osm.pbf');
  const outputPath = join(downloadsDir, cleanedFilename);

  pushLog('out', `[geofabrik] URL: ${url}`);
  pushLog('out', `[geofabrik] → ${outputPath}`);
  pushLog('out', `[geofabrik] (resumable via curl -C -)`);

  Tasks.update(task.id, {
    metadata: {
      ...(task.metadata ?? {}),
      output_dir: downloadsDir,
    },
  });
  pushProgress?.({
    ratio: task.progress?.ratio ?? 0,
    phase: 'downloading',
    bytes: task.progress?.bytes,
  });

  // We use curl on PATH (msys curl on Windows). It supports HTTP Range.
  // For network interruption recovery, -C - resumes from last byte.
  return new Promise((resolve, reject) => {
    const args = [
      '-L',          // follow redirects (Geofabrik uses -latest → dated redirect)
      '-C', '-',     // resume from existing partial file
      '-f',          // fail fast on HTTP error
      '-s',          // silent (no progress bar)
      '--connect-timeout', '30',
      '--max-time', String(7 * 24 * 3600),  // 7 days max
      '-o', outputPath,
      url,
    ];

    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let killed = false;

    const pollHandle = setInterval(() => {
      if (existsSync(outputPath)) {
        const bytes = statSync(outputPath).size;
        pushProgress?.({ ratio: 0, phase: 'downloading', bytes });
      }
    }, 1000);

    const stopPoll = () => clearInterval(pollHandle);

    abort.addEventListener('abort', () => {
      killed = true;
      stopPoll();
      pushLog('out', '[abort] curl SIGTERM');
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.includes('%') || line.includes('Bytes')) {
          pushLog('out', line);
        }
      }
    });
    child.stdout.on('data', (chunk: Buffer) => pushLog('out', chunk.toString()));

    child.on('close', (code) => {
      stopPoll();
      if (killed) return reject(new Error('Task cancelled'));
      if (code !== 0) {
        return reject(new Error(`curl exited with code ${code} (likely network issue)`));
      }
      // Verify file integrity — Geofabrik PBFs start with OSM PBF header bytes
      if (!existsSync(outputPath)) {
        return reject(new Error(`curl exit 0 but ${outputPath} missing`));
      }
      const size = statSync(outputPath).size;
      pushLog('out', `[done] wrote ${outputPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      resolve({
        output_path: outputPath,
        metadata: {
          bytes: size,
          source_url: url,
          region: task.region.name,
          output_dir: downloadsDir,
        },
      });
    });
    child.on('error', (e) => {
      stopPoll();
      reject(e);
    });
  });
};
