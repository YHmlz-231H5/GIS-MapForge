/**
 * DataV.GeoAtlas client — Chinese administrative boundary polygons.
 *
 * Free public service by Aliyun, no API key required.
 *   https://datav.aliyun.com/portal/school/atlas/area_selector
 *
 * Endpoints used:
 *   GET https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json
 *     → single feature with that adcode + child adcodes
 *   GET https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json
 *     → that adcode + ALL sub-features (recursive)
 *   GET https://geo.datav.aliyun.com/areas_v3/bound/100000.json
 *     → just country feature (use _full to get children)
 *
 * adcode = national admin code (e.g. 440309 = 龙华区). To get from Photon's
 * OSM id, you must look up via the DataV children — currently we don't
 * have that bridge, so we leave adcode optional. The renderer uses
 * `Region.boundary_geojson` if present.
 */

const DATAV_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

export interface DataVFeature {
  type: 'Feature';
  properties: {
    adcode: number;
    name: string;
    center: [number, number];
    centroid: [number, number];
    childrenNum: number;
    level: 'country' | 'province' | 'city' | 'district' | 'street' | 'town';
    parent?: { adcode: number };
  };
  geometry: { type: 'MultiPolygon' | 'Polygon'; coordinates: any };
}

export interface DataVResponse {
  type: 'FeatureCollection';
  features: DataVFeature[];
}

export async function fetchDataVByAdcode(adcode: string): Promise<DataVResponse> {
  const url = `${DATAV_BASE}/${adcode}_full.json`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MapDownloader/0.1',
    },
  });
  if (!r.ok) {
    throw new Error(`DataV HTTP ${r.status} for adcode=${adcode}`);
  }
  return (await r.json()) as DataVResponse;
}

/**
 * For an OSM admin relation (Photon returns osm_type='R' + osm_id), extract
 * the most likely adcode by examining DataV's child list at the matching
 * level. Returns the adcode if confident, undefined otherwise.
 *
 * NOTE: this is heuristic — DataV adcodes and OSM ids are independent
 * numbering systems. We rely on name matching + bbox overlap to guess.
 */
export async function bestEffortAdcode(
  name: string,
  bbox: [number, number, number, number]
): Promise<string | undefined> {
  // Try province level (100000_full.json is small enough to scan)
  try {
    const country = await fetchDataVByAdcode('100000');
    for (const prov of country.features) {
      const c = prov.properties.center;
      if (
        bbox[0] <= c[0] && bbox[2] >= c[0] &&
        bbox[1] <= c[1] && bbox[3] >= c[1]
      ) {
        // bbox contains province center → try this province
        const cities = await fetchDataVByAdcode(String(prov.properties.adcode));
        for (const city of cities.features) {
          const cc = city.properties.center;
          if (
            bbox[0] <= cc[0] && bbox[2] >= cc[0] &&
            bbox[1] <= cc[1] && bbox[3] >= cc[1]
          ) {
            // bbox contains city center → try this city
            const districts = await fetchDataVByAdcode(String(city.properties.adcode));
            for (const dist of districts.features) {
              if (dist.properties.name === name) {
                return String(dist.properties.adcode);
              }
            }
            // No name match at district level → fall through
          }
        }
      }
    }
  } catch {
    // DataV unavailable (offline / blocked) → no adcode, no overlay
  }
  return undefined;
}
