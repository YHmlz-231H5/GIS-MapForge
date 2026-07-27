/**
 * Photon geocoder client — primary keyless search backend.
 *
 * Photon is an open-source geocoder built on top of OSM data, hosted by
 * komoot.io. Free for non-commercial use, no API key required.
 *   https://photon.komoot.io
 *
 * Returns GeoJSON FeatureCollection. Each feature has:
 *   - properties.name          human-readable name
 *   - properties.city          parent city (China: 区是区名)
 *   - properties.state         parent state/province
 *   - properties.country       human-readable country
 *   - properties.countrycode   "CN" / "DE" / etc.
 *   - properties.osm_type      "R" | "W" | "N"
 *   - properties.osm_id        OSM numeric id
 *   - properties.extent        [west, north, east, south] (Photon: upper-left → lower-right;
 *                              NOT GeoJSON [minLon,minLat,maxLon,maxLat] — see komoot/photon#708)
 *   - properties.type          "district" | "city" | "county" | ...
 *   - geometry.coordinates    [lon, lat] point
 */

import type { Region, BBox } from '../../shared/types';
import { estimateAreaKm2 } from './bbox-utils';

const PHOTON_BASE = 'https://photon.komoot.io';

export interface PhotonFeature {
  type: 'Feature';
  properties: {
    osm_id: number;
    osm_type: 'R' | 'W' | 'N';
    osm_key: string;
    osm_value: string;
    type?: string;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
    extent?: [number, number, number, number];
  };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

/** Filter + rank Photon results for a clean list of Region candidates. */
export function photonToRegions(res: PhotonResponse, query: string): Region[] {
  const ranked = res.features
    .map((f) => scoreFeature(f, query))
    .filter((r): r is { f: PhotonFeature; score: number } => r !== null)
    .sort((a, b) => b.score - a.score);

  // Dedup by osm_id (Photon sometimes returns duplicates)
  const seen = new Set<string>();
  const out: Region[] = [];
  for (const { f } of ranked) {
    const k = `${f.properties.osm_type}-${f.properties.osm_id}`;
    if (seen.has(k)) continue;
    seen.add(k);

    const props = f.properties;
    if (!props.extent || !props.name) continue;
    // Photon extent = [minLon, maxLat, maxLon, minLat] (UL→LR).
    // Our BBox = [minLon, minLat, maxLon, maxLat].
    const [west, north, east, south] = props.extent;
    const bbox: BBox = [
      Math.min(west, east),
      Math.min(south, north),
      Math.max(west, east),
      Math.max(south, north),
    ];
    out.push({
      name: buildDisplayName(f),
      bbox,
      area_km2: estimateAreaKm2(bbox),
      estimated_nodes: 0,
      source: 'photon',
      osm_id: props.osm_id,
      osm_type: props.osm_type,
    });
  }
  return out;
}

/** Build a human-readable name like "龙华区, 深圳市, 广东省, 中国". */
function buildDisplayName(f: PhotonFeature): string {
  const p = f.properties;
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  if (p.city && p.city !== p.name) parts.push(p.city);
  if (p.state && p.state !== p.city) parts.push(p.state);
  if (p.country) parts.push(p.country);
  return parts.join(', ');
}

function scoreFeature(
  f: PhotonFeature,
  query: string
): { f: PhotonFeature; score: number } | null {
  const p = f.properties;
  if (!p.name || !p.extent) return null;
  // Prefer administrative (R) and matching name exactly
  let score = 0;
  if (p.osm_type === 'R') score += 50;
  if (p.type && /district|city|county|state/.test(p.type)) score += 20;
  if (p.countrycode === 'CN') score += 10;
  if (p.name === query) score += 30;
  if (p.name && p.name.includes(query)) score += 5;
  return { f, score };
}

export async function searchPhoton(query: string, limit = 8): Promise<PhotonResponse> {
  const url = new URL(PHOTON_BASE + '/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  // NOTE: Photon accepts lang in {default, de, en, fr} only — NOT zh!
  // We pass nothing (default), since search query is already in the user's language.
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'MapDownloader/0.1 (https://github.com/yourname/mapdownloader)',
  };
  const r = await fetch(url.toString(), { headers });
  if (!r.ok) {
    // Read body for diagnostic — Photon returns JSON error details.
    const body = await r.text().catch(() => '');
    throw new Error(`Photon HTTP ${r.status} ${r.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return (await r.json()) as PhotonResponse;
}
