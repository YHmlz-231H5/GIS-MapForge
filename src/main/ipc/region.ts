import type { IpcMain } from 'electron';
import type { Region, BBox, IpcResult } from '../../shared/types';
import { Presets } from '../db';
import { searchPhoton, photonToRegions } from './photon-client';
import { fetchDataVByAdcode } from './datav-client';
import { estimateAreaKm2 } from './bbox-utils';
import { ok, err } from './result';

/**
 * Compute outer-rect bbox from a GeoJSON FeatureCollection.
 * Falls back to bbox property if present.
 */
function outerBboxFromGeoJson(json: any): { bbox: BBox; displayName?: string } {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

  // If input is a FeatureCollection, walk features
  const features = json.features ?? (json.geometry ? [json] : [json]);
  for (const f of features) {
    walkGeometry(f.geometry, (lon, lat) => {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    });
  }

  if (minLon === Infinity) {
    throw new Error('No geometry found in GeoJSON');
  }
  return {
    bbox: [minLon, minLat, maxLon, maxLat],
    displayName: json.name ?? json.displayName,
  };
}

function walkGeometry(g: any, cb: (lon: number, lat: number) => void): void {
  if (!g) return;
  if (g.type === 'Point') {
    cb(g.coordinates[0], g.coordinates[1]);
  } else if (g.type === 'LineString' || g.type === 'MultiPoint') {
    for (const c of g.coordinates) cb(c[0], c[1]);
  } else if (g.type === 'Polygon' || g.type === 'MultiLineString') {
    for (const ring of g.coordinates) for (const c of ring) cb(c[0], c[1]);
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) cb(c[0], c[1]);
  } else if (g.type === 'GeometryCollection') {
    for (const gg of g.geometries) walkGeometry(gg, cb);
  }
}

export function registerRegionHandlers(ipcMain: IpcMain) {
  // ── Primary keyless backend: Photon (Komoot) ────────────────────────
  ipcMain.handle('region:search', async (_e, query: string): Promise<IpcResult<any>> => {
    if (!query?.trim()) return err('Empty query');
    try {
      const photonRes = await searchPhoton(query);
      const regions = photonToRegions(photonRes, query);
      if (regions.length === 0) {
        return err(`No results for "${query}". Try another name or paste a GeoJSON.`);
      }
      return ok(regions);
    } catch (e) {
      // Fallback to Nominatim if Photon fails (rare; only during komoot outage).
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', '5');
        url.searchParams.set('accept-language', 'zh,en');
        const headers = {
          'User-Agent': 'MapDownloader/0.1 (https://github.com/yourname/mapdownloader)',
          'Accept-Language': 'zh,en',
        };
        const resp = await fetch(url.toString(), { headers });
        if (!resp.ok) {
          throw new Error(`Nominatim HTTP ${resp.status} ${resp.statusText}`);
        }
        const json = (await resp.json()) as Array<{ display_name: string; boundingbox: [string, string, string, string] }>;
        const regions: Region[] = json.map((r) => {
          const [s, n, w, e] = r.boundingbox.map(parseFloat);
          const bbox: BBox = [w, s, e, n];
          return {
            name: r.display_name,
            bbox,
            area_km2: 0,
            estimated_nodes: 0,
            source: 'nominatim',
          };
        });
        return ok(regions);
      } catch (e2) {
        // Compose a clean error: show the Photon hint + Nominatim cause.
        const photonMsg = (e as Error).message;
        const nominatimMsg = (e2 as Error).message;
        return err(
          `Search failed.\n• Photon: ${photonMsg}\n• Nominatim fallback: ${nominatimMsg}\n\nTry a different spelling, paste a GeoJSON, or enter bbox manually.`
        );
      }
    }
  });

  // ── DataV boundary fetch by adcode (called after user selects a region) ─
  ipcMain.handle('region:fetchBoundary', async (_e, adcode: string): Promise<IpcResult<any>> => {
    if (!adcode || !/^\d{6}$/.test(adcode)) return err(`Invalid adcode: ${adcode}`);
    try {
      const data = await fetchDataVByAdcode(adcode);
      return ok(data);
    } catch (e) {
      return err(`DataV error: ${(e as Error).message}`);
    }
  });

  // ── Bridge: best-effort adcode from Photon/OSM bbox + name (heuristic) ──
  ipcMain.handle(
    'region:guessAdcode',
    async (_e, payload: { name: string; bbox: BBox }): Promise<IpcResult<any>> => {
      try {
        const { bestEffortAdcode } = await import('./datav-client');
        const adcode = await bestEffortAdcode(payload.name, payload.bbox);
        if (!adcode) return ok({ adcode: null });
        const data = await fetchDataVByAdcode(adcode);
        return ok({ adcode, boundary: data });
      } catch (e) {
        return err(`adcode heuristic error: ${(e as Error).message}`);
      }
    }
  );

  ipcMain.handle(
    'region:fromGeoJson',
    async (_e, json: unknown): Promise<IpcResult<any>> => {
      try {
        const { bbox, displayName } = outerBboxFromGeoJson(json);
        const name = displayName ?? `custom-${Date.now()}`;
        return ok({
          name,
          bbox,
          area_km2: estimateAreaKm2(bbox),
          estimated_nodes: 0,
          source: 'json-import',
          imported_geojson: json,
        });
      } catch (e) {
        return err(`GeoJSON parse error: ${(e as Error).message}`);
      }
    }
  );

  ipcMain.handle('region:savePreset', async (_e, region: Region): Promise<IpcResult<any>> => {
    try {
      Presets.save(region.name, region.bbox, region.source);
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('region:listPresets', async (): Promise<IpcResult<any>> => {
    try {
      const rows = Presets.list() as any[];
      const regions: Region[] = rows.map((r) => ({
        name: r.name,
        bbox: [r.bbox_west, r.bbox_south, r.bbox_east, r.bbox_north],
        area_km2: estimateAreaKm2([r.bbox_west, r.bbox_south, r.bbox_east, r.bbox_north]),
        estimated_nodes: 0,
        source: r.source,
      }));
      return ok(regions);
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
