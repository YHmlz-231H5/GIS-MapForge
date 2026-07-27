/**
 * raster-xyz.worker.mjs — fetch XYZ tiles for a bbox → directory tree z/x/y.ext
 *
 * Args:
 *   --url <template>   {z}{x}{y} and optional {s}
 *   --bbox W,S,E,N
 *   --min-zoom --max-zoom
 *   --format png|jpeg|webp
 *   --out-dir <dir>
 *   --subdomains a,b,c   (optional)
 *   --concurrency 8
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] ?? '';
      i++;
    }
  }
  return args;
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat, z) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

function isImageMagic(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }
  return false;
}

function looksLikeBlockedTile(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1');
  return /access\s*blocked|cloudflare|forbidden|access denied|rate.?limit|captcha/i.test(head);
}

async function fetchTile(url, headers, retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (looksLikeBlockedTile(buf)) throw new Error('blocked / error page in body');
      if (!isImageMagic(buf)) throw new Error('not an image (bad magic)');
      return buf;
    } catch (err) {
      if (attempt > retries) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

function buildUrl(template, z, x, y, subdomains, counter) {
  let url = template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));
  if (subdomains.length && url.includes('{s}')) {
    url = url.replaceAll('{s}', subdomains[counter % subdomains.length]);
  }
  return url;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urlTpl = args.url;
  const bbox = (args.bbox || '').split(',').map(Number);
  const minZoom = parseInt(args['min-zoom'] ?? '0', 10);
  const maxZoom = parseInt(args['max-zoom'] ?? '20', 10);
  const format = (args.format ?? 'png').toLowerCase();
  const outDir = args['out-dir'];
  const subdomains = (args.subdomains || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const concurrency = Math.max(1, parseInt(args.concurrency ?? '8', 10) || 8);

  if (!urlTpl || bbox.length !== 4 || !outDir || ![minZoom, maxZoom].every(Number.isFinite)) {
    send({
      kind: 'log',
      stream: 'err',
      line: 'usage: --url --bbox W,S,E,N --min-zoom --max-zoom --format --out-dir [--subdomains a,b,c]',
    });
    process.exit(2);
  }

  const ext = format === 'jpeg' ? 'jpg' : format;
  await mkdir(outDir, { recursive: true });

  const [W, S, E, N] = bbox;
  const allTiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const tx1 = lonToTileX(W, z);
    const tx2 = lonToTileX(E, z);
    const ty1 = latToTileY(N, z);
    const ty2 = latToTileY(S, z);
    const cMin = Math.min(tx1, tx2);
    const cMax = Math.max(tx1, tx2);
    const rMin = Math.min(ty1, ty2);
    const rMax = Math.max(ty1, ty2);
    for (let x = cMin; x <= cMax; x++) {
      for (let y = rMin; y <= rMax; y++) {
        allTiles.push({ z, x, y });
      }
    }
  }

  send({ kind: 'log', stream: 'out', line: `planned ${allTiles.length} tiles z${minZoom}..${maxZoom}` });
  send({ kind: 'progress', done: 0, total: allTiles.length, bytes: 0, label: 'fetch' });

  let written = 0;
  let failed = 0;
  let counter = 0;
  let bytesTotal = 0;

  for (let i = 0; i < allTiles.length; i += concurrency) {
    const slice = allTiles.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (t) => {
        const url = buildUrl(urlTpl, t.z, t.x, t.y, subdomains, counter++);
        try {
          const buf = await fetchTile(url, {
            'User-Agent': 'app-map-downloader/0.1 (offline map; respectful bulk)',
          });
          const dir = join(outDir, String(t.z), String(t.x));
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, `${t.y}.${ext}`), buf);
          written++;
          bytesTotal += buf.length;
        } catch (err) {
          failed++;
          send({
            kind: 'log',
            stream: 'err',
            line: `tile ${t.z}/${t.x}/${t.y} failed: ${err.message}`,
          });
        }
      })
    );
    send({
      kind: 'progress',
      done: Math.min(i + concurrency, allTiles.length),
      total: allTiles.length,
      bytes: bytesTotal,
      label: `z${slice[0]?.z ?? maxZoom}`,
    });
  }

  send({ kind: 'log', stream: 'out', line: `wrote ${written} tiles, ${failed} failed → ${outDir}` });
  send({
    kind: 'progress',
    done: allTiles.length,
    total: allTiles.length,
    bytes: bytesTotal,
    label: 'done',
  });
  process.exit(failed > 0 && written === 0 ? 1 : 0);
}

main().catch((err) => {
  send({ kind: 'log', stream: 'err', line: `fatal: ${err.message}` });
  process.exit(1);
});
