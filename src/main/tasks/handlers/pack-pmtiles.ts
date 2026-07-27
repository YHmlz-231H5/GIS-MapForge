/**
 * Pack a z/x/y raster tile directory into a standard PMTiles v3 archive.
 * Uses official "PM" magic (readable by `pmtiles` JS / MapLibre Protocol).
 *
 * Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { zxyToTileId } from 'pmtiles';

export type PackPmtilesOptions = {
  tileDir: string;
  outputPath: string;
  format: 'png' | 'jpg' | 'jpeg' | 'webp';
  attribution?: string;
  name?: string;
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
};

const HEADER_SIZE = 127;
const ROOT_BUDGET = 16_257; // 16384 - 127
const Compression = { None: 1, Gzip: 2 } as const;
const TileType = { Unknown: 0, Png: 2, Jpeg: 3, Webp: 4 } as const;

type DirEntry = {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
};

function tileTypeFor(format: PackPmtilesOptions['format']): number {
  if (format === 'webp') return TileType.Webp;
  if (format === 'jpg' || format === 'jpeg') return TileType.Jpeg;
  return TileType.Png;
}

function writeVarint(buf: number[], value: number) {
  let n = value >>> 0;
  while (n >= 0x80) {
    buf.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  buf.push(n);
}

function serializeDirectory(entries: DirEntry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let lastId = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (i > 0) {
      const prev = entries[i - 1]!;
      if (e.offset === prev.offset + prev.length) {
        writeVarint(out, 0);
        continue;
      }
    }
    writeVarint(out, e.offset + 1);
  }
  return Uint8Array.from(out);
}

function putUint64(view: DataView, offset: number, value: number) {
  const lo = value >>> 0;
  const hi = Math.floor(value / 2 ** 32) >>> 0;
  view.setUint32(offset, lo, true);
  view.setUint32(offset + 4, hi, true);
}

function buildHeader(fields: {
  rootOffset: number;
  rootLength: number;
  jsonOffset: number;
  jsonLength: number;
  leafOffset: number;
  leafLength: number;
  tileOffset: number;
  tileLength: number;
  numAddressed: number;
  numEntries: number;
  numContents: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
}): Uint8Array {
  const buf = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // Magic "PMTiles"
  u8.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73], 0);
  view.setUint8(7, 3); // spec version
  putUint64(view, 8, fields.rootOffset);
  putUint64(view, 16, fields.rootLength);
  putUint64(view, 24, fields.jsonOffset);
  putUint64(view, 32, fields.jsonLength);
  putUint64(view, 40, fields.leafOffset);
  putUint64(view, 48, fields.leafLength);
  putUint64(view, 56, fields.tileOffset);
  putUint64(view, 64, fields.tileLength);
  putUint64(view, 72, fields.numAddressed);
  putUint64(view, 80, fields.numEntries);
  putUint64(view, 88, fields.numContents);
  view.setUint8(96, 1); // clustered
  view.setUint8(97, Compression.Gzip);
  view.setUint8(98, Compression.None); // PNG/JPEG already compressed
  view.setUint8(99, fields.tileType);
  view.setUint8(100, fields.minZoom);
  view.setUint8(101, fields.maxZoom);
  view.setInt32(102, Math.round(fields.minLon * 1e7), true);
  view.setInt32(106, Math.round(fields.minLat * 1e7), true);
  view.setInt32(110, Math.round(fields.maxLon * 1e7), true);
  view.setInt32(114, Math.round(fields.maxLat * 1e7), true);
  view.setUint8(118, fields.centerZoom);
  view.setInt32(119, Math.round(fields.centerLon * 1e7), true);
  view.setInt32(123, Math.round(fields.centerLat * 1e7), true);
  return u8;
}

export async function packDirectoryToPmtiles(opts: PackPmtilesOptions): Promise<{ tiles: number }> {
  type TileRec = { tileId: number; data: Buffer };
  const tiles: TileRec[] = [];

  walkTiles(opts.tileDir, (z, x, y, filePath) => {
    const data = readFileSync(filePath);
    tiles.push({ tileId: zxyToTileId(z, x, y), data });
  });

  if (tiles.length === 0) {
    throw new Error('No tiles found in directory to pack as PMTiles');
  }

  tiles.sort((a, b) => a.tileId - b.tileId);

  // Build clustered tile data + directory entries (runLength=1, unique contents).
  const tileParts: Buffer[] = [];
  const leafEntries: DirEntry[] = [];
  let dataOffset = 0;
  for (const t of tiles) {
    leafEntries.push({
      tileId: t.tileId,
      offset: dataOffset,
      length: t.data.length,
      runLength: 1,
    });
    tileParts.push(t.data);
    dataOffset += t.data.length;
  }
  const tileData = Buffer.concat(tileParts);

  const [w, s, e, n] = opts.bounds;
  const metaObj = {
    name: opts.name ?? 'raster',
    description: 'Raster tiles packed by app-map-downloader',
    attribution: opts.attribution ?? '',
    type: 'baselayer',
    format: opts.format === 'jpeg' ? 'jpg' : opts.format,
    bounds: [w, s, e, n],
    center: [(w + e) / 2, (s + n) / 2, Math.min(opts.maxZoom, 12)],
    minzoom: opts.minZoom,
    maxzoom: opts.maxZoom,
  };
  const jsonGzip = gzipSync(Buffer.from(JSON.stringify(metaObj), 'utf8'));

  // Try single root directory; otherwise fan out into leaves.
  let rootEntries = leafEntries;
  let leafBlob = Buffer.alloc(0);
  let compressedRoot = gzipSync(Buffer.from(serializeDirectory(rootEntries)));

  if (compressedRoot.length > ROOT_BUDGET) {
    const LEAF_SIZE = 4000;
    const leaves: DirEntry[] = [];
    const leafChunks: Buffer[] = [];
    let leafOff = 0;
    for (let i = 0; i < leafEntries.length; i += LEAF_SIZE) {
      const slice = leafEntries.slice(i, i + LEAF_SIZE);
      const raw = Buffer.from(serializeDirectory(slice));
      const gz = gzipSync(raw);
      leaves.push({
        tileId: slice[0]!.tileId,
        offset: leafOff,
        length: gz.length,
        runLength: 0, // leaf directory pointer
      });
      leafChunks.push(gz);
      leafOff += gz.length;
    }
    leafBlob = Buffer.concat(leafChunks);
    rootEntries = leaves;
    compressedRoot = gzipSync(Buffer.from(serializeDirectory(rootEntries)));
    if (compressedRoot.length > ROOT_BUDGET) {
      throw new Error(
        `PMTiles root directory too large (${compressedRoot.length} B). Try a smaller area or fewer zoom levels.`
      );
    }
  }

  const rootOffset = HEADER_SIZE;
  const jsonOffset = rootOffset + compressedRoot.length;
  const leafOffset = jsonOffset + jsonGzip.length;
  const tileOffset = leafOffset + leafBlob.length;

  const header = buildHeader({
    rootOffset,
    rootLength: compressedRoot.length,
    jsonOffset,
    jsonLength: jsonGzip.length,
    leafOffset,
    leafLength: leafBlob.length,
    tileOffset,
    tileLength: tileData.length,
    numAddressed: tiles.length,
    numEntries: leafEntries.length,
    numContents: tiles.length,
    tileType: tileTypeFor(opts.format),
    minZoom: opts.minZoom,
    maxZoom: opts.maxZoom,
    minLon: w,
    minLat: s,
    maxLon: e,
    maxLat: n,
    centerZoom: Math.min(opts.maxZoom, 12),
    centerLon: (w + e) / 2,
    centerLat: (s + n) / 2,
  });

  const out = Buffer.concat([
    Buffer.from(header.buffer, header.byteOffset, header.byteLength),
    Buffer.from(compressedRoot),
    Buffer.from(jsonGzip),
    leafBlob,
    tileData,
  ]);
  writeFileSync(opts.outputPath, out);
  return { tiles: tiles.length };
}

function walkTiles(
  root: string,
  onTile: (z: number, x: number, y: number, path: string) => void
) {
  if (!existsSync(root)) return;
  for (const zName of readdirSync(root)) {
    const zPath = join(root, zName);
    if (!statSync(zPath).isDirectory()) continue;
    const z = Number(zName);
    if (!Number.isFinite(z)) continue;
    for (const xName of readdirSync(zPath)) {
      const xPath = join(zPath, xName);
      if (!statSync(xPath).isDirectory()) continue;
      const x = Number(xName);
      if (!Number.isFinite(x)) continue;
      for (const file of readdirSync(xPath)) {
        const m = /^(\d+)\.(png|jpg|jpeg|webp)$/i.exec(file);
        if (!m) continue;
        const y = Number(m[1]);
        onTile(z, x, y, join(xPath, file));
      }
    }
  }
}
