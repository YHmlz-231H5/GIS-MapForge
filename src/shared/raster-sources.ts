/**

 * Open / freely usable raster XYZ tile sources for offline download.

 * Prefer no-API-key endpoints that tolerate polite bulk use. Always preserve attribution.

 *

 * Curated for downloaders (MOBAC / leaflet-providers / xyzservices style):

 * CartoCDN + Esri ArcGIS Online + OpenTopoMap first; OSM.org official tiles are

 * display-oriented and often return "Access blocked" under bulk / some networks.

 *

 * See skill: references/raster-xyz-download.md

 */

import { estimateRasterTileCount, lat2tile, lon2tile } from './geo';

export { estimateRasterTileCount };

export type RasterSourceKind = 'streets' | 'imagery' | 'topo' | 'overlay';



/** UI default max zoom when opening the dialog / switching source (clamped to source.maxzoom). */

export const DEFAULT_RASTER_UI_MAX_ZOOM = 20;



export interface RasterTileSource {

  id: string;

  label: string;

  kind: RasterSourceKind;

  /** XYZ template with {z} {x} {y}; optional {s} for subdomain. */

  urlTemplate: string;

  subdomains?: string[];

  maxzoom: number;

  /** Suggested UI max zoom (≤ maxzoom). Prefer DEFAULT_RASTER_UI_MAX_ZOOM when source allows. */

  suggestMaxZoom: number;

  format: 'png' | 'jpeg' | 'webp';

  attribution: string;

  /** Rough network region hint */

  regions: Array<'cn' | 'intl' | 'any'>;

  notes?: string;

  /**

   * Whether this endpoint is generally suitable for offline bulk download.

   * false → shown but warned / demoted; probe may still succeed for a single preview tile.

   */

  bulkOk: boolean;

}



function suggestZ(maxzoom: number, preferred = DEFAULT_RASTER_UI_MAX_ZOOM): number {

  return Math.min(preferred, maxzoom);

}



export const RASTER_DOWNLOAD_SOURCES: RasterTileSource[] = [

  // —— Prefer for bulk (CDN / commercial free basemap) ——

  {

    id: 'carto-light',

    label: 'Carto Positron (light)',

    kind: 'streets',

    urlTemplate: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors © CARTO',

    regions: ['any'],

    bulkOk: true,

    notes: '推荐：CDN 稳定，适合中小范围离线打包',

  },

  {

    id: 'carto-dark',

    label: 'Carto Dark Matter',

    kind: 'streets',

    urlTemplate: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors © CARTO',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'carto-voyager',

    label: 'Carto Voyager',

    kind: 'streets',

    urlTemplate: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors © CARTO',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'carto-voyager-labels',

    label: 'Carto Voyager Labels',

    kind: 'overlay',

    urlTemplate: 'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors © CARTO',

    regions: ['any'],

    bulkOk: true,

    notes: '仅标注层，需叠在无标注底图上',

  },

  {

    id: 'esri-imagery',

    label: 'Esri World Imagery',

    kind: 'imagery',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 19,

    suggestMaxZoom: suggestZ(19),

    format: 'jpeg',

    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',

    regions: ['any'],

    bulkOk: true,

    notes: '影像常用源（MOBAC/SAS 同类）；无注记，可另下「Esri Imagery Labels」叠层；请保留 Esri 署名，勿超大规模爬取',

  },

  {

    id: 'esri-imagery-labels',

    label: 'Esri Imagery Labels',

    kind: 'overlay',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 19,

    suggestMaxZoom: suggestZ(19),

    format: 'png',

    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',

    regions: ['any'],

    bulkOk: true,

    notes: 'Esri 官方影像注记层（边界/地名，透明底）；叠在 World Imagery 上使用，需单独下载',

  },

  {

    id: 'esri-street',

    label: 'Esri World Street Map',

    kind: 'streets',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 19,

    suggestMaxZoom: suggestZ(19),

    format: 'jpeg',

    attribution: 'Tiles © Esri',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'esri-topo',

    label: 'Esri World Topo Map',

    kind: 'topo',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 19,

    suggestMaxZoom: suggestZ(19),

    format: 'jpeg',

    attribution: 'Tiles © Esri',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'esri-gray',

    label: 'Esri Light Gray Canvas',

    kind: 'streets',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 16,

    suggestMaxZoom: suggestZ(16),

    format: 'jpeg',

    attribution: 'Tiles © Esri',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'esri-dark-gray',

    label: 'Esri Dark Gray Canvas',

    kind: 'streets',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 16,

    suggestMaxZoom: suggestZ(16),

    format: 'jpeg',

    attribution: 'Tiles © Esri',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'esri-ocean',

    label: 'Esri Ocean Basemap',

    kind: 'topo',

    urlTemplate:

      'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',

    maxzoom: 16,

    suggestMaxZoom: suggestZ(16),

    format: 'jpeg',

    attribution: 'Tiles © Esri',

    regions: ['any'],

    bulkOk: true,

  },

  {

    id: 'opentopomap',

    label: 'OpenTopoMap',

    kind: 'topo',

    urlTemplate: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',

    subdomains: ['a', 'b', 'c'],

    maxzoom: 17,

    suggestMaxZoom: suggestZ(17),

    format: 'png',

    attribution: '© OpenStreetMap contributors, SRTM | style © OpenTopoMap (CC-BY-SA)',

    regions: ['intl'],

    bulkOk: true,

    notes: '地形晕渲；服务容量有限，请控制并发与范围',

  },

  {

    id: 'opentopo-fr',

    label: 'OpenTopoMap (FR CDN)',

    kind: 'topo',

    urlTemplate: 'https://a.tile.opentopomap.fr/topo/{z}/{x}/{y}.png',

    subdomains: ['a', 'b', 'c'],

    maxzoom: 17,

    suggestMaxZoom: suggestZ(17),

    format: 'png',

    attribution: '© OpenStreetMap contributors, OpenTopoMap',

    regions: ['intl'],

    bulkOk: true,

  },



  // —— OSM community mirrors (small areas; still respect tile usage policy) ——

  {

    id: 'osm-de',

    label: 'OSM Deutschland',

    kind: 'streets',

    urlTemplate: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',

    maxzoom: 19,

    suggestMaxZoom: suggestZ(19),

    format: 'png',

    attribution: '© OpenStreetMap contributors',

    regions: ['intl'],

    bulkOk: true,

    notes: '社区镜像；仅小范围、低并发',

  },

  {

    id: 'osm-fr',

    label: 'OSM France',

    kind: 'streets',

    urlTemplate: 'https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',

    subdomains: ['a', 'b', 'c'],

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors, tiles © OSM France',

    regions: ['intl'],

    bulkOk: true,

  },

  {

    id: 'cyclosm',

    label: 'CyclOSM',

    kind: 'streets',

    urlTemplate: 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',

    subdomains: ['a', 'b', 'c'],

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors, CyclOSM',

    regions: ['intl'],

    bulkOk: true,

  },

  {

    id: 'hot',

    label: 'Humanitarian OSM',

    kind: 'streets',

    urlTemplate: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',

    subdomains: ['a', 'b', 'c'],

    maxzoom: 20,

    suggestMaxZoom: suggestZ(20),

    format: 'png',

    attribution: '© OpenStreetMap contributors, tiles © HOT',

    regions: ['intl'],

    bulkOk: false,

    notes: '部分网络返回 403；打开抽屉时会实测预览',

  },



  // —— Discouraged for bulk (kept for preview / tiny areas only) ——

  {

    id: 'osm',

    label: 'OpenStreetMap Standard',

    kind: 'streets',

    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',

    maxzoom: 19,

    suggestMaxZoom: suggestZ(19),

    format: 'png',

    attribution: '© OpenStreetMap contributors',

    regions: ['intl'],

    bulkOk: false,

    notes: '官方瓦片禁止大规模爬取；易出现 Access blocked 假图',

  },

];



export function findRasterDownloadSource(id: string): RasterTileSource | undefined {

  return RASTER_DOWNLOAD_SOURCES.find((s) => s.id === id);

}



/** Default source when opening raster download UI. */

export function defaultRasterSourceId(): string {

  return RASTER_DOWNLOAD_SOURCES.find((s) => s.bulkOk)?.id ?? RASTER_DOWNLOAD_SOURCES[0]?.id ?? 'carto-light';

}



/** Expand {s} using round-robin subdomain list. */

export function resolveRasterUrl(

  template: string,

  z: number,

  x: number,

  y: number,

  subdomains?: string[],

  counter = 0

): string {

  let url = template

    .replace(/\{z\}/g, String(z))

    .replace(/\{x\}/g, String(x))

    .replace(/\{y\}/g, String(y));

  if (subdomains?.length && url.includes('{s}')) {

    url = url.replace(/\{s\}/g, subdomains[counter % subdomains.length]!);

  } else if (subdomains?.length && /^https?:\/\/a\./i.test(url)) {

    // Templates that hardcode "a." but list subdomains — rotate host letter.

    const s = subdomains[counter % subdomains.length]!;

    url = url.replace(/^(https?:\/\/)a\./i, `$1${s}.`);

  }

  return url;

}



/** Mid-zoom preview tile covering the region center (default z=10). */
export function previewTileForBbox(
  bbox: [number, number, number, number],
  zoom = 10
): { z: number; x: number; y: number } {
  const [w, s, e, n] = bbox;
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  const z = Math.max(0, Math.min(18, Math.floor(zoom)));
  return { z, x: lon2tile(lon, z), y: lat2tile(lat, z) };
}


