# Map Downloader

[中文](README.md) | English

A desktop tool for **downloading map data and packaging offline tile archives**. Select a region on the map, download OpenStreetMap vector data or XYZ raster tiles, then build standard **PMTiles / MBTiles** locally with Planetiler. Includes in-app preview and a style studio.

> Runtime requires network access (basemaps, place search, data downloads). Output archives (PMTiles etc.) can be copied to other offline map apps.

**License:** [MIT](./LICENSE)

---

## Feature Overview

### Region Selection

- Box select / draw on the map (Terra Draw + MapLibre)
- Place and administrative region search via Photon / DataV
- GeoJSON import and manual bbox entry
- Optional download edge buffer (degrees)

### Vector Data (OSM to Tile Archive)

| Step | Description |
|------|-------------|
| Download | Default **Overpass** chunked fetch to `.osm`; alternative **Geofabrik** direct link to `.osm.pbf` |
| Convert | Local **Planetiler** (Java) to OpenMapTiles schema |
| Output | **PMTiles** (default) or **MBTiles**; standard / custom layers and zoom levels |

- Task queue: queuing, progress, live logs, history filtering and pagination
- In-app **PMTiles preview** (MapLibre + local `pmtiles://` protocol)
- **Style studio**: layer toggles, export guide for self-hosted deployment (fonts / sprites)

### Raster Data (XYZ to Archive)

- Curated XYZ sources (streets / imagery / topo, etc.), probed before download
- Concurrent download by bbox + zoom range; blocked / error tiles are detected
- Pack as **PMTiles** (standard v3) or **MBTiles**
- Raster preview with region overlay

### Other

- Settings: output directory, Java heap, MapTiler key (basemap), UI language
- Built-in help panel
- Windows / macOS / Linux packaging (electron-builder: NSIS / portable / DMG / AppImage, etc.)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | **Electron 33** |
| UI | **React 18** · **TypeScript** · **Vite 6** · **Tailwind CSS** · Zustand · Lucide |
| Maps | **MapLibre GL JS 5.7.x** · **pmtiles** · Terra Draw / `@watergis/maplibre-gl-terradraw` |
| Main process | Node · **better-sqlite3** (task persistence) · Workers (Overpass / raster download) |
| Vector tiles | **Planetiler** (external JAR + JDK 21+) · `@osmix/pbf` (XML to PBF, etc.) |
| Tests | Playwright (e2e) |
| Packaging | electron-builder |

### Architecture

```text
+---------------------------------------------------------+
|  Renderer (React)                                        |
|  MapView · RegionPanel · TaskQueue · Preview · Studio    |
+--------------------------+------------------------------+
                           | preload IPC
+--------------------------v------------------------------+
|  Main (Electron)                                         |
|  Task scheduler · SQLite · Planetiler child · workers    |
|  Local pmtiles range protocol                            |
+---------------------------------------------------------+
```

Source layout:

- `src/main/` — Electron main process, IPC, task handlers
- `src/preload/` — secure bridge
- `src/renderer/` — React UI
- `src/shared/` — shared types and download-source config
- `scripts/` — dev orchestration, builds, map-assets fetch
- `vendor/` — CSP helper etc. (no large fonts / sprites; see below)
- `skill/` — pipeline and option references (design / implementation notes)

### Electron + MapLibre Notes

MapLibre is loaded from the npm package. `vendor/` no longer ships `maplibre-gl.js`; do not add a second MapLibre via `<script>` (dual instances break WebGL workers). Do not monkey-patch `window.Blob`. On Electron 33, pin MapLibre **5.7.x**.

---

## Requirements

1. **Node.js 20+** (LTS recommended) and npm
2. **JDK 21+** with `java` on `PATH` (vector tiles)
3. **Planetiler JAR** (vector tiles)
4. Stable network (downloads and basemaps)

Optional: a MapTiler (or other) API key for online basemaps, configured in app settings.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YHmlz-231H5/GIS-MapForge.git
cd GIS-MapForge
npm install
```

`postinstall` attempts to rebuild `better-sqlite3` for Electron. If it fails, run manually:

```bash
npm run rebuild:native
```

### 2. Fetch preview fonts / sprites (about 100 MB, not committed)

```bash
npm run fetch:map-assets
```

Files are written to `vendor/map-assets/` (gitignored). Without this step, online basemaps still work, but text / icons in local PMTiles preview may be missing.

### 3. Add Planetiler

Download the release JAR from [Planetiler releases](https://github.com/onthegomap/planetiler/releases) and save it as:

```text
tools/planetiler.jar
```

(`tools/*.jar` is gitignored; do not commit binaries.)

### 4. Run in development

```bash
npm run dev
```

If you hit GPU issues:

```bash
npm run dev:no-gpu
```

### 5. Production build

```bash
npm run build
npm run electron:build
```

Installers are written to `release/<version>/`.

---

## Common Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Build preload / main / workers, then start Vite + Electron |
| `npm run build` | Build renderer + main + workers + preload |
| `npm run electron:build` | Build and package installers |
| `npm run fetch:map-assets` | Fetch glyphs / sprites into `vendor/map-assets` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run rebuild:native` | Rebuild better-sqlite3 |

---

## Data Flow (main paths)

**Vector:**

```text
select region -> Overpass (.osm) -> [XML to PBF] -> Planetiler -> .pmtiles / .mbtiles
                 '-- or Geofabrik direct (.osm.pbf) --'
```

**Raster:**

```text
select region + XYZ source -> concurrent tile download -> pack PMTiles / MBTiles
```

Task state is persisted in local SQLite (under the app `data/` directory, not committed).

---

## What Is In / Not In This Repository

The repo intentionally contains source and required config only:

| Path | Reason |
|------|--------|
| `node_modules/` | Dependencies, install with `npm install` |
| `data/`, `downloads/`, `output/` | Runtime data and download results |
| `dist/`, `dist-electron/`, `release/` | Build outputs |
| `tools/*.jar` | Large JARs such as Planetiler |
| `vendor/map-assets/` | Fonts and sprites (`npm run fetch:map-assets`) |
| `docs/` | Private development notes / review records (not published) |

`vendor/suppress-csp-warning.js` is small and tracked; MapLibre runtime comes from the **npm package**.

---

## Compliance Notes

- **OSM data** follows [ODbL](https://opendatacommons.org/licenses/odbl/); keep attribution and share-alike requirements when redistributing.
- **Raster tiles** must respect each provider's ToS. Curated sources favor public layers that tolerate polite bulk use, but providers can still block or return error pages; the app tries to detect those.
- **Overpass / Geofabrik** are public infrastructure; control concurrency and region size to avoid abuse.
- This software is provided under MIT **as-is**; the author is not responsible for the legality, completeness, or third-party service availability of downloaded content.

---

## Contributing

Issues / PRs welcome. For larger changes, open an issue first. Follow the existing directory structure and TypeScript style; respect the Electron / MapLibre constraints above.

---

## Credits

- [MapLibre](https://maplibre.org/) · [PMTiles](https://github.com/protomaps/PMTiles) · [Planetiler](https://github.com/onthegomap/planetiler)
- [OpenStreetMap](https://www.openstreetmap.org/) contributors and Overpass / Geofabrik
- OpenFreeMap / OpenMapTiles font and style assets (fetched via `fetch:map-assets`)

---

## Version

Current development version is `0.1.0` (see `package.json`). APIs and UI may still change.