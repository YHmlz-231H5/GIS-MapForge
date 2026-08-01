import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { MaplibreTerradrawControl } from '@watergis/maplibre-gl-terradraw';
import { Eraser } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { findBasemap, type Basemap } from '../data/basemaps';
import {
  chooseBasemapOnAppStart,
  probeAllBasemaps,
  persistHealthy,
} from '../lib/basemapHealth';
import {
  clearAllDrawings,
  getDrawControl,
  isDrawFinishBound,
  markDrawFinishBound,
  registerDrawControl,
  preserveTerradrawStyle,
} from '../lib/drawControl';
import { buildDrawModeOptions } from '../lib/drawModeOptions';
import { MapStyleSwitcher } from './MapStyleSwitcher';
import { MapZoomHud } from './MapZoomHud';
import { featureToRegion, pickDrawnPolygon } from '../lib/regionFromDraw';
import { UI_SPACE, UI_SPACE_SM } from '../lib/uiSpace';


/**
 * MapView — full-bleed MapLibre with overlays (basemap switcher, region bbox).
 */
export function MapView({
  leftPanelOpen,
  leftPanelWidth,
  rightPanelOpen,
  rightPanelWidth,
}: {
  leftPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}) {
  const { t } = useTranslation();
  const setRegion = useAppStore((s) => s.setRegion);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const navHostRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const region = useAppStore((s) => s.region);
  // Show grid while downloading; keep it after incomplete runs so amber holes stay visible.
  const downloadTiles = useAppStore((s) => {
    const withTiles = (t: (typeof s.tasks)[number]) =>
      t.kind === 'pbf-download-osm-api' &&
      Array.isArray(t.progress?.tiles) &&
      t.progress!.tiles!.length > 0;

    const running = s.tasks.find((t) => t.status === 'running' && withTiles(t));
    if (running?.progress?.tiles) return running.progress.tiles;

    const incomplete = s.tasks.find(
      (t) =>
        (t.status === 'failed' || t.status === 'killed' || t.status === 'cancelled') &&
        withTiles(t) &&
        t.progress!.tiles!.some((cell) => cell.status === 'failed' || cell.status === 'pending')
    );
    return incomplete?.progress?.tiles ?? null;
  });
  const downloadTilesSig = downloadTiles
    ? downloadTiles.map((t) => `${t.bbox.join(',')}:${t.status}`).join('|')
    : '';

  const basemapId = useAppStore((s) => s.basemapId);
  const setBasemapId = useAppStore((s) => s.setBasemapId);
  const setRanked = useAppStore((s) => s.setBasemapRanked);
  const setReady = useAppStore((s) => s.setBasemapReady);
  const ready = useAppStore((s) => s.basemapReady);

  const [bboxes, setBboxes] = useState<{ west: number; south: number; east: number; north: number } | null>(
    null,
  );
  const [webglError, setWebglError] = useState<string | null>(null);

  // Initialize MapLibre once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Probe WebGL availability before instantiating the map (MapLibre's
    // constructor throws if WebGL can't be created). We use a non-fatal probe —
    // if it fails, show a friendly fallback instead of crashing React.
    const probe = document.createElement('canvas');
    let ctx: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    let triedContext = '';
    for (const type of ['webgl2', 'webgl', 'experimental-webgl'] as const) {
      try {
        ctx = probe.getContext(type) as any;
        triedContext = type;
        if (ctx) break;
      } catch {
        /* continue */
      }
    }
    if (!ctx) {
      const msg = `WebGL not available (tried webgl2/webgl/experimental-webgl). GPU process may be unavailable in this Electron/GPU configuration.`;
      setWebglError(msg);
      console.error('[MapView] WebGL probe failed:', msg);
      return;
    }
    // Free the probe context immediately (don't leak it)
    try {
      const loseExt = ctx.getExtension('WEBGL_lose_context');
      if (loseExt) loseExt.loseContext();
    } catch {}
    console.log('[MapView] WebGL OK via', triedContext);

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Initial blank style — replaced by chosen basemap once probe resolves.
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e6ecf2' } }] },
      center: [114.05, 22.68],
      zoom: 9,
      attributionControl: false,
    });
    map.on('error', (e) => {
      const msg = e?.error?.message ?? String(e?.error ?? e);
      // MapLibre 5.7.3 known noise — see vendor/suppress-csp-warning.js
      if (typeof msg === 'string' && msg.includes('Expected value to be of type number, but found null')) {
        return;
      }
      console.warn('[MapView] map error:', msg);
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }),
      'bottom-right'
    );
    mapRef.current = map;
    setMapInstance(map);

    // Terra Draw attaches after the first basemap setStyle (see applyBasemap effect).
    // Attaching before that forces transformStyle on the first style swap and can blank the map.

    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* */
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      const prev = getDrawControl();
      if (prev) {
        try {
          map.removeControl(prev);
        } catch {
          /* */
        }
        registerDrawControl(null);
      }
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // Probe basemaps on first mount; auto-select best
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { preferredId, ranked } = await chooseBasemapOnAppStart();
      if (cancelled) return;
      setRanked(ranked);
      setBasemapId(preferredId);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [setRanked, setBasemapId, setReady]);

  // Lift native NavigationControl out of the map stacking context (z≈2) into a
  // z-30 host so it stays above side panels, and track the right panel offset.
  // Re-run after basemap style swaps — setStyle can recreate control corners.
  useEffect(() => {
    if (!mapInstance || !navHostRef.current) return;
    const lift = () => {
      const corner = mapInstance
        .getContainer()
        .querySelector('.maplibregl-ctrl-bottom-right') as HTMLElement | null;
      if (corner && corner.parentElement !== navHostRef.current) {
        navHostRef.current!.appendChild(corner);
      }
    };
    lift();
    mapInstance.on('style.load', lift);
    return () => {
      mapInstance.off('style.load', lift);
    };
  }, [mapInstance, basemapId]);

  // Apply chosen basemap when basemapId changes; attach draw after first successful style.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !basemapId) return;
    const basemap = findBasemap(basemapId);
    if (!basemap) return;
    let cancelled = false;
    (async () => {
      await applyBasemap(map, basemap);
      if (cancelled || !mapRef.current) return;
      attachTerradrawOnce(mapRef.current);
      try {
        map.resize();
      } catch {
        /* */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [basemapId, ready]);

  const regionFitKeyRef = useRef<string | null>(null);

  // Region bbox overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sourceId = 'selected-region';
    const fillId = 'selected-region-fill';
    const lineId = 'selected-region-line';
    const adminSourceId = 'admin-boundary';
    const adminFillId = 'admin-boundary-fill';
    const adminLineId = 'admin-boundary-line';

    const removeOverlay = (fill: string, line: string, source: string) => {
      try {
        if (map.getLayer(fill)) map.removeLayer(fill);
        if (map.getLayer(line)) map.removeLayer(line);
        if (map.getSource(source)) (map as any).removeSource(source);
      } catch {
        /* */
      }
    };

    // Always tear down both overlays first (clear must not leave admin green behind).
    removeOverlay(fillId, lineId, sourceId);
    removeOverlay(adminFillId, adminLineId, adminSourceId);

    if (!region) {
      setBboxes(null);
      regionFitKeyRef.current = null;
      return;
    }
    const [w, s, e, n] = region.bbox;
    setBboxes({ west: w, south: s, east: e, north: n });

    // Hand-drawn shapes are already rendered by Terra Draw (with editable nodes).
    // Skip MapLibre bbox overlay here to avoid double paint + layer thrash while dragging.
    if (region.source === 'map-draw') {
      if (regionFitKeyRef.current === null) {
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 50, duration: 800 }
        );
        regionFitKeyRef.current = 'map-draw';
      }
      return;
    }

    const polygon: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: 'Feature',
      properties: { name: region.name },
      geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    };
    map.addSource(sourceId, { type: 'geojson', data: polygon });
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: sourceId,
      paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 },
    });
    map.addLayer({
      id: lineId,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#1d4ed8', 'line-width': 2, 'line-dasharray': [3, 2] },
    });

    const fitKey = `${region.source}:${region.name}:${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}`;
    if (regionFitKeyRef.current !== fitKey) {
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 50, duration: 800 }
      );
      regionFitKeyRef.current = fitKey;
    }

    if (region.boundary_geojson) {
      map.addSource(adminSourceId, { type: 'geojson', data: region.boundary_geojson as any });
      map.addLayer({
        id: adminFillId,
        type: 'fill',
        source: adminSourceId,
        paint: { 'fill-color': '#10b981', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: adminLineId,
        type: 'line',
        source: adminSourceId,
        paint: { 'line-color': '#047857', 'line-width': 2.5 },
      });
    }
  }, [region, ready]);

  // Download tile grid: keep layers mounted; only setData when status signature changes.
  // Previous effect cleanup called removeOverlay() on every update → flicker every few seconds.
  const tilesRef = useRef(downloadTiles);
  tilesRef.current = downloadTiles;
  const lastTilesSigRef = useRef('');

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const sourceId = 'download-tiles';
    const fillId = 'download-tiles-fill';
    const lineId = 'download-tiles-line';

    const removeOverlay = () => {
      try {
        if (map.getLayer(fillId)) map.removeLayer(fillId);
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(sourceId)) (map as any).removeSource(sourceId);
      } catch { /* */ }
      lastTilesSigRef.current = '';
    };

    const paintFill = {
      'fill-color': [
        'match', ['get', 'status'],
        'done', '#16a34a',
        'failed', '#d97706',
        '#dc2626',
      ],
      'fill-opacity': 0.28,
    } as maplibregl.FillPaint;
    const paintLine = {
      'line-color': [
        'match', ['get', 'status'],
        'done', '#15803d',
        'failed', '#b45309',
        '#b91c1c',
      ],
      'line-width': 1.5,
    } as maplibregl.LinePaint;

    const toFc = (tiles: NonNullable<typeof downloadTiles>): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: tiles.map((t, i) => {
        const [w, s, e, n] = t.bbox;
        return {
          type: 'Feature',
          properties: { status: t.status, i },
          geometry: {
            type: 'Polygon',
            coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
          },
        };
      }),
    });

    const apply = (forceAdd: boolean) => {
      if (!map.isStyleLoaded()) return;
      const tiles = tilesRef.current;
      if (!tiles || tiles.length === 0) {
        removeOverlay();
        return;
      }
      const sig = tiles.map((t) => `${t.bbox.join(',')}:${t.status}`).join('|');
      const fc = toFc(tiles);
      try {
        const existing = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
        if (existing && !forceAdd) {
          if (sig === lastTilesSigRef.current) return;
          existing.setData(fc);
          lastTilesSigRef.current = sig;
          return;
        }
        if (existing && forceAdd) {
          // Style reload wiped layers but source may linger inconsistently — rebuild.
          removeOverlay();
        }
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, { type: 'geojson', data: fc });
        } else {
          (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(fc);
        }
        if (!map.getLayer(fillId)) {
          map.addLayer({ id: fillId, type: 'fill', source: sourceId, paint: paintFill });
        }
        if (!map.getLayer(lineId)) {
          map.addLayer({ id: lineId, type: 'line', source: sourceId, paint: paintLine });
        }
        lastTilesSigRef.current = sig;
      } catch (e) {
        console.warn('[MapView] tile overlay apply failed:', e);
      }
    };

    apply(false);
    const onStyleLoad = () => apply(true);
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
      removeOverlay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive updates via sig effect below
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const removeOverlay = () => {
      try {
        if (map.getLayer('download-tiles-fill')) map.removeLayer('download-tiles-fill');
        if (map.getLayer('download-tiles-line')) map.removeLayer('download-tiles-line');
        if (map.getSource('download-tiles')) (map as any).removeSource('download-tiles');
      } catch {
        /* */
      }
      lastTilesSigRef.current = '';
    };

    if (!downloadTilesSig || !downloadTiles?.length) {
      removeOverlay();
      return;
    }

    const paintFill = {
      'fill-color': [
        'match',
        ['get', 'status'],
        'done',
        '#16a34a',
        'failed',
        '#d97706',
        '#dc2626',
      ],
      'fill-opacity': 0.28,
    } as maplibregl.FillPaint;
    const paintLine = {
      'line-color': [
        'match',
        ['get', 'status'],
        'done',
        '#15803d',
        'failed',
        '#b45309',
        '#b91c1c',
      ],
      'line-width': 1.5,
    } as maplibregl.LinePaint;

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: downloadTiles.map((t, i) => {
        const [w, s, e, n] = t.bbox;
        return {
          type: 'Feature',
          properties: { status: t.status, i },
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
      }),
    };

    const apply = () => {
      if (!map.isStyleLoaded()) return false;
      try {
        const existing = map.getSource('download-tiles') as maplibregl.GeoJSONSource | undefined;
        if (existing) {
          if (downloadTilesSig === lastTilesSigRef.current) return true;
          existing.setData(fc);
          lastTilesSigRef.current = downloadTilesSig;
          return true;
        }
        map.addSource('download-tiles', { type: 'geojson', data: fc });
        map.addLayer({
          id: 'download-tiles-fill',
          type: 'fill',
          source: 'download-tiles',
          paint: paintFill,
        });
        map.addLayer({
          id: 'download-tiles-line',
          type: 'line',
          source: 'download-tiles',
          paint: paintLine,
        });
        lastTilesSigRef.current = downloadTilesSig;
        return true;
      } catch (e) {
        console.warn('[MapView] tile overlay apply failed:', e);
        return false;
      }
    };

    if (apply()) return;

    // Tasks often load before the basemap style finishes — retry once style is ready.
    const onStyleLoad = () => {
      apply();
    };
    map.on('style.load', onStyleLoad);
    map.once('idle', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
      map.off('idle', onStyleLoad);
    };
  }, [downloadTilesSig, downloadTiles, ready]);

  const leftOffset = leftPanelOpen ? leftPanelWidth + UI_SPACE : UI_SPACE;
  // Tab is vertically centered — when panel closed, only need edge gutter.
  // Nav host positions the corner; MapLibre ctrl margin is zeroed after reparent.
  const navRightPad = (rightPanelOpen ? rightPanelWidth : 0) + UI_SPACE;
  // Shift the scale corner by panel width only; 10px inset comes from ctrl margin.
  const scaleLeftShift = leftPanelOpen ? leftPanelWidth : 0;

  return (
    <div className="map-view-root relative w-full h-full bg-[#e6ecf2]">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Scoped to .map-view-root — never leak into preview / style-studio maps. */}
      <style>{`
        .map-view-root .maplibregl-ctrl-top-right .maplibregl-ctrl-group:has(.maplibregl-terradraw-add-rectangle-button),
        .map-view-root .maplibregl-ctrl-top-right .maplibregl-ctrl-group:has(.maplibregl-terradraw-add-polygon-button) {
          display: none !important;
        }
        .map-view-root .maplibregl-ctrl-bottom-left {
          left: ${scaleLeftShift}px !important;
          margin: 0 !important;
          transition: left 280ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        /* After reparent into nav host, drop map-absolute positioning + margins */
        .map-nav-host .maplibregl-ctrl-bottom-right {
          position: static !important;
          margin: 0 !important;
          pointer-events: auto;
        }
        .map-nav-host .maplibregl-ctrl {
          margin: 0 !important;
        }
        .map-nav-host .map-clear-draw-group {
          border-radius: 4px;
          overflow: hidden;
        }
        .map-nav-host .map-clear-draw-btn {
          width: 29px;
          height: 29px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 0;
          border-radius: 4px;
          background: #fff;
          cursor: pointer;
          color: #334155;
        }
        .map-nav-host .map-clear-draw-btn:hover {
          background: #f1f5f9;
          color: #be123c;
        }
      `}</style>

      <MapStyleSwitcher leftOffset={leftOffset} />
      <MapZoomHud
        map={mapInstance}
        className="top-2"
        style={{ right: navRightPad, transition: 'right 280ms cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
      <div
        ref={navHostRef}
        className="map-nav-host absolute z-30 pointer-events-none flex flex-col items-end"
        style={{
          right: navRightPad,
          bottom: UI_SPACE,
          gap: UI_SPACE_SM,
          transition: 'right 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="maplibregl-ctrl maplibregl-ctrl-group map-clear-draw-group pointer-events-auto shadow">
          <button
            type="button"
            className="map-clear-draw-btn"
            title={t('region.drawClear')}
            aria-label={t('region.drawClear')}
            onClick={() => {
              const r = clearAllDrawings();
              setRegion(null);
              if (!r.ok) window.alert(r.reason);
            }}
          >
            <Eraser className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto z-20">
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-5 max-w-md shadow text-sm space-y-2">
            <div className="font-semibold text-amber-900 flex items-center gap-2">
              ⚠ 地图无法加载 — WebGL 不可用
            </div>
            <div className="text-amber-800 text-xs">
              你的 GPU/Electron 配置无法创建 WebGL context。所有其他功能
              （区域搜索、layer 选择、任务调度）仍然可用, 只是地图预览不可见。
            </div>
            <div className="text-amber-700 text-xs font-mono bg-amber-100 p-2 rounded">
              {webglError}
            </div>
            <div className="text-amber-800 text-xs">
              建议: 升级显卡驱动, 或者用 <code className="bg-amber-100 px-1 rounded">npm run dev</code> 重启试试。
            </div>
          </div>
        </div>
      )}

      {!webglError && !ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="bg-white/90 backdrop-blur rounded-lg px-4 py-3 text-sm text-slate-700 shadow flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            </svg>
            正在测速地图源...
          </div>
        </div>
      )}

      {bboxes && region && (
        <div
          className="absolute bg-white/95 backdrop-blur rounded-lg shadow px-3 py-2 text-xs space-y-1 pointer-events-none"
          style={{
            left: leftPanelOpen ? leftPanelWidth + UI_SPACE : UI_SPACE,
            bottom: 48,
            transition: 'left 280ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div>
            <span className="text-slate-500">中心</span>{' '}
            <span className="font-mono">
              {((bboxes.west + bboxes.east) / 2).toFixed(4)},
              {((bboxes.south + bboxes.north) / 2).toFixed(4)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">面积</span> {region.area_km2.toFixed(1)} km²
          </div>
          {downloadTiles && downloadTiles.length > 0 && (
            <div className="flex items-center gap-2 pt-0.5 border-t border-slate-100 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-rose-600" />待下
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-emerald-600" />完成
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-amber-600" />失败
              </span>
              <span className="text-slate-500">
                {downloadTiles.filter((t) => t.status === 'done').length}/{downloadTiles.length}
                {downloadTiles.some((t) => t.status === 'failed')
                  ? ` · 失败 ${downloadTiles.filter((t) => t.status === 'failed').length}`
                  : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Attach Terra Draw once. Do NOT remove/re-add on every style.load. */
function attachTerradrawOnce(map: maplibregl.Map) {
  if (getDrawControl()) return;
  const draw = new MaplibreTerradrawControl({
    // Native chrome is CSS-hidden; RegionPanel drives modes.
    modes: ['polygon', 'rectangle', 'square', 'select', 'delete-selection', 'delete'] as any,
    open: true,
    modeOptions: buildDrawModeOptions() as any,
  });
  map.addControl(draw, 'top-right');
  registerDrawControl(draw);

  const kick = () => {
    try {
      const terra = draw.getTerraDrawInstance();
      if (terra && !terra.enabled) terra.start();
    } catch (e) {
      console.warn('[MapView] terradraw start failed:', e);
    }
  };
  kick();
  setTimeout(kick, 0);

  const syncRegionFromDraw = () => {
    const poly = pickDrawnPolygon(draw.getFeatures() as { features?: GeoJSON.Feature[] });
    if (!poly) return;
    useAppStore.getState().setRegion(featureToRegion(poly));
  };

  const bindFinish = () => {
    const terra = draw.getTerraDrawInstance();
    if (!terra || isDrawFinishBound()) return;
    markDrawFinishBound();

    terra.on('finish', (id: string | number) => {
      syncRegionFromDraw();

      try {
        terra.setMode('select');
        if (id != null && typeof (terra as { selectFeature?: (x: string | number) => void }).selectFeature === 'function') {
          (terra as { selectFeature: (x: string | number) => void }).selectFeature(id);
        }
      } catch {
        /* */
      }
    });

    terra.on('change', () => {
      try {
        const mode = String((terra as { getMode?: () => string }).getMode?.() ?? '');
        if (mode !== 'select') return;
        syncRegionFromDraw();
      } catch {
        /* */
      }
    });
  };
  bindFinish();
  setTimeout(bindFinish, 0);
  setTimeout(bindFinish, 200);
}

async function applyBasemap(map: maplibregl.Map, b: Basemap) {
  // Inject user's MapTiler API key into vector styleUrl if applicable.
  if (b.group === 'vector' && b.id.startsWith('maptiler-')) {
    const cfg = await window.api.getConfig();
    if (cfg.ok && cfg.data) {
      const key = (cfg.data as Record<string, unknown>).maptiler_key as string | undefined;
      if (key) {
        b = { ...b, styleUrl: `${b.styleUrl}?key=${encodeURIComponent(key)}` };
      }
    }
  }
  try {
    let style: StyleSpecification;
    if (b.group === 'raster') {
      style = {
        version: 8,
        sources: {
          'basemap-raster': {
            type: 'raster',
            tiles: [b.urlTemplate],
            tileSize: b.tileSize,
            maxzoom: b.maxzoom,
            attribution: b.attribution,
          },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap-raster' },
        ],
      };
    } else {
      // Vector: fetch the style.json as JSON and apply directly
      // (avoids CORS issues + handles pmtiles:// sources automatically).
      const res = await fetch(b.styleUrl);
      if (!res.ok) throw new Error(`fetch ${b.styleUrl}: HTTP ${res.status}`);
      style = (await res.json()) as StyleSpecification;
      if (!style.sources) style.sources = {};
      if (!Array.isArray(style.layers) || style.layers.length === 0) {
        throw new Error(`style ${b.id} has no layers`);
      }
    }

    // Only merge td-* when draw layers already exist — avoids blank-map edge cases
    // when transformStyle receives an incomplete `next` during the first switch.
    const prev = map.getStyle();
    const hasTd = !!prev?.layers?.some((l) => typeof l.id === 'string' && l.id.startsWith('td-'));

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        map.off('style.load', done);
        resolve();
      };
      map.once('style.load', done);
      if (hasTd) {
        map.setStyle(style, {
          transformStyle: (p, n) =>
            preserveTerradrawStyle(p as StyleSpecification | undefined, n as StyleSpecification),
        });
      } else {
        map.setStyle(style);
      }
      // If style.load already fired (sync), don't hang.
      if (map.isStyleLoaded()) done();
      else setTimeout(done, 3000);
    });
  } catch (err) {
    console.error('[MapView] applyBasemap failed for', b.id, err);
  }
}
