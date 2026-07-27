/**
 * Planetiler convert options — mirrors official CLI flags that matter for
 * local OSM → PMTiles (OpenMapTiles profile).
 *
 * Sources: `java -jar planetiler.jar --help`,
 * https://github.com/onthegomap/planetiler/blob/main/config-example.properties
 * https://github.com/openmaptiles/planetiler-openmaptiles
 */

/** `standard` = Planetiler/OpenMapTiles community defaults (locked). `custom` = editable. */
export type ConvertMode = 'standard' | 'custom';

/** Output archive container (Planetiler picks format from --output extension). */
export type ArchiveFormat = 'pmtiles' | 'mbtiles';

export type TileCompression = 'none' | 'gzip';
export type TileFormat = 'mvt' | 'mlt';
export type TempStorage = 'ram' | 'mmap' | 'direct';
export type NodemapType = 'noop' | 'sortedtable' | 'sparsearray' | 'array';

/** Official OpenMapTiles vector layers (Planetiler OpenMapTiles profile). */
export const OPENMAPTILES_LAYERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'water', label: '水体面 water' },
  { id: 'waterway', label: '水系线 waterway' },
  { id: 'water_name', label: '水体名 water_name' },
  { id: 'landcover', label: '地表覆盖 landcover' },
  { id: 'landuse', label: '土地利用 landuse' },
  { id: 'park', label: '公园 park' },
  { id: 'boundary', label: '边界 boundary' },
  { id: 'aeroway', label: '机场面 aeroway' },
  { id: 'transportation', label: '道路几何 transportation' },
  { id: 'transportation_name', label: '道路名 transportation_name' },
  { id: 'building', label: '建筑 building' },
  { id: 'housenumber', label: '门牌 housenumber' },
  { id: 'place', label: '地名 place' },
  { id: 'poi', label: '兴趣点 poi' },
  { id: 'mountain_peak', label: '山峰 mountain_peak' },
  { id: 'aerodrome_label', label: '机场标签 aerodrome_label' },
];

export const ALL_LAYER_IDS = OPENMAPTILES_LAYERS.map((l) => l.id);

export function allLayersEnabled(): Record<string, boolean> {
  return Object.fromEntries(ALL_LAYER_IDS.map((id) => [id, true]));
}

/**
 * Form state for the convert dialog.
 * `mode=standard` → UI locked to official defaults; CLI omits layer filters.
 * `mode=custom` → every field is editable (e.g. maxzoom up to 16).
 * `archive_format` is always choosable (PMTiles vs MBTiles container).
 */
export interface PlanetilerConvertForm {
  mode: ConvertMode;
  /** Output container — always selectable, even in standard mode. */
  archive_format: ArchiveFormat;

  /** Checked = include layer in output (custom → exclude unchecked via --exclude-layers). */
  layers: Record<string, boolean>;

  minzoom: number;
  /** Community default 14; Planetiler allows up to 16 in custom mode. */
  maxzoom: number;
  render_maxzoom: number;
  /** west,south,east,north — display/edit as comma string in UI */
  bbox_clip: [number, number, number, number];
  java_heap: string;

  /** OpenMapTiles profile */
  building_merge_z13: boolean;
  transportation_z13_paths: boolean;
  transportation_name_brunnel: boolean;
  transportation_name_size_for_shield: boolean;
  transportation_name_limit_merge: boolean;
  transportation_name_minor_refs: boolean;
  boundary_country_names: boolean;
  boundary_osm_only: boolean;
  transliterate: boolean;
  use_wikidata: boolean;
  fetch_wikidata: boolean;
  /** Empty = Planetiler default language list */
  languages: string;

  /** Geometry / tile quality */
  simplify_tolerance: number;
  simplify_tolerance_at_max_zoom: number;
  min_feature_size: number;
  min_feature_size_at_max_zoom: number;
  skip_filled_tiles: boolean;
  exclude_ids: boolean;
  tile_compression: TileCompression;
  tile_format: TileFormat;

  /** Performance / storage */
  /** null / empty = let Planetiler use all cores */
  threads: number | null;
  storage: TempStorage;
  nodemap_type: NodemapType;
  nodemap_storage: TempStorage;
  compress_temp: boolean;
  free_osm_after_read: boolean;
  free_natural_earth_after_read: boolean;
  free_water_polygons_after_read: boolean;
  free_lake_centerlines_after_read: boolean;
  /** App-managed aux download (not a Planetiler flag; we pre-fetch then --download=false) */
  download_aux: boolean;
}

/**
 * Default edge buffer for OSM download + Planetiler clip.
 *
 * Web Mercator z14 tile ≈ 360/2^14 ≈ 0.022° wide. We pad ~1.5 tiles so every
 * tile that covers the selected region has full OSM detail — not only Natural
 * Earth landcover outside a tight extract (which looks like a LOD seam).
 *
 * Expanding Planetiler --bbox alone is NOT enough: high-zoom buildings/roads
 * come from OSM. Without buffered OSM, edge tiles stay coarse.
 */
export function mercatorTileLonSpanDeg(z: number): number {
  const zz = Math.max(0, Math.min(28, Math.floor(z)));
  return 360 / 2 ** zz;
}

/** ≈ 1.5 mercator tiles at z14 */
export const DEFAULT_BBOX_EXPAND_DEG = mercatorTileLonSpanDeg(14) * 1.5;

/** Expand [west,south,east,north] by padDeg on each side (clamped to world). */
export function expandBbox(
  bbox: [number, number, number, number],
  padDeg: number = DEFAULT_BBOX_EXPAND_DEG
): [number, number, number, number] {
  const [w, s, e, n] = bbox;
  const pad = Math.max(0, padDeg);
  return [
    Math.max(-180, w - pad),
    Math.max(-85.05112878, s - pad),
    Math.min(180, e + pad),
    Math.min(85.05112878, n + pad),
  ];
}

export function createDefaultPlanetilerForm(
  bbox: [number, number, number, number],
  overrides?: Partial<PlanetilerConvertForm>
): PlanetilerConvertForm {
  return {
    mode: 'standard',
    archive_format: 'pmtiles',
    layers: allLayersEnabled(),
    minzoom: 0,
    maxzoom: 14,
    render_maxzoom: 14,
    bbox_clip: expandBbox(bbox),
    java_heap: '6g',
    building_merge_z13: true,
    transportation_z13_paths: false,
    transportation_name_brunnel: false,
    transportation_name_size_for_shield: false,
    transportation_name_limit_merge: false,
    transportation_name_minor_refs: false,
    boundary_country_names: true,
    boundary_osm_only: false,
    transliterate: true,
    use_wikidata: true,
    fetch_wikidata: false,
    languages: '',
    simplify_tolerance: 0.1,
    simplify_tolerance_at_max_zoom: 0.0625,
    min_feature_size: 1.0,
    min_feature_size_at_max_zoom: 0.0625,
    skip_filled_tiles: false,
    exclude_ids: false,
    tile_compression: 'gzip',
    tile_format: 'mvt',
    threads: null,
    storage: 'mmap',
    nodemap_type: 'sparsearray',
    nodemap_storage: 'mmap',
    compress_temp: false,
    free_osm_after_read: false,
    free_natural_earth_after_read: false,
    free_water_polygons_after_read: false,
    free_lake_centerlines_after_read: false,
    download_aux: true,
    ...overrides,
  };
}

/** Layers to pass as --exclude-layers (only in custom mode). */
export function excludedLayerIds(form: PlanetilerConvertForm): string[] {
  if (form.mode !== 'custom') return [];
  return ALL_LAYER_IDS.filter((id) => form.layers[id] === false);
}

/** Normalize legacy `full` id saved on older tasks. */
export function normalizeConvertMode(mode: string | undefined): ConvertMode {
  if (mode === 'custom') return 'custom';
  return 'standard';
}

export function normalizeArchiveFormat(fmt: string | undefined): ArchiveFormat {
  return fmt === 'mbtiles' ? 'mbtiles' : 'pmtiles';
}

export function archiveExtension(fmt: ArchiveFormat): '.pmtiles' | '.mbtiles' {
  return fmt === 'mbtiles' ? '.mbtiles' : '.pmtiles';
}

export type BuildPlanetilerArgsInput = {
  form: PlanetilerConvertForm;
  osmPath: string;
  outputPath: string;
  downloadDir: string;
};

/**
 * Build Planetiler CLI flags (everything after `java -Xmx… -jar planetiler.jar`).
 * Layer filters only when custom and some layers unchecked (standard = omit filters).
 */
export function buildPlanetilerCliFlags(input: BuildPlanetilerArgsInput): string[] {
  const { form, osmPath, outputPath, downloadDir } = input;
  const bbox = form.bbox_clip.join(',');
  const args: string[] = [
    `--osm-path=${osmPath}`,
    `--bbox=${bbox}`,
    `--output=${outputPath}`,
    `--download_dir=${downloadDir}`,
    '--force',
    '--download=false',
    `--minzoom=${form.minzoom}`,
    `--maxzoom=${form.maxzoom}`,
    `--render_maxzoom=${form.render_maxzoom}`,
    `--building-merge-z13=${form.building_merge_z13}`,
    `--transportation-z13-paths=${form.transportation_z13_paths}`,
    `--transportation-name-brunnel=${form.transportation_name_brunnel}`,
    `--transportation-name-size-for-shield=${form.transportation_name_size_for_shield}`,
    `--transportation-name-limit-merge=${form.transportation_name_limit_merge}`,
    `--transportation-name-minor-refs=${form.transportation_name_minor_refs}`,
    `--boundary-country-names=${form.boundary_country_names}`,
    `--boundary-osm-only=${form.boundary_osm_only}`,
    `--transliterate=${form.transliterate}`,
    `--use-wikidata=${form.use_wikidata}`,
    `--fetch-wikidata=${form.fetch_wikidata}`,
    `--simplify-tolerance=${form.simplify_tolerance}`,
    `--simplify-tolerance-at-max-zoom=${form.simplify_tolerance_at_max_zoom}`,
    `--min-feature-size=${form.min_feature_size}`,
    `--min-feature-size-at-max-zoom=${form.min_feature_size_at_max_zoom}`,
    `--skip-filled-tiles=${form.skip_filled_tiles}`,
    `--exclude-ids=${form.exclude_ids}`,
    `--tile-compression=${form.tile_compression}`,
    `--tile-format=${form.tile_format}`,
    `--storage=${form.storage}`,
    `--nodemap-type=${form.nodemap_type}`,
    `--nodemap-storage=${form.nodemap_storage}`,
    `--compress-temp=${form.compress_temp}`,
    `--free-osm-after-read=${form.free_osm_after_read}`,
    `--free-natural-earth-after-read=${form.free_natural_earth_after_read}`,
    `--free-water-polygons-after-read=${form.free_water_polygons_after_read}`,
    `--free-lake-centerlines-after-read=${form.free_lake_centerlines_after_read}`,
  ];

  if (form.threads != null && form.threads > 0) {
    args.push(`--threads=${form.threads}`);
  }
  if (form.languages.trim()) {
    args.push(`--languages=${form.languages.trim()}`);
  }

  const excluded = excludedLayerIds(form);
  if (excluded.length > 0) {
    args.push(`--exclude-layers=${excluded.join(',')}`);
  }

  return args;
}
