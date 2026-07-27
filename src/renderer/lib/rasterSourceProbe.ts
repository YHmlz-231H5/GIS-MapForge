/**
 * Live probe for raster download sources — GET one mid-zoom tile, validate bytes.
 * Prefer this over HEAD (many CDNs lie / block HEAD differently).
 */
import {
  resolveRasterUrl,
  previewTileForBbox,
  type RasterTileSource,
} from '../../shared/raster-sources';
import { validateRasterTileBytes } from '../../shared/raster-tile-validate';

export type RasterProbeStatus = 'idle' | 'loading' | 'ok' | 'fail';

export interface RasterProbeResult {
  id: string;
  status: RasterProbeStatus;
  latencyMs: number;
  previewUrl?: string;
  error?: string;
}

const PREVIEW_ZOOM = 10;

export async function probeRasterSource(
  source: RasterTileSource,
  bbox: [number, number, number, number],
  timeoutMs = 8000
): Promise<RasterProbeResult> {
  const start = Date.now();
  const { z, x, y } = previewTileForBbox(bbox, PREVIEW_ZOOM);
  const url = resolveRasterUrl(source.urlTemplate, z, x, y, source.subdomains, 0);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        Accept: 'image/*,*/*',
      },
    });
    if (!res.ok) {
      return {
        id: source.id,
        status: 'fail',
        latencyMs: Date.now() - start,
        error: `HTTP ${res.status}`,
      };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const check = validateRasterTileBytes(buf);
    if (!check.ok) {
      return {
        id: source.id,
        status: 'fail',
        latencyMs: Date.now() - start,
        error: check.reason,
      };
    }
    const blob = new Blob([buf], {
      type: source.format === 'jpeg' ? 'image/jpeg' : `image/${source.format}`,
    });
    return {
      id: source.id,
      status: 'ok',
      latencyMs: Date.now() - start,
      previewUrl: URL.createObjectURL(blob),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: source.id,
      status: 'fail',
      latencyMs: Date.now() - start,
      error: /abort/i.test(msg) ? 'timeout' : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe all sources; revoke previous object URLs when replacing. */
export async function probeAllRasterSources(
  sources: RasterTileSource[],
  bbox: [number, number, number, number],
  onEach?: (r: RasterProbeResult) => void,
  previous?: Record<string, RasterProbeResult>
): Promise<Record<string, RasterProbeResult>> {
  if (previous) {
    for (const r of Object.values(previous)) {
      if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
    }
  }
  const out: Record<string, RasterProbeResult> = {};
  await Promise.all(
    sources.map(async (s) => {
      const r = await probeRasterSource(s, bbox);
      out[s.id] = r;
      onEach?.(r);
    })
  );
  return out;
}

