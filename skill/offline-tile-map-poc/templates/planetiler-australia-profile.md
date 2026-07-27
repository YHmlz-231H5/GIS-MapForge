# Planetiler OpenMapTiles Profile — Source-Layer & Field Mapping

When you run `planetiler.jar --area=australia --download=true --force --osm_path=<pbf> --output=<pmtiles>`, Planetiler emits a PMTiles using Protomaps' OpenMapTiles schema. The source-layer names and the field names inside features are **NOT** what you would write if you read raw OSM tags directly. Use this cheat-sheet when authoring style.json against a Planetiler-generated PMTiles.

## Source-layer names (16 in OpenMapTiles Australia profile)

| Layer | MinZ | MaxZ | Geometry | What it contains |
|---|---|---|---|---|
| `landcover` | 3 | 14 | polygon | OSM `natural=*` + `landuse=farmland/forest/...` (Planetiler's preferred ground tint) |
| `landuse` | 4 | 14 | polygon | OSM `landuse=residential/commercial/industrial/park/military/...` |
| `park` | 4 | 14 | polygon | Subset of landuse (parks, gardens, nature_reserves) |
| `water` | 0 | 14 | polygon | OSM `natural=water` + `water=lake/reservoir/...` + ocean |
| `waterway` | 4 | 14 | line | OSM `waterway=river/stream/canal/...` |
| `water_name` | 1 | 14 | label | text labels for water bodies |
| `transportation` | 4 | 14 | line | OSM `highway=*` + `railway=*` + `aerialway=*` |
| `transportation_name` | 6 | 14 | label | road shield text labels |
| `building` (singular) | 13 | 14 | polygon | OSM `building=*` |
| `housenumber` | 14 | 14 | label | building address numbers |
| `place` (singular) | 0 | 14 | label | `place=city/town/village/hamlet/suburb/...` |
| `poi` (singular) | 12 | 14 | label | `amenity=*` `shop=*` `tourism=*` `office=*` |
| `boundary` | 0 | 14 | line | `boundary=administrative` relations (use filter `admin_level ≤ 4` for country/state borders) |
| `mountain_peak` | 7 | 14 | label | `natural=peak` |
| `aerodrome_label` | 8 | 14 | label | airport names |
| `aeroway` | 10 | 14 | polygon | `aeroway=runway/taxiway/apron` |

**Important**: features are populated by zoom. At z=3 national overview, only `bg`, `landcover`, `water`, `place` (cities), `boundary` actually render. That's CORRECT — it's Planetiler's tile-wise simplification. Don't add styles for `transportation` below z=4 expecting them to render — they will be empty.

## Field names

| Planetiler property key | Source (OSM tag) | Where |
|---|---|---|
| `class` | varies (`highway`, `building`, `landuse`, `natural`, OSM primary key for `place`) | transportation, building, landuse, place, poi, park, mountain_peak, aerodrome_label |
| `name:en` then `name` | OSM `name:en` / `name` | place, poi, water_name, transportation_name |
| `subclass` | OSM subtype | poi (e.g. `class=amenity, subclass=restaurant`), park, building |
| `kind` | OSM primary key for non-classified | mountain_peak |
| `admin_level` | `admin_level=2..6` | boundary |

## Common `class` values (from real Australia build)

### transportation.class
```
motorway, motorway_link, trunk, trunk_link,
primary, secondary, tertiary, minor,
service, path, footway,
rail, light_rail, subway, tram,
aerialway, ferry
```

### place.class
```
city, national_capital, state_capital,
town, village, suburb, hamlet, neighbourhood,
quarter, locality
```

### landuse.class
```
residential, commercial, industrial,
cemetery, hospital, school,
park, military,
wetland, wood, forest,
grass, farmland,
meadow, orchard, vineyard, scrub
```

### landcover.class
```
grass, grass_park, wood, forest, scrub,
wetland, wetland_forest, wetland_wood,
farmland, farmland_irrigated,
ice, rock, snow, sand, bare_rock
```

### building.class
```
building, building_part  (yes — Part is its own class)
```

### poi.class
```
amenity, shop, tourism, office, public_transport, healthcare,
education, leisure, sport, religion,
attraction, viewpoint, information
```

### waterway.class
```
river, canal, stream, drain, ditch
```

## Style recipe that matches the schema

```js
// CORRECT style.json against Planetiler output:

{ "id": "roads", "type": "line", "source": "src", "source-layer": "transportation",
  "paint": {
    "line-color": ["match", ["get", "class"],
      "motorway", "#e892a2", "trunk", "#f4a582",
      "primary", "#fddbc7", "secondary", "#fddbc7", "tertiary", "#fee8d3",
      "minor",   "#ffffff", "service", "#f0f0f0", "rail", "#bbbbbb",
      "#ffffff"]
  } }

// WRONG — would silently render nothing:
{ "source-layer": "roads",
  "paint": { "line-color": ["match", ["get", "highway"], ...] } }
//  ↑ wrong: layer is `transportation`, NOT `roads`
//  ↑ wrong: field is `class`, NOT `highway`
```

## Attribution requirement

Mapbox/OpenMapTiles terms require this attribution when displaying Planetiler-generated tiles:

```html
© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors
&middot; © <a href="https://openmaptiles.org/">OpenMapTiles</a>
&middot; Built with Planetiler (protomaps.com)
```

**Don't forget this.** OpenMapTiles / OSM / Protomaps licenses require attribution when displaying the tiles. If your demo strips it, you're not closing the offline-PoC properly even if the map renders.

## Building count at z=6 vs z=13

Because `building` minzoom=13, when you preview at zoom 3 you see 0 buildings. Don't panic; this is correct. Zoom in to z=13+ to see them. The 540k Australia buildings all exist in the PMTiles but Planetiler's `tile-wise simplification` delays them to z13.

Similarly: `transportation` shows major highways at z3, adds residential at z6, full detail at z10+. **Plan your demo's default zoom accordingly** — z=3 is a country overview; z=6 is a city; z=13 is a street. The data is there, just at different zooms.
