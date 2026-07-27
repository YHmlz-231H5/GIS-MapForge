/**
 * pbf-osm-api.worker.mjs — runs in a child Node process spawned by the
 * Electron main process. Streams NDJSON progress to stdout.
 *
 * Downloads OSM XML for 0.02° tiles via Overpass (primary), because
 * api.openstreetmap.org is often unreachable from CN/restricted networks.
 * Falls back across Overpass mirrors on failure.
 *
 * Cross-task reuse: cells are aligned to a global 0.02° grid and stored under
 * --shared-cache keyed by exact clipped bbox. Exact hit → reuse; a partial
 * edge cell of region A never satisfies a full-cell request from region B.
 */

import { mkdir, writeFile, readFile, copyFile } from 'fs/promises';
import { existsSync, statSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Overpass interpreter endpoints — rotate on failure. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const UA = 'app-map-downloader/0.1 (https://github.com/)';
const CELL = 0.02;
const EPS = 1e-9;
const PREC = 6;

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
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  if (msg.kind === 'log' && msg.stream === 'err') {
    process.stderr.write(msg.line + '\n');
  }
}

function errDetail(err) {
  const c = err?.cause;
  if (c?.code) return `${err.message} (${c.code}${c.message ? ': ' + c.message : ''})`;
  if (c?.message) return `${err.message}: ${c.message}`;
  return err?.message || String(err);
}

function roundCoord(v) {
  return Number(Number(v).toFixed(PREC));
}

function cellKey(w, s, e, n) {
  return `c_${roundCoord(w)}_${roundCoord(s)}_${roundCoord(e)}_${roundCoord(n)}`;
}

/**
 * Global 0.02° grid covering [W,S,E,N]. Edge cells are clipped to the bbox
 * (partial=true). Full vs partial get different keys → no false reuse.
 */
function buildCells(W, S, E, N) {
  const cells = [];
  const ix0 = Math.floor(W / CELL + 1e-12);
  const iy0 = Math.floor(S / CELL + 1e-12);
  const ix1 = Math.floor((E - 1e-12) / CELL);
  const iy1 = Math.floor((N - 1e-12) / CELL);

  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const cw = ix * CELL;
      const cs = iy * CELL;
      const ce = cw + CELL;
      const cn = cs + CELL;
      const w = roundCoord(Math.max(cw, W));
      const s = roundCoord(Math.max(cs, S));
      const e = roundCoord(Math.min(ce, E));
      const n = roundCoord(Math.min(cn, N));
      if (e - w < EPS || n - s < EPS) continue;
      const partial =
        w > cw + EPS || s > cs + EPS || e < ce - EPS || n < cn - EPS;
      const key = cellKey(w, s, e, n);
      cells.push({
        w,
        s,
        e,
        n,
        partial,
        key,
        full: [roundCoord(cw), roundCoord(cs), roundCoord(ce), roundCoord(cn)],
      });
    }
  }
  return cells;
}

function overpassQuery(w, s, e, n) {
  return `[out:xml][timeout:90];
(
  node(${s},${w},${n},${e});
  way(${s},${w},${n},${e});
  relation(${s},${w},${n},${e});
);
(._;>;);
out meta;`;
}

function isValidOsmFile(path) {
  try {
    const st = statSync(path);
    if (st.size < 64) return false;
    const buf = readFileSync(path);
    const text = buf.toString('utf-8', 0, Math.min(1024, buf.length));
    const tail = buf.toString('utf-8', Math.max(0, buf.length - 100));
    return text.includes('<?xml') && tail.trimEnd().endsWith('</osm>');
  } catch {
    return false;
  }
}

function writeMeta(sharedCache, cell) {
  if (!sharedCache) return;
  const metaPath = join(sharedCache, `${cell.key}.json`);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        w: cell.w,
        s: cell.s,
        e: cell.e,
        n: cell.n,
        partial: cell.partial,
        full: cell.full,
        key: cell.key,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
}

function ensureLocalFromShared(localPath, sharedPath) {
  if (existsSync(localPath) && isValidOsmFile(localPath)) return 'local';
  if (sharedPath && existsSync(sharedPath) && isValidOsmFile(sharedPath)) {
    copyFileSync(sharedPath, localPath);
    return 'shared';
  }
  return null;
}

async function downloadToPaths(w, s, e, n, localPath, sharedPath, idx) {
  const query = overpassQuery(w, s, e, n);
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[(idx + attempt - 1) % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${body ? ': ' + body.slice(0, 120) : ''}`
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const text = buf.toString('utf-8', 0, Math.min(1024, buf.length));
      const tail = buf.toString('utf-8', Math.max(0, buf.length - 100));
      if (!text.includes('<?xml') || !tail.trimEnd().endsWith('</osm>')) {
        throw new Error('incomplete XML (truncated)');
      }
      writeFileSync(localPath, buf);
      if (sharedPath) writeFileSync(sharedPath, buf);
      return;
    } catch (err) {
      lastErr = err;
      send({
        kind: 'log',
        stream: 'err',
        line: `tile ${idx} attempt ${attempt} via ${new URL(endpoint).host} failed: ${errDetail(err)}`,
      });
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let W = parseFloat(args.w);
  let S = parseFloat(args.s);
  let E = parseFloat(args.e);
  let N = parseFloat(args.n);
  const tileDir = args['tile-dir'];
  const sharedCache = args['shared-cache'] || '';

  if ([W, S, E, N].some(Number.isNaN) || !tileDir) {
    send({
      kind: 'log',
      stream: 'err',
      line: 'usage: --w --s --e --n --tile-dir [--shared-cache]',
    });
    process.exit(2);
  }

  if (W > E) [W, E] = [E, W];
  if (S > N) [S, N] = [N, S];
  W = roundCoord(W);
  S = roundCoord(S);
  E = roundCoord(E);
  N = roundCoord(N);

  send({ kind: 'log', stream: 'out', line: `bounds: W=${W} S=${S} E=${E} N=${N}` });
  send({
    kind: 'log',
    stream: 'out',
    line: `source: Overpass (${OVERPASS_ENDPOINTS.length} mirrors)`,
  });
  send({
    kind: 'log',
    stream: 'out',
    line: sharedCache
      ? `shared geo-cell cache: ${sharedCache}`
      : 'shared geo-cell cache: (disabled)',
  });

  await mkdir(tileDir, { recursive: true });
  if (sharedCache) await mkdir(sharedCache, { recursive: true });

  const cells = buildCells(W, S, E, N);
  const total = cells.length;
  const partialCount = cells.filter((c) => c.partial).length;
  send({
    kind: 'log',
    stream: 'out',
    line: `tiling: ${total} cells on ${CELL}° global grid (${partialCount} edge-clipped)`,
  });

  const statuses = cells.map((cell) => {
    const localPath = join(tileDir, `tile_${cell.key}.osm`);
    const sharedPath = sharedCache ? join(sharedCache, `${cell.key}.osm`) : '';
    if (existsSync(localPath) && isValidOsmFile(localPath)) return 'done';
    if (sharedPath && existsSync(sharedPath) && isValidOsmFile(sharedPath)) return 'done';
    return 'pending';
  });

  const cached = statuses.filter((s) => s === 'done').length;
  send({
    kind: 'tile-plan',
    cells: cells.map((c) => [c.w, c.s, c.e, c.n]),
    statuses,
    partialFlags: cells.map((c) => c.partial),
    cellKeys: cells.map((c) => c.key),
  });

  if (cached > 0) {
    send({
      kind: 'log',
      stream: 'out',
      line: `reuse/resume: ${cached}/${total} cells already on disk (task-local or shared)`,
    });
    send({
      kind: 'progress',
      done: cached,
      total,
      label: `hit ${cached} cached`,
    });
  }

  if (total === 0) {
    send({
      kind: 'log',
      stream: 'err',
      line: `fatal: 0 tiles for bbox (degenerate? W=${W} S=${S} E=${E} N=${N})`,
    });
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  let reusedShared = 0;
  let reusedLocal = 0;
  let downloaded = 0;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const localPath = join(tileDir, `tile_${cell.key}.osm`);
    const sharedPath = sharedCache ? join(sharedCache, `${cell.key}.osm`) : '';
    const labelBase = `${cell.w},${cell.s}→${cell.e},${cell.n}${cell.partial ? ' (partial)' : ''}`;

    try {
      const hit = ensureLocalFromShared(localPath, sharedPath);
      if (hit === 'local') {
        reusedLocal++;
        ok++;
        send({
          kind: 'log',
          stream: 'out',
          line: `tile ${i + 1}/${total} skip (task-local) ${cell.key}`,
        });
      } else if (hit === 'shared') {
        reusedShared++;
        ok++;
        send({
          kind: 'log',
          stream: 'out',
          line: `tile ${i + 1}/${total} reuse (shared geo-cell) ${cell.key}`,
        });
      } else {
        await downloadToPaths(cell.w, cell.s, cell.e, cell.n, localPath, sharedPath, i + 1);
        writeMeta(sharedCache, cell);
        downloaded++;
        ok++;
        send({
          kind: 'log',
          stream: 'out',
          line: `tile ${i + 1}/${total} downloaded ${cell.key}${cell.partial ? ' partial' : ''}`,
        });
      }
      send({
        kind: 'progress',
        done: i + 1,
        total,
        label: labelBase,
        tileIndex: i,
        tileStatus: 'done',
      });
    } catch (err) {
      fail++;
      send({
        kind: 'log',
        stream: 'err',
        line: `tile ${i + 1} failed all 3 retries: ${err.message}`,
      });
      send({
        kind: 'progress',
        done: i + 1,
        total,
        label: `failed ${cell.w},${cell.s}`,
        tileIndex: i,
        tileStatus: 'failed',
      });
    }
  }

  send({
    kind: 'log',
    stream: 'out',
    line: `tiles done: ok=${ok}/${total} fail=${fail} (downloaded=${downloaded}, shared-reuse=${reusedShared}, local-resume=${reusedLocal})`,
  });

  if (ok === 0) {
    send({ kind: 'log', stream: 'err', line: 'fatal: 0 tiles succeeded, aborting merge' });
    process.exit(1);
  }

  if (fail > 0) {
    send({
      kind: 'log',
      stream: 'err',
      line: `fatal: ${fail}/${total} tiles failed — aborting merge. Click「继续」to retry failed cells only.`,
    });
    send({
      kind: 'progress',
      done: ok + fail,
      total,
      label: `incomplete ${fail} failed`,
    });
    process.exit(2);
  }

  send({ kind: 'log', stream: 'out', line: 'merging tiles (XML dedupe)...' });
  const { mergePbf } = await import('./merge-helper.mjs');
  const mergedPath = mergePbf(tileDir);
  send({ kind: 'progress', done: total, total, label: 'merged' });
  send({ kind: 'log', stream: 'out', line: `merged: ${mergedPath}` });

  process.exit(0);
}

main().catch((err) => {
  send({ kind: 'log', stream: 'err', line: `fatal: ${err.message}` });
  process.exit(1);
});
