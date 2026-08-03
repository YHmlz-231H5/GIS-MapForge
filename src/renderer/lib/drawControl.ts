import type { MaplibreTerradrawControl } from '@watergis/maplibre-gl-terradraw';
import type { StyleSpecification } from 'maplibre-gl';
import { useAppStore } from '../store';

/** Shared draw control — registered by MapView, used by RegionPanel. */
let drawControl: MaplibreTerradrawControl | null = null;
let finishBound = false;

export type DrawToolMode = 'rectangle' | 'square' | 'polygon' | 'select';

const TD_PREFIX = 'td-';

/**
 * Carry Terra Draw sources/layers across map.setStyle().
 * Without this, getSource('td-*') is undefined → setData crash and no live preview.
 *
 * Guard: never return a style with zero layers if `next` had layers — that blanks the map.
 */
export function preserveTerradrawStyle(
  previousStyle: StyleSpecification | undefined,
  nextStyle: StyleSpecification
): StyleSpecification {
  if (!nextStyle || !Array.isArray(nextStyle.layers) || nextStyle.layers.length === 0) {
    // Prefer keeping the previous painted style over applying an empty one.
    if (previousStyle && Array.isArray(previousStyle.layers) && previousStyle.layers.length > 0) {
      return previousStyle;
    }
    return nextStyle;
  }

  const prevLayers = previousStyle?.layers ?? [];
  const nextLayers = nextStyle.layers;
  const isTd = (id: unknown) => typeof id === 'string' && id.startsWith(TD_PREFIX);

  const terraLayers = prevLayers.filter((l) => isTd(l.id));
  if (terraLayers.length === 0) return nextStyle;

  const nextWithoutTd = nextLayers.filter((l) => !isTd(l.id));
  const mergedSources: StyleSpecification['sources'] = { ...(nextStyle.sources ?? {}) };
  for (const [id, src] of Object.entries(previousStyle?.sources ?? {})) {
    if (isTd(id)) mergedSources[id] = src;
  }

  return {
    ...nextStyle,
    sources: mergedSources,
    layers: [...nextWithoutTd, ...terraLayers],
  };
}

export function registerDrawControl(ctrl: MaplibreTerradrawControl | null) {
  drawControl = ctrl;
  finishBound = false;
}

export function getDrawControl() {
  return drawControl;
}

export function isDrawFinishBound() {
  return finishBound;
}

export function markDrawFinishBound() {
  finishBound = true;
}

/** True when adapter GeoJSON sources exist (survived setStyle). */
export function drawSourcesReady(map: { getSource: (id: string) => unknown } | null | undefined): boolean {
  if (!map) return false;
  return !!(map.getSource(`${TD_PREFIX}polygon`) && map.getSource(`${TD_PREFIX}point`));
}

export function activateDrawMode(mode: DrawToolMode): { ok: boolean; reason?: string } {
  if (!drawControl) return { ok: false, reason: '地图绘制尚未就绪，请等底图加载完' };
  try {
    drawControl.activate();
    const terra = drawControl.getTerraDrawInstance();
    if (!terra) return { ok: false, reason: '绘制引擎未就绪' };
    if (!terra.enabled) terra.start();
    terra.setMode(mode);
    useAppStore.getState().setActiveDrawTool(mode);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) };
  }
}

export function idleDrawMode(): { ok: boolean; reason?: string } {
  if (!drawControl) return { ok: false, reason: '地图绘制尚未就绪' };
  try {
    const terra = drawControl.getTerraDrawInstance();
    if (!terra) return { ok: false, reason: '绘制引擎未就绪' };
    try {
      terra.setMode('default');
    } catch {
      /* */
    }
    useAppStore.getState().setActiveDrawTool(null);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) };
  }
}

export function clearAllDrawings(): { ok: boolean; reason?: string } {
  if (!drawControl) return { ok: false, reason: '地图绘制尚未就绪' };
  try {
    drawControl.activate();
    const terra = drawControl.getTerraDrawInstance();
    if (!terra) return { ok: false, reason: '绘制引擎未就绪' };
    if (!terra.enabled) terra.start();

    const ctrl = drawControl as MaplibreTerradrawControl & {
      handleDeleteAllFeatures?: () => void;
    };
    if (typeof ctrl.handleDeleteAllFeatures === 'function') {
      const prev = (drawControl as { options?: { showDeleteConfirmation?: boolean } }).options;
      if (prev) prev.showDeleteConfirmation = false;
      try {
        ctrl.handleDeleteAllFeatures();
      } catch {
        /* fall through */
      }
    }

    const snap = terra.getSnapshot?.() ?? [];
    const ids = snap.map((f: { id?: string | number }) => f.id).filter((id) => id != null);
    if (ids.length > 0) {
      try {
        terra.removeFeatures(ids as (string | number)[]);
      } catch {
        /* */
      }
    }
    try {
      terra.clear();
    } catch {
      /* */
    }
    try {
      terra.setMode('default');
    } catch {
      /* */
    }
    useAppStore.getState().setActiveDrawTool(null);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) };
  }
}
