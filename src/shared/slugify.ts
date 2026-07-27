/**
 * Safe basename for downloads / PMTiles from a region display name.
 * Keeps CJK; strips path-illegal chars. Never returns empty.
 */

const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;

export function slugifyRegionName(
  name: string,
  opts?: {
    bbox?: [number, number, number, number];
    fallbackId?: string;
  }
): string {
  let s = (name || '').trim();
  s = s.replace(ILLEGAL, ' ').replace(/\s+/g, '-');
  // Letters/digits (any script via \p{L}\p{N}), CJK blocks, _ -
  s = s.replace(/[^\p{L}\p{N}_\-]+/gu, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (!s) {
    if (opts?.bbox && opts.bbox.every(Number.isFinite)) {
      const [w, south, e, n] = opts.bbox;
      s = `map-${fmt(w)}_${fmt(south)}_${fmt(e)}_${fmt(n)}`;
    } else if (opts?.fallbackId) {
      s = `map-${opts.fallbackId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'region'}`;
    } else {
      s = `map-${Date.now().toString(36)}`;
    }
  }

  return s.slice(0, 80);
}

function fmt(n: number): string {
  return n.toFixed(4).replace(/\.?0+$/, '');
}
