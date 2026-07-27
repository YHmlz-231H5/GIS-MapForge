/**
 * Draw the user's selection range on a MapLibre map (bbox rectangle and/or GeoJSON).
 * Prefer boundary / imported polygon over the axis-aligned bbox when available.
 */
import type { Map as MaplibreMap } from 'maplibre-gl';

const SOURCE = 'selection-range';
const FILL = 'selection-range-fill';
const LINE = 'selection-range-line';

function bboxPolygon(bbox: [number, number, number, number]): GeoJSON.FeatureCollection {
  const [w, s, e, n] = bbox;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
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
      },
    ],
  };
}

function asFeatureCollection(data: unknown): GeoJSON.FeatureCollection | null {
  if (!data || typeof data !== 'object') return null;
  const g = data as GeoJSON.GeoJSON;
  if (g.type === 'FeatureCollection') return g;
  if (g.type === 'Feature') {
    return { type: 'FeatureCollection', features: [g] };
  }
  if (
    g.type === 'Polygon' ||
    g.type === 'MultiPolygon' ||
    g.type === 'LineString' ||
    g.type === 'MultiLineString' ||
    g.type === 'Point' ||
    g.type === 'MultiPoint' ||
    g.type === 'GeometryCollection'
  ) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: g }],
    };
  }
  return null;
}

export type SelectionOverlayInput = {
  /** User-selected bbox [west,south,east,north] — not download-expanded. */
  bbox?: [number, number, number, number] | null;
  /** Admin boundary / drawn / imported polygon when present. */
  geojson?: unknown | null;
};

/** Remove previous overlay layers/source if present. */
export function clearSelectionOverlay(map: MaplibreMap) {
  try {
    if (map.getLayer(FILL)) map.removeLayer(FILL);
    if (map.getLayer(LINE)) map.removeLayer(LINE);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  } catch {
    /* style may be mid-swap */
  }
}

/**
 * Paint selection outline. Prefer geojson polygon; fall back to bbox rectangle.
 */
export function applySelectionOverlay(map: MaplibreMap, input: SelectionOverlayInput | null) {
  clearSelectionOverlay(map);
  if (!input) return;

  const fromGeo = input.geojson ? asFeatureCollection(input.geojson) : null;
  let data: GeoJSON.FeatureCollection | null = fromGeo;
  if (!data && input.bbox) {
    const [w, s, e, n] = input.bbox;
    if ([w, s, e, n].every(Number.isFinite) && w < e && s < n) {
      data = bboxPolygon(input.bbox);
    }
  }
  if (!data || data.features.length === 0) return;

  map.addSource(SOURCE, { type: 'geojson', data });
  map.addLayer({
    id: FILL,
    type: 'fill',
    source: SOURCE,
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: LINE,
    type: 'line',
    source: SOURCE,
    paint: { 'line-color': '#d97706', 'line-width': 2, 'line-opacity': 0.95 },
  });
}
