# PMTiles / vector layer curation — DEPRECATED

> **2026-07-23:** The Q1–Q6 “LayerSet” flow is **deprecated**.
> Planetiler **does** support `--exclude-layers` / `--only-layers`.
> Use **标准 / 自定义** + real OpenMapTiles layer checkboxes instead.
> See `planetiler-convert-options.md` and `vector-tile-pipeline.md`.

---

## Historical note

Users asked to pick which map elements to keep before generating tiles.
An early mistaken claim was that Planetiler could not exclude layers — **that was wrong**.
The old Q1–Q6 answers mostly drove **style presets**, not archive contents.

## Current approach

1. **标准** — all layers, maxzoom 14 (community default), no exclude list  
2. **自定义** — checkbox OpenMapTiles layers → `--exclude-layers=…`; maxzoom up to 16  
3. Archive format **PMTiles | MBTiles** is independent  

Do **not** reintroduce purpose radios (overview/city/street/route) unless they only set presets that map 1:1 to exclude lists.

## Related

- `planetiler-convert-options.md`
- `pmtiles-layer-curator-ui.md` (UI sketch also outdated)
