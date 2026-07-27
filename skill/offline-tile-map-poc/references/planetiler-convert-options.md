# Planetiler convert options — what actually affects the archive

Sources: `java -jar planetiler.jar --help`,  
[config-example.properties](https://github.com/onthegomap/planetiler/blob/main/config-example.properties),  
[planetiler-openmaptiles](https://github.com/openmaptiles/planetiler-openmaptiles).

## Modes (product UX)

| Mode | Meaning |
|------|---------|
| **标准 (standard)** | Community defaults: all layers, **maxzoom=14**, official profile flags. Do **not** pass `--exclude-layers`. |
| **自定义 (custom)** | User may exclude layers, raise maxzoom to **16**, tweak profile/quality/perf flags. |

Archive format (**PMTiles** / **MBTiles**) is independent of mode — same CLI, extension on `--output` chooses container.

## Layer filtering (official)

```bash
--exclude-layers=poi,housenumber
--only-layers=water,transportation,transportation_name,place
```

OpenMapTiles layer ids include:  
`water` `waterway` `water_name` `landcover` `landuse` `park` `boundary` `aeroway` `transportation` `transportation_name` `building` `housenumber` `place` `poi` `mountain_peak` `aerodrome_label`

**Deprecated (wrong):** older notes claiming Planetiler cannot exclude layers. That is false.

**Not available via CLI:** fine filters like “cities only” or “buildings from z13 only” — need style filters or a custom Java profile.

## Zoom

| Flag | Standard default | Hard limit (current jars) |
|------|------------------|---------------------------|
| `--minzoom` | 0 | 0 |
| `--maxzoom` | **14** | **16** |
| `--render_maxzoom` | 14 | 16 |

z14 is the OpenMapTiles community default. Higher zoom ≈ much larger files; clients can overzoom the top level.

## Useful profile flags

- `building_merge_z13` (default true — expensive)
- `transportation_z13_paths`, `transportation_name_*`
- `boundary_country_names`, `boundary_osm_only`
- `transliterate`, `use_wikidata`, `fetch_wikidata`, `languages`

## Quality / perf (selection)

`simplify_tolerance*`, `min_feature_size*`, `skip_filled_tiles`, `exclude_ids`,  
`tile_compression`, `tile_format` (mvt|mlt), `threads`, `storage`, `nodemap_*`, `compress_temp`, `free_*_after_read`

## Do not confuse

| Concern | Mechanism |
|---------|-----------|
| Smaller **file** | `--exclude-layers`, lower maxzoom |
| Hide on **map** only | MapLibre style (data still in archive) |
| JVM memory | `-Xmx` (machine resource, not map content) |

## Legacy Q1–Q6 LayerSet

Deprecated. Was mostly a **style preset** and was **not** wired to Planetiler. Replace with standard/custom + real `--exclude-layers`.
