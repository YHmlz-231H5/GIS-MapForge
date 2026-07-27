/**
 * Pack a z/x/y tile directory into an MBTiles (raster) archive.
 * MBTiles tile_row uses TMS Y: (2^z - 1) - y.
 */
import Database from 'better-sqlite3';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

export type PackMbtilesOptions = {
  tileDir: string;
  outputPath: string;
  name: string;
  format: 'png' | 'jpg' | 'jpeg' | 'webp';
  attribution?: string;
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number]; // W,S,E,N
};

export function packDirectoryToMbtiles(opts: PackMbtilesOptions): { tiles: number } {
  const extPreferred = opts.format === 'jpeg' ? 'jpg' : opts.format;
  const db = new Database(opts.outputPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS tiles (
      zoom_level INTEGER,
      tile_column INTEGER,
      tile_row INTEGER,
      tile_data BLOB
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tile_index
      ON tiles (zoom_level, tile_column, tile_row);
  `);

  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)');
  const insertTile = db.prepare(
    'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)'
  );

  const [w, s, e, n] = opts.bounds;
  const meta: Record<string, string> = {
    name: opts.name,
    format: extPreferred === 'jpg' ? 'jpg' : extPreferred,
    type: 'baselayer',
    version: '1.1',
    description: `Raster tiles packed by app-map-downloader`,
    attribution: opts.attribution ?? '',
    minzoom: String(opts.minZoom),
    maxzoom: String(opts.maxZoom),
    bounds: `${w},${s},${e},${n}`,
    center: `${(w + e) / 2},${(s + n) / 2},${Math.min(opts.maxZoom, 12)}`,
  };
  const insertManyMeta = db.transaction(() => {
    for (const [k, v] of Object.entries(meta)) insertMeta.run(k, v);
  });
  insertManyMeta();

  let tiles = 0;
  const insertMany = db.transaction((rows: Array<[number, number, number, Buffer]>) => {
    for (const row of rows) insertTile.run(...row);
  });

  const batch: Array<[number, number, number, Buffer]> = [];
  walkTiles(opts.tileDir, (z, x, y, filePath) => {
    const data = readFileSync(filePath);
    const tmsY = (1 << z) - 1 - y;
    batch.push([z, x, tmsY, data]);
    tiles++;
    if (batch.length >= 500) {
      insertMany(batch.splice(0, batch.length));
    }
  });
  if (batch.length) insertMany(batch);

  db.close();
  return { tiles };
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
