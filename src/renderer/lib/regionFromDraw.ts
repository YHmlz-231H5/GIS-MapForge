/**
 * Convert terra-draw / GeoJSON drawings into Region for the download pipeline.
 */
import type { BBox, Region } from '../../shared/types';
import { bboxAreaKm2 } from './utils';

export function bboxFromCoords(coords: Array<[number, number] | number[]>): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const c of coords) {
    const lon = c[0];
    const lat = c[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  if (minLon === Infinity) throw new Error('empty geometry');
  return [minLon, minLat, maxLon, maxLat];
}

export function walkRing(geometry: GeoJSON.Geometry): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const push = (c: number[]) => out.push([c[0], c[1]]);
  if (geometry.type === 'Polygon') {
    for (const c of geometry.coordinates[0] ?? []) push(c);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) for (const c of poly[0] ?? []) push(c);
  } else if (geometry.type === 'Point') {
    push(geometry.coordinates);
  } else if (geometry.type === 'LineString') {
    for (const c of geometry.coordinates) push(c);
  }
  return out;
}

/** Expand/shrink bbox to a geographic square (equal meters) centered on the same point. */
export function squareBbox(bbox: BBox): BBox {
  const [w, s, e, n] = bbox;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180));
  const halfLat = Math.max((n - s) / 2, ((e - w) * cos) / 2);
  const halfLon = halfLat / cos;
  return [cx - halfLon, cy - halfLat, cx + halfLon, cy + halfLat];
}

export function bboxToPolygonFeature(bbox: BBox, properties: Record<string, unknown> = {}): GeoJSON.Feature<GeoJSON.Polygon> {
  const [w, s, e, n] = bbox;
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
}

export function featureToRegion(
  feature: GeoJSON.Feature,
  opts?: { name?: string; asSquare?: boolean }
): Region {
  let geom = feature.geometry;
  let bbox = bboxFromCoords(walkRing(geom));
  let boundary: GeoJSON.Feature = feature;

  if (opts?.asSquare) {
    bbox = squareBbox(bbox);
    boundary = bboxToPolygonFeature(bbox, {
      ...((feature.properties as Record<string, unknown>) ?? {}),
      square: true,
    });
  } else if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') {
    boundary = bboxToPolygonFeature(bbox, {
      ...((feature.properties as Record<string, unknown>) ?? {}),
    });
  }

  const area = bboxAreaKm2(bbox);
  return {
    name: opts?.name ?? (typeof feature.properties?.['name'] === 'string' ? feature.properties['name'] : '手绘区域'),
    bbox,
    area_km2: area,
    estimated_nodes: Math.round(area * 1000),
    source: 'map-draw',
    boundary_geojson: boundary,
    imported_geojson: boundary,
  };
}

/** Prefer the newest polygon from a FeatureCollection. */
export function pickDrawnPolygon(
  fc: { features?: GeoJSON.Feature[] } | undefined
): GeoJSON.Feature | null {
  const feats = fc?.features ?? [];
  for (let i = feats.length - 1; i >= 0; i--) {
    const f = feats[i];
    if (!f?.geometry) continue;
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') return f;
  }
  return null;
}
