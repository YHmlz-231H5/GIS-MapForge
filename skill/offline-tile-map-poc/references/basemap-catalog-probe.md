# Online Basemap Catalog for Embedded Map Apps (NEW 2026-07-18)

When wrapping a map renderer in any UI (Electron, browser, mobile), the
default surface has to answer two questions:

1. **What sources are reachable from the user's network?** (international
   vs China vs Russia vs air-gapped corp networks)
2. **Vector or raster?** (vector requires API key or self-host; raster usually
   doesn't, but quality is worse)

This reference encodes the **2026-07-18 validated catalog** of 13 sources,
the **connectivity-probe logic** that auto-selects the best one, and the
**floating UI switcher pattern** for letting users override.

## Why this exists

Without a fallback policy, your app silently degrades:
- One user sees a blank map (their CDN is blocked)
- Another user sees the wrong region labels (their tiles are in Chinese, they
  want English)
- You don't know until someone screenshots the failure

The probe-first approach avoids this by **actually testing each source
at startup, caching the result, then choosing the fastest healthy one**.

## The catalog (validated July 2026)

Each entry was tested from mainland China; timings are approximate.

### Vector (MapLibre style.json)

| Source | URL | Free? | In CN? | Best for |
|---|---|---|---|---|
| **OpenFreeMap Liberty** | `https://tiles.openfreemap.org/styles/liberty` | yes, no key | yes (cloudflare CDN) | default — best free vector |
| OpenFreeMap Bright | `https://tiles.openfreemap.org/styles/bright` | yes, no key | yes | alternative free vector |
| MapTiler Streets | `https://api.maptiler.com/maps/streets/style.json` | no, requires key | blocked in CN | pro label rendering (needs user key) |
| MapTiler Outdoor | `https://api.maptiler.com/maps/outdoor/style.json` | no, requires key | blocked in CN | terrain/outdoor themed |

`OpenFreeMap` is the de-facto free vector answer for 2026-07; it's the new
community-maintained successor to the defunct `tiles.openstreetmap.org/mapbox/{style}.json`
(now returns 410 Gone).

### Raster (xyz:// tile URL)

| Source | URL Template | In CN? | Notes |
|---|---|---|---|
| **OpenStreetMap** | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | blocked (slow) | classic; tile.openstreetmap.org has heavy rate limits |
| **ESRI World Imagery** | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | yes (Tengine server) | satellite; **YX order, not XY** |
| ESRI World Street Map | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}` | yes | street; same YX quirk |
| **Google Satellite** | `https://mt1.google.com/vt/lyrs=s&hl=en&gl=US&x={x}&y={y}&z={z}` | blocked in CN | reverse-engineering endpoint, no key needed; rotate `mt1.` → `mt2.`, `mt3.` for diversity |
| Google Streets | `https://mt1.google.com/vt/lyrs=m&hl=en&gl=US&x={x}&y={y}&z={z}` | blocked in CN | road overlay |
| **高德卫星图** | `https://webst02.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}` | yes (autonavi Tengine) | satellite |
| **高德街道** | `https://webrd02.is.autonavi.com/appmaptile?style=7&x={x}&y={y}&z={z}` | yes | street |
| **腾讯卫星图** | `https://p2.map.gtimg.com/sateTiles/{z}/{x}/{y}.jpg` | yes | satellite |

### Tile loaders that BLOCK (do not include)

- `https://maps.googleapis.com/maps/vt/`  (needs API key)
- `https://stamen.com/...`  (moved to stadiamaps.com, rate-limited)
- `https://api.mapbox.com/...`  (needs access token)
- `https://d.tiles.mapbox.com/...`  (Mapbox v1 deprecated; v2 needs token)

## The `regions` field

Each catalog entry has `regions: NetworkMode[]` where `NetworkMode = 'cn' | 'intl' | 'any'`.
UI filters entries by region: a CN user sees only `any` + `cn` entries; an intl user
sees all three. **Don't trust** the regional hint alone — it's a search-narrow hint,
not a hard filter — because users cross networks all the time (VPN, home/private).

## Probe logic (the canonical pattern)

```ts
async function probeOne(b: Basemap, timeoutMs = 5000): Promise<ProbeResult> {
  const start = Date.now();
  try {
    let url: string;
    if (b.group === 'raster') {
      // Tile z=0, x=0, y=0 — center of the world tile, fastest universal probe.
      url = b.urlTemplate
        .replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
    } else {
      url = b.styleUrl;     // vector: probe the style.json
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

export async function probeAllBasemaps(): Promise<ProbeResult[]> {
  const results = await Promise.all(ALL_BASEMAPS.map((b) => probeOne(b)));
  return results.sort((a, b) => {
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    if (!a.ok && !b.ok) return 0;
    return a.latency - b.latency;
  });
}
```

**Why HEAD, not GET**: HEAD bypasses tile bodies (PNG/zlib), saving bandwidth and making the probe 10–100× faster. Servers that don't support HEAD fall back to GET automatically—you still get *some* signal.

**Why 5 s per source**: any longer feels like the app is hung. 5 s × 13 sources in parallel = ~5 s total, fits the user-tolerable "loading…" window.

**Persist the result in localStorage** (`mapdownloader.basemap.healthy`) so the second launch is instant. Wipe when user clicks "reset probe".

## The pick algorithm

```ts
export function pickPreferred(ranked: ProbeResult[], region: NetworkMode): string {
  // 1) user storage override, if still healthy
  const saved = localStorage.getItem('mapdownloader.basemap.preferred');
  if (saved && ranked.find(p => p.id === saved && p.ok)) return saved;

  // 2) region-preferred (with 'any' fallback)
  const regionPref = ALL_BASEMAPS
    .filter(b => b.regions.includes(region) || b.regions.includes('any'))
    .find(b => ranked.find(r => r.id === b.id && r.ok));
  if (regionPref) return regionPref.id;

  // 3) first healthy, period
  return ranked.find(r => r.ok)?.id ?? 'openfreemap-liberty'; // hard fallback
}
```

The hard-coded fallback (`'openfreemap-liberty'`) is the universal "always
load something" escape hatch. If even that fails, your MapLibre Map will
render empty with no JS error — user sees the bounded "select a region" UI.

## UI switcher pattern

A button in the upper-right of the map (compass-adjacent) toggles a panel showing:

```
▲ 🗺 OpenFreeMap Liberty                          ▾
─────────────────────────────────────────────────
| 🌐 国外 | 🇨🇳 国内 |
─────────────────────────────────────────────────
| 🛣 Vector (4)  | 🛰 卫星图 (9) |
─────────────────────────────────────────────────
✅ OpenFreeMap Liberty                🟢 187ms
🟡 OpenFreeMap Bright              🟢 211ms
   MapTiler Streets (no key)            🔴 -1   → blocked
   ESRI World Imagery                  🟢 152ms
   ESRI World Street Map               🟢 180ms
   Google Satellite (intl)             🔴 -1   → CN blocked
   Google Streets (intl)               🔴 -1   → CN blocked
🟢 高德卫星图                          🟢 134ms
🟢 高德街道                            🟢 165ms
   Tencent Satellite (CN)               🔴 -1   → blocked
─────────────────────────────────────────────────
5/9 可用                                            [重新测速]
```

The status dot colors are calibrated:
- 🟢 🟩 (green, < 200 ms) — snappy
- 🟡 🟨 (yellow, 200–1000 ms) — ok but slow
- 🟠 🟧 (orange, 1–3 s) — tolerable
- 🔴 🟥 (red, -1 — timeout/error) — blocked in this region
- ⚪ (gray, untested) — fresh entry, not yet probed

## Implementation gotchas

### 1. MapLibre setStyle with raster-only sources

When switching between basemaps via `map.setStyle(...)`, MapLibre keeps the
old vector layers (creating z-fighting). For basemap switches, do a **full
rebuild** every time:

```ts
map.setStyle({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { ... } }] });
// then asynchronously fetch + apply
const style = await fetch(b.styleUrl).then(r => r.json());
map.setStyle(style);
```

Or just emit the whole style spec each time — it's small for our 13-entry catalog.

### 2. ESRI tiles use YX order

`https://server.arcgisonline.com/.../tile/{z}/{y}/{x}` is **YX** (y first), not XY.
Most other providers use XYZ. MapLibre's `raster` source layer supports a custom
template, so just put `{y}` before `{x}` and the tiles load. Mark this with
`yxOrder: true` on the catalog entry so the UI can show a small "(YX)" badge.

### 3. google.com subdomain rotation

`https://mt1.google.com/...` has 4 subdomains (`mt0`, `mt1`, `mt2`, `mt3`); rotating
across them sidesteps per-host rate limits and improves concurrency. MapLibre
supports an array:

```ts
tiles: ['https://mt{a-c}.google.com/vt/lyrs=s&...&x={x}&y={y}&z={z}']
```

Template placeholders `{a-c}` are MapLibre's subdomain rotation pattern. **Many
providers don't document this** but it's a MapLibre feature you get for free.

### 4. localStorage is a security sandbox in some Electron configs

`window.localStorage` works in browser windows but the Electron main process
has its own `app.getPath('userData')` for persistence. **Don't** try to use
localStorage from the main process — it doesn't exist there.

If you want to share basemap preference between multiple Electron windows,
use `app.getPath('userData') + '/basemap.json'` from the main process via IPC.

### 5. Vector sources that return string `name` are valid MapLibre styles

MapLibre style.json files like `https://tiles.openfreemap.org/styles/liberty`
return a valid `StyleSpecification` object. Just `fetch + .json()` and pass
straight to `map.setStyle(spec)`. Don't try to manually map sources/layers —
you'll miss sprite metadata and glyph PBF URLs.

## What to do if most/all sources fail

If every probe times out (e.g. user is air-gapped), fall back to a hard-coded
minimal style:

```ts
function fallbackStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dde7ed' } }],
  };
}
```

The map renders a flat tinted background. The user sees their bbox overlay
still — useful enough to convey "you selected this region", even though they
need to drop the PMTiles file in manually for actual basemap rendering.

## Captured location in this skill

Full validated implementation lives in the `app-map-downloader/` project at
`src/renderer/data/basemaps.ts` (catalog) +
`src/renderer/lib/basemapHealth.ts` (probe + pick + persist) +
`src/renderer/components/MapStyleSwitcher.tsx` (UI). **Copy those 3 files**
verbatim into any new Electron-map or browser-map project.
