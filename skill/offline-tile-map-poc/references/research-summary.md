# Research summary — PMTiles + MapLibre official knowledge bank

Condensed from Protomaps docs (`docs.protomaps.com` / `pmtiles.io`), Protomaps GitHub (`protomaps/PMTiles`), MapLibre docs (`maplibre.org/maplibre-gl-js`), and the npm registry. Captured during the initial PoC session; quoted so future sessions don't re-fetch.

---

## PMTiles spec (v3)

> "PMTiles is a single-file archive format for tiled data. A PMTiles archive can be hosted on a commodity storage platform such as S3, and enables low-cost, zero-maintenance map applications that are 'serverless' - free of a custom tile backend or third party provider." — `protomaps/PMTiles` README

- PMTiles readers use **HTTP Range Requests** to fetch only the relevant tile or metadata on demand.
- Self-contained header / root directory / metadata / tile data inside a single `.pmtiles` file.
- Self-indexing: Z/X/Y → byte offset map (root directory + leaf directories). At most 2 cacheable intermediate requests per tile.
- **Read-only.** Updates require rewriting the entire file.
- Current spec version: v3 — `https://github.com/protomaps/PMTiles/blob/master/spec/v3/spec.md`

## Reading PMTiles — JavaScript path

> "MapLibre GL JS — **the recommended library** for building smooth experiences and custom styling." — Protomaps docs, `pmtiles/index.md`

The JavaScript library includes a plugin for MapLibre GL that uses its [`addProtocol` feature](https://maplibre.org/maplibre-gl-js/docs/API/functions/addProtocol/):

```js
import { Protocol } from "pmtiles";
let protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
```

Source URL in style:
```json
{
  "sources": {
    "protomaps": {
      "type": "vector",
      "url": "pmtiles://https://example.com/example.pmtiles"
    }
  }
}
```

Using the `pmtiles://` protocol will automatically derive a `minzoom` and `maxzoom` for the Source.

**`addProtocol` is the MapLibre official API**, stable as of v3+ and still the recommended path in v5. It is not a third-party plugin.

## Raster / terrain PMTiles

For raster, set `type: "raster"`:
```json
{ "type": "raster", "url": "pmtiles://https://example.com/example.pmtiles" }
```

For terrain (Terrarium RGB):
```json
{ "type": "raster-dem", "url": "pmtiles://...", "encoding": "terrarium" }
```

## Vector style minimal shape

A MapLibre style is just `version + sources + layers`. **No glyphs needed** if no `text-field` / `text-font`. **No sprite needed** if no `icon-image`. This is what lets a "hello world" PoC be ~30 lines.

## Glyphs (only if you have text labels)

```json
"glyphs": "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf"
```
Local equivalent: `"glyphs": "./fonts/{fontstack}/{range}.pbf"`. Fontstacks come from the `font-maker` tool or from `protomaps/basemaps-assets/fonts/`.

## Sprite (only if you have icons)

```json
"sprite": "https://protomaps.github.io/basemaps-assets/sprites/v4/light"
```
Local equivalent: `"sprite": "./sprites/light"` (resolves to `light.png`, `light.json`, `light@2x.png`, `light@2x.json`).

## npm package versions (verify against registry each session)

| package | current major | license | dist files used |
|---|---|---|---|
| `maplibre-gl` | 5.x | BSD-3-Clause | `dist/maplibre-gl.js`, `dist/maplibre-gl.css` |
| `pmtiles` | 4.x | BSD-3-Clause | `dist/pmtiles.js` |

Pin specific versions in the PoC to match the Protomaps example (e.g. `maplibre-gl@5.13.0` + `pmtiles@4.4.1`) to avoid surprise breakage from newer majors.

## Sample data

`https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles` — 6.6 MB, 4 source-layers:
- `water`
- `buildings`
- `roads`
- `pois`

Centered on Florence (Firenze), Italy. License: ODbL. This is the canonical "smallest usable PMTiles for a demo" file.

## Why NOT the Protomaps Basemaps route

`@protomaps/basemaps` is a separate npm package that ships pre-built layer definitions for a world-scale basemap. It does the `layers(...)` function call for you, BUT it requires the global Protomaps tileset (multi-GB) and the basemaps-assets glyphs/sprite (MBs of fonts). For a "validate the stack works" PoC, hand-rolled style with the firenze sample is faster and cleaner.

## CORS note

> "Archives on cloud storage may require CORS for the origin `https://protomaps.github.io`" — pmtiles.io

Local server doesn't need CORS for same-origin requests, but adding `Access-Control-Allow-Origin: *` is harmless and makes debugging easier from cross-origin dev tools.

## Local serving note

> "You can use any local HTTP server that supports Range Requests to serve files locally." — Protomaps docs

This explicitly **rules out** Python's built-in `http.server` (which has no Range support as of Python 3.11) — though it doesn't name it. The Range-supporting alternatives are: `http-server` (npm), `serve` (npm), Go's `http.FileServer` (yes), and the custom Python handler in `references/range-server.py`.