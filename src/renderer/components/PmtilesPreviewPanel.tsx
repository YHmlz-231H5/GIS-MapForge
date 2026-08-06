/**
 * PmtilesPreviewPanel — preview local .pmtiles with bundled OpenMapTiles styles
 * (style/blue-tech.json, desert-camo.json, white-positron.json) or a simple diagnostic style.
 */
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol, PMTiles } from 'pmtiles';
import {
  PREVIEW_STYLE_OPTIONS,
  adaptBundledStyleForPmtiles,
  sourceLayersUsedByStyle,
  localDiagnosticGlyphs,
  type PreviewStyleId,
} from '../lib/previewStyles';
import { ElectronFileSource, ensurePmtilesProtocol, keyForPmtilesPath } from '../lib/pmtilesLocal';
import { MapZoomHud } from './MapZoomHud';

type HeaderInfo = {
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  tileType: number;
  centerLon: number;
  centerLat: number;
  centerZoom: number;
};

type LayerDiag = {
  id: string;
  inArchive: boolean;
  inPreviewStyle: boolean;
  note?: string;
};

const EXPECTED_OMT_LAYERS: Array<{ id: string; note: string }> = [
  { id: 'water', note: '水体面' },
  { id: 'waterway', note: '水系线' },
  { id: 'water_name', note: '水体标签' },
  { id: 'landcover', note: '地表覆盖' },
  { id: 'landuse', note: '土地利用' },
  { id: 'park', note: '公园' },
  { id: 'boundary', note: '行政区界' },
  { id: 'transportation', note: '道路几何' },
  { id: 'transportation_name', note: '道路标签（路名）' },
  { id: 'building', note: '建筑' },
  { id: 'place', note: '地名' },
  { id: 'poi', note: '兴趣点' },
  { id: 'housenumber', note: '门牌号' },
  { id: 'mountain_peak', note: '山峰' },
  { id: 'aeroway', note: '机场面' },
  { id: 'aerodrome_label', note: '机场标签' },
];

const DIAGNOSTIC_STYLE_LAYERS = new Set([
  'landcover',
  'landuse',
  'park',
  'water',
  'waterway',
  'water_name',
  'building',
  'transportation',
  'transportation_name',
  'boundary',
  'place',
]);

let protocolSingleton: Protocol | null = null;

function ensureProtocol(): Protocol {
  protocolSingleton = ensurePmtilesProtocol();
  return protocolSingleton;
}

/**
 * Local PMTiles Source for Electron — range-read via IPC.
 * Must return an exact ArrayBuffer slice (classic Node/Electron .buffer pitfall).
 */
// ElectronFileSource imported from pmtilesLocal

function buildDiagnosticStyle(sourceKey: string): StyleSpecification {
  const sourceUrl = `pmtiles://${sourceKey}`;
  return {
    version: 8,
    name: 'PMTiles Preview (diagnostic)',
    glyphs: localDiagnosticGlyphs(),
    sources: {
      om: {
        type: 'vector',
        url: sourceUrl,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
      {
        id: 'landcover',
        type: 'fill',
        source: 'om',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#c8e6c0', 'fill-opacity': 0.55 },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'om',
        'source-layer': 'landuse',
        paint: { 'fill-color': '#e8e0d0', 'fill-opacity': 0.4 },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'om',
        'source-layer': 'park',
        paint: { 'fill-color': '#b8d9a0', 'fill-opacity': 0.5 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'om',
        'source-layer': 'water',
        paint: { 'fill-color': '#a0c8f0' },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'om',
        'source-layer': 'waterway',
        paint: { 'line-color': '#7eb6e0', 'line-width': 1 },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'om',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': '#d4cbc2', 'fill-opacity': 0.7, 'fill-outline-color': '#c0b6ab' },
      },
      {
        id: 'transportation-casing',
        type: 'line',
        source: 'om',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 6],
          'line-opacity': 0.8,
        },
      },
      {
        id: 'transportation',
        type: 'line',
        source: 'om',
        'source-layer': 'transportation',
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway',
            '#e89201',
            'trunk',
            '#e2a014',
            'primary',
            '#e2b432',
            'secondary',
            '#e2c163',
            '#888',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.2, 18, 7],
        },
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'om',
        'source-layer': 'boundary',
        paint: { 'line-color': '#9a8a7a', 'line-width': 1, 'line-dasharray': [2, 2] },
      },
      {
        id: 'transportation_name',
        type: 'symbol',
        source: 'om',
        'source-layer': 'transportation_name',
        minzoom: 12,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name'], ['get', 'ref'], ''],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
          'text-max-angle': 30,
        },
        paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
      },
      {
        id: 'water_name',
        type: 'symbol',
        source: 'om',
        'source-layer': 'water_name',
        layout: {
          'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name'], ''],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: { 'text-color': '#4a7aaa', 'text-halo-color': '#fff', 'text-halo-width': 1 },
      },
      {
        id: 'place',
        type: 'symbol',
        source: 'om',
        'source-layer': 'place',
        layout: {
          'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name'], ''],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['match', ['get', 'class'], 'city', 16, 'town', 13, 'village', 11, 10],
        },
        paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
      },
    ],
  };
}

function buildRasterPmtilesStyle(sourceKey: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      raster: {
        type: 'raster',
        url: `pmtiles://${sourceKey}`,
        tileSize: 256,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e8eef2' } },
      { id: 'raster', type: 'raster', source: 'raster' },
    ],
  };
}

function isRasterTileType(t: number): boolean {
  return t === 2 || t === 3 || t === 4 || t === 5;
}

function resolveStyle(styleId: PreviewStyleId, sourceKey: string): StyleSpecification {
  if (styleId === 'diagnostic') return buildDiagnosticStyle(sourceKey);
  return adaptBundledStyleForPmtiles(styleId, sourceKey);
}

function tileTypeLabel(t: number): string {
  return (
    {
      0: 'Unknown',
      1: 'MVT (矢量)',
      2: 'PNG',
      3: 'JPEG',
      4: 'WebP',
      5: 'AVIF',
    }[t] ?? String(t)
  );
}

function bboxPolygon(bbox: [number, number, number, number]): GeoJSON.Feature<GeoJSON.Polygon> {
  const [w, s, e, n] = bbox;
  return {
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
  };
}

const BBOX_SOURCE = 'download-bbox';
const BBOX_FILL = 'download-bbox-fill';
const BBOX_LINE = 'download-bbox-line';

/** Draw (or refresh) the PBF-download range rectangle above the basemap style. */
function applyDownloadBboxOverlay(
  map: maplibregl.Map,
  bbox: [number, number, number, number] | null
) {
  try {
    if (map.getLayer(BBOX_FILL)) map.removeLayer(BBOX_FILL);
    if (map.getLayer(BBOX_LINE)) map.removeLayer(BBOX_LINE);
    if (map.getSource(BBOX_SOURCE)) map.removeSource(BBOX_SOURCE);
  } catch {
    /* style may be mid-swap */
  }
  if (!bbox) return;
  const [w, s, e, n] = bbox;
  if (![w, s, e, n].every(Number.isFinite) || w >= e || s >= n) return;

  map.addSource(BBOX_SOURCE, { type: 'geojson', data: bboxPolygon(bbox) });
  map.addLayer({
    id: BBOX_FILL,
    type: 'fill',
    source: BBOX_SOURCE,
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 },
  });
  map.addLayer({
    id: BBOX_LINE,
    type: 'line',
    source: BBOX_SOURCE,
    paint: {
      'line-color': '#f59e0b',
      'line-width': 2.5,
      'line-dasharray': [2.5, 1.5],
    },
  });
}

function keyForPath(p: string): string {
  return keyForPmtilesPath(p);
}

function buildLayerDiag(archiveLayers: string[], styleLayers: Set<string>): LayerDiag[] {
  const set = new Set(archiveLayers);
  const rows = EXPECTED_OMT_LAYERS.map(({ id, note }) => ({
    id,
    note,
    inArchive: set.has(id),
    inPreviewStyle: styleLayers.has(id),
  }));
  for (const id of archiveLayers) {
    if (!EXPECTED_OMT_LAYERS.some((x) => x.id === id)) {
      rows.push({
        id,
        note: '档案额外图层',
        inArchive: true,
        inPreviewStyle: styleLayers.has(id),
      });
    }
  }
  return rows;
}

export function PmtilesPreviewPanel({
  filePath,
  downloadBbox,
  onClose,
}: {
  filePath: string | null;
  /** User selection bbox [west,south,east,north] — drawn as overlay (not download-expanded). */
  downloadBbox?: [number, number, number, number] | null;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const headerRef = useRef<HeaderInfo | null>(null);
  const sourceKeyRef = useRef<string>('');
  const archiveLayersRef = useRef<string[]>([]);
  const downloadBboxRef = useRef<[number, number, number, number] | null>(downloadBbox ?? null);
  downloadBboxRef.current = downloadBbox ?? null;

  const styleIdRef = useRef<PreviewStyleId>('blue-tech');
  /** Style id currently on the map (avoids duplicate setStyle after Map() ctor). */
  const appliedStyleRef = useRef<PreviewStyleId | null>(null);
  const applyingStyleRef = useRef(false);
  const pendingStyleRef = useRef<PreviewStyleId | null>(null);

  const [status, setStatus] = useState('加载中…');
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<HeaderInfo | null>(null);
  const [layerDiag, setLayerDiag] = useState<LayerDiag[]>([]);
  const [showDiag, setShowDiag] = useState(true);
  const [styleId, setStyleId] = useState<PreviewStyleId>('blue-tech');

  const fitToHeader = (map: maplibregl.Map) => {
    const box = downloadBboxRef.current;
    if (box) {
      const [w, s, e, n] = box;
      try {
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 48, maxZoom: 14, duration: 0 }
        );
        return;
      } catch {
        /* fall through to archive header */
      }
    }
    const h = headerRef.current;
    if (!h) return;
    try {
      map.fitBounds(
        [
          [h.minLon, h.minLat],
          [h.maxLon, h.maxLat],
        ],
        { padding: 40, maxZoom: Math.min(h.maxZoom, 14), duration: 0 }
      );
    } catch {
      /* ignore */
    }
  };

  const paintBboxOverlay = (map: maplibregl.Map) => {
    // Prefer explicit download bbox; else archive header bounds (Planetiler clip).
    const fromTask = downloadBboxRef.current;
    if (fromTask) {
      applyDownloadBboxOverlay(map, fromTask);
      return;
    }
    const h = headerRef.current;
    if (h && h.minLon < h.maxLon && h.minLat < h.maxLat) {
      applyDownloadBboxOverlay(map, [h.minLon, h.minLat, h.maxLon, h.maxLat]);
    }
  };

  const applyStyleToMap = (nextId: PreviewStyleId) => {
    const map = mapRef.current;
    const sourceKey = sourceKeyRef.current;
    if (!map || !sourceKey) return;

    if (applyingStyleRef.current) {
      pendingStyleRef.current = nextId;
      return;
    }

    const run = () => {
      const live = mapRef.current;
      if (!live || !sourceKeyRef.current) return;
      applyingStyleRef.current = true;
      appliedStyleRef.current = nextId;
      const style = resolveStyle(nextId, sourceKeyRef.current);
      setLayerDiag(
        buildLayerDiag(
          archiveLayersRef.current,
          nextId === 'diagnostic' ? DIAGNOSTIC_STYLE_LAYERS : sourceLayersUsedByStyle(style)
        )
      );
      setStatus('切换样式中…');
      // Full replace — never diff while a previous style is mid-load (avoids MapLibre warn).
      live.setStyle(style, { diff: false });
      live.once('idle', () => {
        paintBboxOverlay(live);
        fitToHeader(live);
        applyingStyleRef.current = false;
        setStatus(`样式：${PREVIEW_STYLE_OPTIONS.find((o) => o.id === nextId)?.label ?? nextId}`);
        const pending = pendingStyleRef.current;
        if (pending && pending !== nextId) {
          pendingStyleRef.current = null;
          applyStyleToMap(pending);
        } else {
          pendingStyleRef.current = null;
        }
      });
    };

    if (!map.isStyleLoaded()) {
      map.once('idle', run);
    } else {
      run();
    }
  };

  // Load archive + create map when filePath changes
  useEffect(() => {
    if (!filePath || !containerRef.current) return;

    let cancelled = false;
    setError(null);
    setStatus('读取 PMTiles 头信息…');
    setHeader(null);
    setLayerDiag([]);
    applyingStyleRef.current = false;
    pendingStyleRef.current = null;
    appliedStyleRef.current = null;

    const sourceKey = keyForPath(filePath);
    sourceKeyRef.current = sourceKey;
    const protocol = ensureProtocol();
    const pm = new PMTiles(new ElectronFileSource(filePath, sourceKey));
    protocol.add(pm);

    (async () => {
      try {
        const h = await pm.getHeader();
        if (cancelled) return;
        const raster = isRasterTileType(h.tileType);
        if (h.tileType !== 1 && !raster) {
          setError(`此档案 tileType=${h.tileType}（${tileTypeLabel(h.tileType)}）暂不支持预览。`);
        }

        let archiveLayers: string[] = [];
        if (!raster) {
          try {
            const meta = (await pm.getMetadata()) as { vector_layers?: Array<{ id: string }> };
            archiveLayers = (meta.vector_layers ?? []).map((l) => l.id).filter(Boolean);
          } catch (e) {
            console.warn('[PmtilesPreview] metadata read failed:', e);
          }
        }
        archiveLayersRef.current = archiveLayers;

        const info: HeaderInfo = {
          minZoom: h.minZoom,
          maxZoom: h.maxZoom,
          minLon: h.minLon,
          minLat: h.minLat,
          maxLon: h.maxLon,
          maxLat: h.maxLat,
          tileType: h.tileType,
          centerLon: h.centerLon,
          centerLat: h.centerLat,
          centerZoom: h.centerZoom,
        };
        headerRef.current = info;
        setHeader(info);
        setStatus('地图渲染中…');

        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }

        const initialStyleId = styleIdRef.current;
        const style = raster
          ? buildRasterPmtilesStyle(sourceKey)
          : resolveStyle(initialStyleId, sourceKey);
        appliedStyleRef.current = raster ? ('raster' as PreviewStyleId) : initialStyleId;
        setLayerDiag(
          raster
            ? []
            : buildLayerDiag(
                archiveLayers,
                initialStyleId === 'diagnostic'
                  ? DIAGNOSTIC_STYLE_LAYERS
                  : sourceLayersUsedByStyle(style)
              )
        );

        const map = new maplibregl.Map({
          container: containerRef.current!,
          style,
          center: [
            info.centerLon || (info.minLon + info.maxLon) / 2,
            info.centerLat || (info.minLat + info.maxLat) / 2,
          ],
          zoom: info.centerZoom || Math.max(info.minZoom, 10),
          // Avoid double AttributionControl (default + explicit → two !! chips).
          attributionControl: false,
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }),
          'bottom-right'
        );
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left');
        mapRef.current = map;
        setMapInstance(map);

        map.on('load', () => {
          if (cancelled) return;
          paintBboxOverlay(map);
          fitToHeader(map);
          setStatus(
            raster
              ? `栅格预览就绪 · ${tileTypeLabel(info.tileType)}`
              : `预览就绪 · ${PREVIEW_STYLE_OPTIONS.find((o) => o.id === initialStyleId)?.label ?? initialStyleId}`
          );
          // If user changed dropdown while map was constructing, apply once idle.
          if (!raster) {
            const wanted = styleIdRef.current;
            if (wanted !== appliedStyleRef.current) {
              applyStyleToMap(wanted);
            }
          }
        });
        map.on('error', (e) => {
          console.warn('[PmtilesPreview]', e.error);
        });
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setStatus('加载失败');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapInstance(null);
    };
  }, [filePath]);

  // User switched style dropdown (skip if Map() already constructed with this id)
  useEffect(() => {
    styleIdRef.current = styleId;
    if (!mapRef.current || !sourceKeyRef.current) return;
    if (headerRef.current && isRasterTileType(headerRef.current.tileType)) return;
    if (appliedStyleRef.current === styleId) return;
    applyStyleToMap(styleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleId]);

  if (!filePath) return null;

  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  const hasRoadNames = layerDiag.find((l) => l.id === 'transportation_name');
  const verdict =
    hasRoadNames?.inArchive === true
      ? '档案里已有 transportation_name。路名走本地 fonts；缺字时先 npm run fetch:map-assets。'
      : hasRoadNames?.inArchive === false
        ? '档案里没有 transportation_name — 转换阶段可能未写入路名层。'
        : null;

  return (
    <div
      className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-6xl h-[min(90vh,860px)] rounded-lg shadow-xl flex flex-col overflow-visible"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="pmtiles-preview-title"
      >
        <div className="relative z-20 px-4 py-3 border-b flex items-start justify-between gap-3 shrink-0 rounded-t-lg bg-white">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 id="pmtiles-preview-title" className="text-base font-semibold">
                PMTiles 预览
              </h2>
              <span className="relative inline-flex group/preview-help">
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500 hover:border-sky-400 hover:text-sky-700 hover:bg-sky-50"
                  aria-label="预览注意事项"
                >
                  ?
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 hidden w-[320px] rounded-md border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-700 shadow-lg group-hover/preview-help:block"
                >
                  <div className="font-medium text-slate-900 mb-1">字体与「割裂」经验</div>
                  <ul className="list-disc pl-3.5 space-y-1 text-slate-600">
                    <li>瓦片与字体/图标均可本地：先执行 <code className="bg-slate-100 px-0.5 rounded">npm run fetch:map-assets</code> 拉齐 OpenFreeMap 全量 BMP 字库（256 range × 3 字体）。</li>
                    <li>
                      旧本地包只有约 94 个 range；缺文件时若返回 HTML，MapLibre 会报{' '}
                      <code className="bg-slate-100 px-0.5 rounded">Unimplemented type: 4</code>
                      ，并实测连带出现相邻瓦片「层级割裂」。
                    </li>
                    <li>开发态已禁止 glyph 404 回落成 HTML；完整字库后可与 CDN 行为一致且可离线。</li>
                  </ul>
                </span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5" title={filePath}>
              {fileName}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <label className="text-xs text-slate-600 flex items-center gap-1">
              样式
              <select
                className="border rounded px-1.5 py-1 text-xs"
                value={styleId}
                onChange={(e) => setStyleId(e.target.value as PreviewStyleId)}
              >
                {PREVIEW_STYLE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="text-xs px-2 py-1 border rounded hover:bg-slate-50"
              onClick={() => setShowDiag((v) => !v)}
            >
              {showDiag ? '隐藏诊断' : '显示诊断'}
            </button>
            <button
              type="button"
              className="text-slate-500 hover:text-slate-800 px-2"
              onClick={onClose}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b bg-slate-50 text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1 shrink-0">
          <span>{status}</span>
          <span className="text-slate-400">瓦片=本地 PMTiles · 字体/图标=vendor/map-assets</span>
          {header && (
            <>
              <span>
                zoom {header.minZoom}–{header.maxZoom}
              </span>
              <span>{tileTypeLabel(header.tileType)}</span>
            </>
          )}
          {(downloadBbox ||
            (header && header.minLon < header.maxLon && header.minLat < header.maxLat)) && (
            <span className="text-amber-700" title="橙色框 = 用户选区范围（非外扩下载框）">
              选区范围{' '}
              {(
                downloadBbox ??
                ([header!.minLon, header!.minLat, header!.maxLon, header!.maxLat] as [
                  number,
                  number,
                  number,
                  number,
                ])
              )
                .map((v) => v.toFixed(4))
                .join(', ')}
            </span>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 bg-rose-50 text-rose-700 text-xs border-b border-rose-100 shrink-0">
            {error}
          </div>
        )}

        <div className="relative flex-1 min-h-0 flex overflow-hidden rounded-b-lg">
          <div className="relative flex-1 min-w-0 bg-slate-200">
            <div ref={containerRef} className="absolute inset-0" />
            <MapZoomHud map={mapInstance} />
          </div>

          {showDiag && (
            <aside className="w-72 shrink-0 border-l bg-white overflow-y-auto thin-scroll text-[11px]">
              <div className="p-3 space-y-3">
                <div>
                  <div className="font-medium text-slate-800 mb-1">怎么判断？</div>
                  <ul className="list-disc pl-4 text-slate-600 space-y-1 leading-snug">
                    <li>
                      <span className="text-emerald-700">档案✓</span> = 数据在 PMTiles 里
                    </li>
                    <li>
                      <span className="text-sky-700">样式✓</span> = 当前样式会画
                    </li>
                    <li>style JSON：瓦片=本地 pmtiles · 字体/图标=本地 vendor（需完整字库）</li>
                  </ul>
                </div>

                {verdict && (
                  <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-900 leading-snug">
                    {verdict}
                  </div>
                )}

                <div>
                  <div className="font-medium text-slate-800 mb-1.5">图层清单</div>
                  <div className="space-y-1">
                    {layerDiag.length === 0 && (
                      <div className="text-slate-400">读取 metadata.vector_layers…</div>
                    )}
                    {layerDiag.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-start justify-between gap-2 border-b border-slate-100 py-1"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-slate-800 truncate">{row.id}</div>
                          {row.note && <div className="text-slate-400">{row.note}</div>}
                        </div>
                        <div className="shrink-0 text-right leading-tight">
                          <div className={row.inArchive ? 'text-emerald-600' : 'text-rose-500'}>
                            档案{row.inArchive ? '✓' : '✗'}
                          </div>
                          <div className={row.inPreviewStyle ? 'text-sky-600' : 'text-slate-300'}>
                            样式{row.inPreviewStyle ? '✓' : '—'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

