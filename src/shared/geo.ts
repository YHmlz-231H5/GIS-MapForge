/** Shared geographic helpers for main + renderer. */

export type LonLatBBox = [number, number, number, number];

/** Bbox area in km² (middle-latitude approximation). */
export function bboxAreaKm2(bbox: LonLatBBox): number {
  const [, south, , north] = bbox;
  const dLat = north - south;
  const midLat = (north + south) / 2;
  const dLon = bbox[2] - bbox[0];
  const kmLat = dLat * 111;
  const kmLon = dLon * 111 * Math.cos((midLat * Math.PI) / 180);
  return Math.abs(kmLat * kmLon);
}

/** @deprecated Prefer bboxAreaKm2 — kept as alias for main-process call sites. */
export const estimateAreaKm2 = bboxAreaKm2;

export function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function lat2tile(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

export function estimateRasterTileCount(
  bbox: LonLatBBox,
  minZoom: number,
  maxZoom: number
): number {
  let total = 0;
  const [w, s, e, n] = bbox;
  const z0 = Math.max(0, Math.min(22, Math.floor(minZoom)));
  const z1 = Math.max(z0, Math.min(22, Math.floor(maxZoom)));
  for (let z = z0; z <= z1; z++) {
    const x1 = lon2tile(w, z);
    const x2 = lon2tile(e, z);
    const y1 = lat2tile(n, z);
    const y2 = lat2tile(s, z);
    total += (Math.abs(x2 - x1) + 1) * (Math.abs(y2 - y1) + 1);
  }
  return total;
}

/**
 * Rough raster XYZ download size for a bbox + zoom range.
 * Assumes ~18 KB/tile average (PNG streets); imagery JPEG often larger.
 */
export function estimateRasterDownload(
  bbox: LonLatBBox,
  minZoom: number,
  maxZoom: number,
  bytesPerTile = 18 * 1024
): { tiles: number; bytes: number; minZoom: number; maxZoom: number } {
  const z0 = Math.max(0, Math.min(22, Math.floor(minZoom)));
  const z1 = Math.max(z0, Math.min(22, Math.floor(maxZoom)));
  const tiles = estimateRasterTileCount(bbox, z0, z1);
  return {
    tiles,
    bytes: tiles * bytesPerTile,
    minZoom: z0,
    maxZoom: z1,
  };
}
