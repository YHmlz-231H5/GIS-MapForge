/**
 * Preview local raster XYZ directory or MBTiles with MapLibre.
 */
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { toExactArrayBuffer } from '../lib/pmtilesLocal';
import { applySelectionOverlay } from '../lib/selectionOverlay';
import { MapZoomHud } from './MapZoomHud';

export type RasterPreviewTarget = {
  /** Absolute z/x/y directory */
  tileDir?: string | null;
  /** Absolute .mbtiles path */
  mbtilesPath?: string | null;
  format?: 'png' | 'jpeg' | 'jpg' | 'webp';
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
  /** User selection bbox (not download-expanded). */
  bbox?: [number, number, number, number] | null;
  /** Prefer drawing this polygon (boundary / draw / import) over bbox. */
  selectionGeojson?: unknown | null;
};

const PROTOCOL = 'localraster';
let protocolReady = false;

function ensureLocalRasterProtocol() {
  if (protocolReady) return;
  maplibregl.addProtocol(PROTOCOL, async (req) => {
    const raw = req.url.replace(new RegExp(`^${PROTOCOL}://`), '');
    const parts = raw.split('/');
    const kind = parts[0];
    if (kind === 'mbtiles') {
      const enc = parts[1] ?? '';
      const z = Number(parts[2]);
      const x = Number(parts[3]);
      const y = Number(parts[4]);
      const filePath = decodeURIComponent(enc);
      const r = await window.api.readMbtilesTile(filePath, z, x, y);
      if (!r.ok || !r.data) throw new Error(r.error ?? 'mbtiles tile missing');
      return { data: toExactArrayBuffer(r.data) };
    }
    if (kind === 'dir') {
      const enc = parts[1] ?? '';
      const z = parts[2];
      const x = parts[3];
      const rest = parts.slice(4).join('/');
      const tileDir = decodeURIComponent(enc);
      const r = await window.api.readRasterTileFile(tileDir, Number(z), Number(x), rest);
      if (!r.ok || !r.data) throw new Error(r.error ?? 'tile missing');
      return { data: toExactArrayBuffer(r.data) };
    }
    throw new Error(`Unknown localraster kind: ${kind}`);
  });
  protocolReady = true;
}

function buildStyle(target: RasterPreviewTarget): StyleSpecification {
  const fmt = target.format === 'jpeg' || target.format === 'jpg' ? 'jpg' : target.format ?? 'png';
  const minzoom = target.minZoom ?? 0;
  const maxzoom = target.maxZoom ?? 20;
  const attribution = target.attribution ?? '';

  let tiles: string[];
  if (target.mbtilesPath) {
    const enc = encodeURIComponent(target.mbtilesPath);
    tiles = [`${PROTOCOL}://mbtiles/${enc}/{z}/{x}/{y}`];
  } else if (target.tileDir) {
    const enc = encodeURIComponent(target.tileDir);
    tiles = [`${PROTOCOL}://dir/${enc}/{z}/{x}/{y}.${fmt}`];
  } else {
    tiles = [];
  }

  return {
    version: 8,
    sources: {
      raster: {
        type: 'raster',
        tiles,
        tileSize: 256,
        minzoom,
        maxzoom,
        attribution,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe7ee' } },
      { id: 'raster', type: 'raster', source: 'raster' },
    ],
  };
}

export function RasterPreviewPanel({
  target,
  onClose,
}: {
  target: RasterPreviewTarget | null;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target || !containerRef.current) return;
    if (!target.tileDir && !target.mbtilesPath) {
      setError('没有可预览的栅格路径');
      return;
    }

    let cancelled = false;
    setError(null);
    ensureLocalRasterProtocol();

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      setMapInstance(null);
    }

    const style = buildStyle(target);
    const [w, s, e, n] = target.bbox ?? [-180, -85, 180, 85];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [(w + e) / 2, (s + n) / 2],
      zoom: Math.min(target.maxZoom ?? 12, 12),
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
      applySelectionOverlay(map, {
        bbox: target.bbox ?? null,
        geojson: target.selectionGeojson ?? null,
      });
      try {
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 48, maxZoom: Math.min(target.maxZoom ?? 14, 14), duration: 0 }
        );
      } catch {
        /* ignore */
      }
    });
    map.on('error', (ev) => {
      console.warn('[RasterPreview]', ev.error);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapInstance(null);
    };
  }, [target]);

  if (!target) return null;

  const title = target.mbtilesPath
    ? target.mbtilesPath.replace(/\\/g, '/').split('/').pop()
    : target.tileDir?.replace(/\\/g, '/').split('/').pop() ?? '栅格预览';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-5xl h-[min(88vh,780px)] rounded-lg shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="栅格预览"
      >
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">栅格预览</h2>
            <p className="text-[11px] text-slate-500 truncate">{title}</p>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800 px-2" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && (
          <div className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">{error}</div>
        )}
        <div className="relative flex-1 min-h-0 bg-slate-200">
          <div ref={containerRef} className="absolute inset-0" />
          <MapZoomHud map={mapInstance} />
        </div>
      </div>
    </div>
  );
}
