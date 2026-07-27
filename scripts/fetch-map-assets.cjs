#!/usr/bin/env node
/**
 * Fetch a COMPLETE local copy of the glyph/sprite assets used by preview
 * (same sources as the working CDN setup):
 *   glyphs  ← https://tiles.openfreemap.org/fonts/...
 *   sprites ← openmaptiles.github.io positron / dark-matter
 *
 * MapLibre BMP glyph ranges = 256 files per font (0-255 … 65280-65535).
 * The old script only pulled ~94 ranges; missing ones returned Vite HTML 404
 * → "Unimplemented type: 4" and correlated LOD seams.
 *
 * Usage:
 *   node scripts/fetch-map-assets.cjs
 *   node scripts/fetch-map-assets.cjs --force   # re-download even if present
 */
const { mkdirSync, writeFileSync, existsSync, readFileSync } = require('fs');
const { join } = require('path');
const https = require('https');
const http = require('http');

const ROOT = join(__dirname, '..', 'vendor', 'map-assets');
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 8;

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 60_000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP ${res.statusCode} ${url}`);
        err.statusCode = res.statusCode;
        res.resume();
        reject(err);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

async function save(url, out) {
  if (!FORCE && existsSync(out)) return 'skip';
  mkdirSync(join(out, '..'), { recursive: true });
  const buf = await get(url);
  // Reject HTML error pages disguised as 200
  if (buf.length >= 15 && buf.toString('utf8', 0, 15).toLowerCase().includes('<!doctype')) {
    throw new Error(`HTML body (not PBF): ${url}`);
  }
  writeFileSync(out, buf);
  return 'ok';
}

/** Full BMP coverage — what MapLibre requests for codepoints U+0000..U+FFFF */
function allBmpRanges() {
  const ranges = [];
  for (let start = 0; start <= 65280; start += 256) {
    ranges.push(`${start}-${start + 255}`);
  }
  return ranges;
}

const RANGES = allBmpRanges(); // 256 ranges

const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];

const SPRITES = [
  ['https://openmaptiles.github.io/positron-gl-style/sprite.json', 'sprites/positron/sprite.json'],
  ['https://openmaptiles.github.io/positron-gl-style/sprite.png', 'sprites/positron/sprite.png'],
  ['https://openmaptiles.github.io/positron-gl-style/sprite@2x.json', 'sprites/positron/sprite@2x.json'],
  ['https://openmaptiles.github.io/positron-gl-style/sprite@2x.png', 'sprites/positron/sprite@2x.png'],
  ['https://openmaptiles.github.io/dark-matter-gl-style/sprite.json', 'sprites/dark-matter/sprite.json'],
  ['https://openmaptiles.github.io/dark-matter-gl-style/sprite.png', 'sprites/dark-matter/sprite.png'],
  ['https://openmaptiles.github.io/dark-matter-gl-style/sprite@2x.json', 'sprites/dark-matter/sprite@2x.json'],
  ['https://openmaptiles.github.io/dark-matter-gl-style/sprite@2x.png', 'sprites/dark-matter/sprite@2x.png'],
];

async function mapPool(items, limit, worker) {
  let i = 0;
  const results = new Array(items.length);
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

(async () => {
  mkdirSync(ROOT, { recursive: true });

  console.log('[sprites]');
  for (const [url, rel] of SPRITES) {
    try {
      console.log(' ', await save(url, join(ROOT, rel)), rel);
    } catch (e) {
      console.warn('  FAIL', rel, e.message || e);
    }
  }

  const jobs = [];
  for (const font of FONTS) {
    for (const range of RANGES) {
      jobs.push({ font, range });
    }
  }

  console.log(`[fonts] ${FONTS.length} stacks × ${RANGES.length} ranges = ${jobs.length} files`);
  let ok = 0;
  let skip = 0;
  let fail = 0;
  /** Keep one tiny valid PBF to fill hard 404s so Vite never serves HTML. */
  let stubPbf = null;

  await mapPool(jobs, CONCURRENCY, async ({ font, range }) => {
    const enc = encodeURIComponent(font);
    const url = `https://tiles.openfreemap.org/fonts/${enc}/${range}.pbf`;
    const out = join(ROOT, 'fonts', font, `${range}.pbf`);
    try {
      const r = await save(url, out);
      if (r === 'ok') {
        ok++;
        if (!stubPbf) {
          const buf = readFileSync(out);
          if (buf.length > 0 && buf.length < 2000) stubPbf = buf;
        }
      } else skip++;
      if ((ok + skip + fail) % 50 === 0) {
        console.log(`  progress ok=${ok} skip=${skip} fail=${fail}`);
      }
    } catch (e) {
      fail++;
      // Optional stub so directory is complete (avoids HTML 404 at runtime)
      if (stubPbf && !existsSync(out)) {
        mkdirSync(join(out, '..'), { recursive: true });
        writeFileSync(out, stubPbf);
      }
    }
  });

  // Second pass: fill any remaining holes with stub (if we have one)
  if (stubPbf) {
    let filled = 0;
    for (const font of FONTS) {
      for (const range of RANGES) {
        const out = join(ROOT, 'fonts', font, `${range}.pbf`);
        if (!existsSync(out)) {
          writeFileSync(out, stubPbf);
          filled++;
        }
      }
    }
    if (filled) console.log(`[fonts] filled ${filled} missing ranges with stub PBF`);
  }

  const marker = {
    complete: true,
    fonts: FONTS,
    rangesPerFont: RANGES.length,
    fetchedAt: new Date().toISOString(),
    source: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    ok,
    skip,
    fail,
  };
  writeFileSync(join(ROOT, 'COMPLETE.json'), JSON.stringify(marker, null, 2));
  console.log(`[done] ok=${ok} skip=${skip} fail=${fail}`);
  console.log(` marker → vendor/map-assets/COMPLETE.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
