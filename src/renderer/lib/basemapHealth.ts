/**
 * basemapHealth.ts — connectivity probe + healthy-mode selection.
 *
 * For each basemap, fetch a single low-zoom tile with 5 s timeout.
 * First source to respond 2xx wins; record ranked availability list.
 *
 * Persisted to localStorage so user-facing default basemap doesn't
 * flicker on every launch.
 */

import { ALL_BASEMAPS, DEFAULT_BASEMAP_ID, type Basemap, findBasemap } from '../data/basemaps';

const STORAGE_KEY = 'mapdownloader.basemap.preferred';
const STORAGE_HEALTHY = 'mapdownloader.basemap.healthy';

export interface ProbeResult {
  id: string;
  ok: boolean;
  /** ms - or -1 if timed out / errored */
  latency: number;
}

async function probeOne(b: Basemap, timeoutMs = 5000): Promise<ProbeResult> {
  const start = Date.now();
  try {
    let url: string;
    if (b.group === 'raster') {
      // z=0, x=0, y=0 — center of the world tile
      const z = 0, x = 0, y = 0;
      url = b.urlTemplate
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
    } else {
      // vector: HEAD the style.json (not GET — we just need reachability)
      url = b.styleUrl;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      return { id: b.id, ok: res.ok, latency: Date.now() - start };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { id: b.id, ok: false, latency: -1 };
  }
}

export function sortProbeResults(results: ProbeResult[]): ProbeResult[] {
  return [...results].sort((a, b) => {
    // ok first, then fastest
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    if (!a.ok && !b.ok) return 0;
    return a.latency - b.latency;
  });
}

/** Probe all basemaps in parallel; return ranked by latency. */
export async function probeAllBasemaps(): Promise<ProbeResult[]> {
  const results = await Promise.all(ALL_BASEMAPS.map((b) => probeOne(b)));
  return sortProbeResults(results);
}

/** Probe one basemap by id; returns failed status when id is unknown. */
export async function probeBasemapById(id: string): Promise<ProbeResult> {
  const basemap = findBasemap(id);
  if (!basemap) return { id, ok: false, latency: -1 };
  return probeOne(basemap);
}

/** Replace or append one probe result, then re-rank. */
export function upsertProbeResult(ranked: ProbeResult[], next: ProbeResult): ProbeResult[] {
  const map = new Map(ranked.map((r) => [r.id, r]));
  map.set(next.id, next);
  return sortProbeResults(Array.from(map.values()));
}

/** Pick the best healthy basemap, preferring user's saved choice, then vector, then satellite. */
export function pickPreferred(ranked: ProbeResult[]): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const r = ranked.find((p) => p.id === saved && p.ok);
      if (r) return saved;
    }
  } catch {}

  const firstHealthyVector = ALL_BASEMAPS.find(
    (b) => b.group === 'vector' && ranked.find((r) => r.id === b.id && r.ok),
  );
  if (firstHealthyVector) return firstHealthyVector.id;

  const firstHealthyRaster = ALL_BASEMAPS.find(
    (b) => b.group === 'raster' && ranked.find((r) => r.id === b.id && r.ok),
  );
  if (firstHealthyRaster) return firstHealthyRaster.id;

  const firstOk = ranked.find((r) => r.ok);
  return firstOk ? firstOk.id : DEFAULT_BASEMAP_ID;
}

export function persistPreferred(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

export function loadCachedHealthy(): ProbeResult[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_HEALTHY);
    if (!raw) return null;
    return JSON.parse(raw) as ProbeResult[];
  } catch {
    return null;
  }
}

export function persistHealthy(rank: ProbeResult[]) {
  try {
    localStorage.setItem(STORAGE_HEALTHY, JSON.stringify(rank));
  } catch {}
}

export async function chooseBasemapOnAppStart(): Promise<{
  preferredId: string;
  ranked: ProbeResult[];
}> {
  const cached = loadCachedHealthy();
  if (cached && cached.length > 0) {
    const id = pickPreferred(cached);
    return { preferredId: id, ranked: cached };
  }
  const ranked = await probeAllBasemaps();
  persistHealthy(ranked);
  const id = pickPreferred(ranked);
  return { preferredId: id, ranked };
}
