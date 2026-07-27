# Multi-pmtiles Region Switcher — Pattern Notes

Captured during the 2026-07-17 session where the user asked: "在 html 中加入切换实现多个 pmtiles 加载和区域的定位效果" (add switching to load multiple pmtiles files and land on the correct region when switching).

## The pattern that works

**Region manifest → `map.setStyle(newStyle, {diff:false})` → `map.once('styledata')` → `flyTo`.**

```js
const REGIONS = {
    firenze:   { pmtiles: './firenze.pmtiles',   view: { center:[11.25, 43.77], zoom:13 }, minZoom:10, maxZoom:16 },
    australia: { pmtiles: './australia.pmtiles', view: { center:[133,  -27],   zoom:3  }, minZoom:0,  maxZoom:6  }
};

function buildStyle(key) {
    const r = REGIONS[key];
    const sourceId = `src-${key}`;
    return {
        version: 8,
        sources: { [sourceId]: { type: 'vector', url: `pmtiles://${r.pmtiles}`, attribution: '...' } },
        layers: STYLE_LAYERS[key](sourceId)
    };
}

function switchRegion(key) {
    if (isSwitching) return;
    isSwitching = true;
    document.querySelectorAll('[data-region]').forEach(b => b.classList.toggle('active', b.dataset.region === key));
    map.setStyle(buildStyle(key), { diff: false });
    map.once('styledata', () => {
        const r = REGIONS[key];
        map.setMinZoom(r.minZoom);
        map.setMaxZoom(r.maxZoom);
        map.flyTo({ ...r.view, duration: 1500 });
        isSwitching = false;
    });
}
```

## Why NOT these alternatives

### ❌ Multiple sources in one style + `setLayoutProperty('visibility')` toggle

Each region's PMTiles has a different `source-layer` schema (firenze: `water/buildings/roads/pois`; Australia: `places/roads`). You can't toggle visibility on a layer that doesn't exist in the current source. Adding both sources always would double the per-frame cost and clutter the style.

### ❌ `removeSource` then `addSource` on the existing map

Leaves dangling layer references; triggers MapLibre internal warnings in the console. Works in practice but is messy.

### ❌ `map.setStyle({...currentStyle, sources:{...newSource, ...currentStyle.sources}})` (diff merge)

With `diff: true` (default), MapLibre tries to keep the camera and existing layers. This is fine for cosmetic style changes (toggle a layer's color), but unreliable for source replacement because layer-level paint properties that reference the old source get orphaned.

**`diff: false` (full rebuild) is the right call** when swapping sources. The cost — a brief flash of the new style's defaults — is hidden by the subsequent `flyTo`.

## The camera-reset trap

By default, `setStyle()` **resets the camera** to whatever the new style specifies (often center=[0,0], zoom=0 if you didn't set them). Calling `flyTo` immediately after `setStyle` will fly *from the reset position*, producing a jarring "zoom out from anywhere → fly across world → land on region" animation.

**Fix**: hook `styledata` (fires after the new style is parsed AND the camera has been reset), then call `flyTo`. The `styledata` event fires once per style change, so use `.once()` not `.on()`.

```js
map.once('styledata', () => {     // ← once, not on
    map.flyTo({ center: r.view.center, zoom: r.view.zoom, duration: 1500 });
});
```

Alternative: pass `center`/`zoom` in the constructor AND re-set them right after `setStyle`:
```js
map.setStyle(newStyle, { diff: false });
map.jumpTo({ center: r.view.center, zoom: r.view.zoom });   // instant (no animation)
map.once('styledata', () => map.flyTo({ ...r.view, duration: 1500 }));
```
This pattern keeps the visible reset invisible if you set jumpTo synchronously before `styledata` fires.

## `setMinZoom` / `setMaxZoom`

Don't put `minZoom`/`maxZoom` in the constructor and expect them to survive `setStyle` — they do, but if the new region's range is different (e.g. firenze minZoom=10, australia minZoom=0), re-apply them after `styledata`:

```js
map.once('styledata', () => {
    map.setMinZoom(r.minZoom);
    map.setMaxZoom(r.maxZoom);
    map.flyTo({ ...r.view, duration: 1500 });
});
```

**Order matters when the new region's minZoom exceeds the old region's maxZoom** (NEW 2026-07-17, corrected same day). Example: switching from Australia (min=0, max=6) back to Firenze (min=10, max=16). If you call `setMinZoom(10)` first while the current maxZoom is still 6, MapLibre throws:

```
Error: minZoom must be between -2 and the current maxZoom, inclusive
```

And the symmetric direction (Firenze → Australia, calling `setMaxZoom(6)` first when current minZoom=10) throws `"maxZoom must be greater than the current minZoom"`. This crashes inside the `styledata` handler, leaving the status stuck at "Switching to…" and the map frozen on the old region's center.

**The fix must consider BOTH directions** — compute a `safeMax` from the **current** minZoom state, not just the target region:

```js
map.once('styledata', () => {
    const currentMin = map.getMinZoom();
    // Safe maxZoom must be ≥ r.maxZoom AND ≥ currentMin+1 so setMinZoom won't throw.
    const safeMax = Math.max(r.maxZoom, currentMin + 1, 24); // 24 = MapLibre hard max
    try {
        map.setMaxZoom(safeMax);
        map.setMinZoom(r.minZoom);
        map.setMaxZoom(r.maxZoom);
    } catch (e) {
        console.warn('[switch] zoom bounds error (non-fatal):', e.message);
    }
    map.flyTo({ ...r.view, duration: 1500 });
});
```

**Pitfall that bit during this session**: the obvious guard `Math.max(r.maxZoom, r.minZoom)` is wrong because it only considers the *target* region, not the *current* state. When the previous region had minZoom=10 and the new region has maxZoom=6, `Math.max(6, 0) = 6`, which is still < current minZoom=10, so the first `setMaxZoom(6)` call throws. The correct guard compares against `map.getMinZoom()` at switch time.

## Buttons that survive the style rebuild

The region picker is plain DOM (not part of the MapLibre style), so buttons don't get cleared when `setStyle` fires. Only add the `.active` class swap before calling `setStyle` for instant UI feedback.

## Verification recipe (Chrome MCP)

After clicking the Australia button, evaluate:

```js
const m = window.__map;
return {
    source_names: Object.keys(m.getStyle().sources),                          // ['src-australia']
    layer_ids: m.getStyle().layers.map(l => l.id),                            // ['src-australia-bg','src-australia-roads',...]
    center: [m.getCenter().lng.toFixed(2), m.getCenter().lat.toFixed(2)],     // ~[133.00, -27.00]
    zoom: m.getZoom(),                                                         // ~3
    pmtiles_loaded: typeof pmtiles !== 'undefined',
    is_style_loaded: m.isStyleLoaded()
};
```

Then check the Network panel: the new `australia.pmtiles` URL should appear with 206 responses, and the old `firenze.pmtiles` should stop being requested (MapLibre cancels in-flight requests when sources are replaced).

## Network request cancellation

When you swap sources via `setStyle`, MapLibre calls `removeSource` internally which triggers `RequestManager.removeResource` for in-flight tile requests. The Network panel will show those cancelled requests with `net::ERR_ABORTED` — that's expected, NOT an error. Don't conflate it with a real tile decode failure.

## Template

Full working template: `templates/index-multi-region.html` — Firenze + Australia, both styles inlined, working flyTo on click.