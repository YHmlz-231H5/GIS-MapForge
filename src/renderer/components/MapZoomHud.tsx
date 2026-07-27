/**
 * Live map zoom readout — two decimal places, top-right by default.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';

export function MapZoomHud({
  map,
  className = '',
  style,
}: {
  map: MaplibreMap | null;
  /** Extra positioning / theme classes (parent should be position:relative). */
  className?: string;
  style?: CSSProperties;
}) {
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    if (!map) return;
    const sync = () => setZoom(map.getZoom());
    sync();
    map.on('zoom', sync);
    map.on('zoomend', sync);
    map.on('move', sync);
    return () => {
      map.off('zoom', sync);
      map.off('zoomend', sync);
      map.off('move', sync);
    };
  }, [map]);

  if (!map) return null;

  return (
    <div
      className={`pointer-events-none absolute top-2 right-2 z-40 rounded border border-slate-300/90 bg-white/90 px-2 py-1 font-mono text-[11px] tabular-nums text-slate-800 shadow-sm backdrop-blur-sm ${className}`}
      style={style}
      title="当前地图层级"
      aria-live="polite"
    >
      Z {zoom.toFixed(2)}
    </div>
  );
}
