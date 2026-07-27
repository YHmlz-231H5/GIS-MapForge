/**
 * Ensure Planetiler OpenMapTiles auxiliary sources exist under data/sources/.
 * Prefers curl (resumable); falls back to Node fetch.
 */
import { existsSync, statSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { LogPusher } from './_types';

const AUX_SOURCES: Array<{ url: string; name: string; minBytes: number }> = [
  {
    url: 'https://github.com/acalcutt/osm-lakelines/releases/download/v12/lake_centerline.shp.zip',
    name: 'lake_centerline.shp.zip',
    minBytes: 1_000_000,
  },
  {
    url: 'https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip',
    name: 'water-polygons-split-3857.zip',
    minBytes: 1_000_000,
  },
  {
    url: 'https://naciscdn.org/naturalearth/packages/natural_earth_vector.sqlite.zip',
    name: 'natural_earth_vector.sqlite.zip',
    minBytes: 100_000_000,
  },
];

function curlDownload(url: string, dest: string, pushLog: LogPusher): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-L',
      '-C', '-',
      '--connect-timeout', '30',
      '--retry', '5',
      '--retry-delay', '3',
      '-o', dest,
      url,
    ];
    pushLog('out', `[aux] curl ${url}`);
    const child = spawn('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errBuf = '';
    child.stderr.on('data', (c: Buffer) => {
      errBuf += c.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl exit ${code}: ${errBuf.slice(-300)}`));
    });
    child.on('error', reject);
  });
}

async function nodeFetchDownload(url: string, dest: string, pushLog: LogPusher): Promise<void> {
  pushLog('out', `[aux] fetch ${url}`);
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'app-map-downloader/0.1' },
    signal: AbortSignal.timeout(60 * 60_000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
}

export async function ensurePlanetilerAuxSources(
  downloadDir: string,
  pushLog: LogPusher
): Promise<void> {
  await mkdir(downloadDir, { recursive: true });

  for (const src of AUX_SOURCES) {
    const dest = join(downloadDir, src.name);
    if (existsSync(dest) && statSync(dest).size >= src.minBytes) {
      pushLog('out', `[aux] ok ${src.name} (${statSync(dest).size} bytes)`);
      continue;
    }
    pushLog('out', `[aux] downloading ${src.name} ...`);
    console.log('[planetiler-aux] GET', src.url);
    try {
      await curlDownload(src.url, dest, pushLog);
    } catch (e) {
      pushLog('out', `[aux] curl failed (${(e as Error).message}), trying Node fetch...`);
      await nodeFetchDownload(src.url, dest, pushLog);
    }
    const size = existsSync(dest) ? statSync(dest).size : 0;
    if (size < src.minBytes) {
      throw new Error(`Downloaded ${src.name} too small (${size} bytes, need >= ${src.minBytes})`);
    }
    pushLog('out', `[aux] saved ${src.name} (${size} bytes)`);
  }
}
