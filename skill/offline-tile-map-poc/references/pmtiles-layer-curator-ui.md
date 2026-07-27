# PMTiles Layer Curator — UI Form Implementation

When a desktop or web app needs to expose the 6-question layer curation
(see `references/pmtiles-layer-curator.md`) as a user-facing form, follow this
verified pattern. Tested in `app-map-downloader` (W2, 2026-07-18).

## Why a UI form instead of `clarify()`

For a CLI/agent-flow project, `clarify()` round-trips work fine. For a desktop app
(Electron / Tauri / native), asking 6 questions one by one feels clunky. A drawer
or sheet with 6 sections + appropriate controls is faster, repeatable, and lets
the user see what the defaults are.

## Form schema (6 sections)

```
Q1 Purpose      → radio buttons: overview | city | street | route    default: city
Q2 Base         → 8 checkboxes: bg, landcover, landuse, park, water, waterway, water_name, boundary
Q3 Roads       → radio: roads+labels | roads-only | none            default: roads+labels
Q4 Buildings   → radio: off | z13+ only | all                       default: off
Q5 Places      → radio: cities+towns | cities only | all
                 + POI checkbox                                     default: cities+towns, poi=off
Q6 Other       → 4 checkboxes: mountain_peak, aerodrome_label, boundary_state, aeroway_polygons
```

Bonus controls below Q6 (still inside the same form):
- `zoom max` (default 14)
- `bbox clip` (default = region bbox)
- Planetiler heap size (default 6g)
- language list (default `["zh", "en", "default"]`)

## React (or any component-based framework) pattern

```tsx
// LayerCurationDrawer.tsx — verified working shape
function LayerCurationDrawer() {
  const open = useAppStore((s) => s.layerDrawerOpen);
  const openLayerDrawer = useAppStore((s) => s.openLayerDrawer);
  const setRegion = useAppStore((s) => s.setRegion);
  const region = useAppStore((s) => s.region);

  const [layers, setLayers] = useState<LayerSet>(DEFAULT_LAYERSET);
  const [zoomMax, setZoomMax] = useState(14);
  const [bboxClip, setBboxClip] = useState<string>(
    `${region?.bbox[0] ?? ''},${region?.bbox[1] ?? ''},${region?.bbox[2] ?? ''},${region?.bbox[3] ?? ''}`
  );
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const applyPurpose = (purpose: LayerSet['purpose']) => {
    setLayers(defaultsForPurpose(purpose));
  };

  const submit = async () => {
    if (!region) return;
    setBusy(true);
    try {
      const r = await window.api.submitTask({
        kind: 'pbf-download-osm-api',
        region,
        options: { pbf_source: 'osm-api' },
      });
      if (r.ok) {
        const r2 = await window.api.submitTask({
          kind: 'planetiler-convert',
          region,
          options: {
            layers,
            planetiler: {
              zoom_max: zoomMax,
              bbox_clip: bboxClip.split(',').map(Number) as [number, number, number, number],
              java_heap: '6g',
              download_aux: true,
            },
          },
        });
        // refresh tasks list
        const list = await window.api.listTasks();
        if (list.ok && list.data) useAppStore.setState({ tasks: list.data });
        if (r2.ok) {
          openLayerDrawer(false);
        } else {
          alert(`Planetiler submit failed: ${r2.error}`);
        }
      } else {
        alert(`PBF submit failed: ${r.error}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-t-lg shadow-xl">
        <div className="p-5 border-b flex justify-between items-center sticky top-0 bg-white">
          <h2 className="text-lg font-semibold">Layer Curation · 6 问 (Phase 8a)</h2>
          <button className="text-slate-500" onClick={() => openLayerDrawer(false)}>✕</button>
        </div>
        <div className="p-5 space-y-5 text-sm">
          {/* Q1 */}
          <section>
            <h3 className="font-medium text-base mb-2">Q1 · 用途</h3>
            <div className="flex gap-2 flex-wrap">
              {(['overview','city','street','route'] as const).map((p) => (
                <label key={p} className="flex items-center gap-1 px-3 py-1.5 border rounded cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="purpose"
                    checked={layers.purpose === p}
                    onChange={() => applyPurpose(p)} />
                  <span>{p}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Q2 base */}
          <section>
            <h3 className="font-medium text-base mb-2">Q2 · 底图层</h3>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(layers.base) as Array<keyof LayerSet['base']>).map((k) => (
                <label key={k} className="flex items-center gap-1 px-2 py-1 border rounded text-xs hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox"
                    checked={layers.base[k]}
                    onChange={(e) => setLayers({ ...layers, base: { ...layers.base, [k]: e.target.checked } })} />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Q3 roads */}
          <section>
            <h3 className="font-medium text-base mb-2">Q3 · 道路</h3>
            <div className="flex gap-2">
              {(['roads+labels','roads-only','none'] as const).map((r) => (
                <label key={r} className="flex items-center gap-1 px-3 py-1.5 border rounded cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="roads"
                    checked={layers.roads === r}
                    onChange={() => setLayers({ ...layers, roads: r })} />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Q4 buildings */}
          <section>
            <h3 className="font-medium text-base mb-2">Q4 · 建筑</h3>
            <div className="flex gap-2">
              {(['off','z13+ only','all'] as const).map((b) => (
                <label key={b} className="flex items-center gap-1 px-3 py-1.5 border rounded cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="buildings"
                    checked={layers.buildings === b}
                    onChange={() => setLayers({ ...layers, buildings: b })} />
                  <span>{b}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Q5 places + POI */}
          <section>
            <h3 className="font-medium text-base mb-2">Q5 · 地点标签 + POI</h3>
            <div className="flex gap-2 items-center">
              {(['cities+towns','cities only','all'] as const).map((p) => (
                <label key={p} className="flex items-center gap-1 px-3 py-1.5 border rounded cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="places"
                    checked={layers.places === p}
                    onChange={() => setLayers({ ...layers, places: p })} />
                  <span>{p}</span>
                </label>
              ))}
              <label className="flex items-center gap-1 ml-4">
                <input type="checkbox"
                  checked={layers.poi}
                  onChange={(e) => setLayers({ ...layers, poi: e.target.checked })} />
                <span className="text-slate-700">POI</span>
              </label>
            </div>
          </section>

          {/* Q6 other */}
          <section>
            <h3 className="font-medium text-base mb-2">Q6 · 其它</h3>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(layers.other) as Array<keyof LayerSet['other']>).map((k) => (
                <label key={k} className="flex items-center gap-1 px-2 py-1 border rounded text-xs hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox"
                    checked={layers.other[k]}
                    onChange={(e) => setLayers({ ...layers, other: { ...layers.other, [k]: e.target.checked } })} />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Planetiler params */}
          <section className="bg-slate-50 -mx-5 px-5 py-4 border-y">
            <h3 className="font-medium text-base mb-2">Planetiler 参数</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2">
                <span className="text-slate-500 w-24">zoom max</span>
                <input type="number" min="0" max="22"
                  className="flex-1 px-2 py-1 border rounded"
                  value={zoomMax}
                  onChange={(e) => setZoomMax(parseInt(e.target.value))} />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-slate-500 w-24">bbox clip</span>
                <input
                  className="flex-1 px-2 py-1 border rounded font-mono text-xs"
                  value={bboxClip}
                  onChange={(e) => setBboxClip(e.target.value)} />
              </label>
            </div>
          </section>
        </div>

        <div className="p-5 border-t flex justify-end gap-2 bg-white sticky bottom-0">
          <button onClick={() => openLayerDrawer(false)}>取消</button>
          <button onClick={submit} disabled={busy || !region}>
            {busy ? '提交中…' : '▶ 生成 PBF + PMTiles'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Schema invariant

The `LayerSet` shape (in `src/shared/layer-set.ts`) is the **single source of truth**
across main, preload, and renderer. The 6-section form must:

1. **Cover every field of `LayerSet`** — `base`, `roads`, `buildings`, `places`, `poi`, `other.purpose`.
2. **Use the same defaults** as `defaultsForPurpose(purpose)` so that toggling Q1
   automatically resets Q2-Q6 to the canonical preset values.
3. **Use the same enum names** as the Python/CLI version:
   `roads ∈ {'roads+labels','roads-only','none'}`, `buildings ∈ {'off','z13+ only','all'}`,
   `places ∈ {'cities+towns','cities only','all'}`.

If you collapse sections or move field-level controls into unrelated places, the user
loses the schema-as-question mental model. Keep the 6-section structure visible.

## Submit pattern

The form's `submit` calls IPC twice (PBF download → Planetiler convert). The task
scheduler in the main process orders them automatically via the queued/running state
machine — no UI-side orchestration needed.

```js
// Submit pattern (verified 2026-07-18)
await window.api.submitTask({ kind: 'pbf-download-osm-api', region, options: { pbf_source: 'osm-api' } });
await window.api.submitTask({ kind: 'planetiler-convert', region, options: { layers, planetiler: {...} } });
```

The light PBF download runs first. The heavy Planetiler convert runs in the mutex
(`heavy × 1`). User sees both tasks in the queue with live progress + log tail.

## Reuse without dependencies

This pattern depends on `useAppStore` (Zustand) for opening/closing the drawer.
Substitute `useState` + your router/portal for other frameworks:

- **Vue / Svelte**: use a `writable` store + `<dialog>` element
- **HTML-only**: lift open/closed state to a top-level button + section
- **React Native**: `<Modal>` from React Native Paper

The schema + defaults + submit pattern are framework-agnostic. Only the binding
implementation differs.
