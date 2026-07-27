# Two-step: download OSM → generate vector tiles

Do **not** chain download + Planetiler in one click.

## Step 1 — Download type dialog → OSM (vector)

After region / GeoJSON is set, open「下载数据…」and choose **矢量（OSM）**.
Creates `pbf-download-osm-api` (Overpass mirrors → `.osm`).

(Raster XYZ is a separate branch — see `raster-xyz-download.md`.)

## Step 2 — TaskQueue →「生成矢量瓦片」

On a completed OSM/Geofabrik download:

```ts
await window.api.submitTask({
  kind: 'planetiler-convert',
  region: task.region,
  options: {
    osm_path: task.output_path, // REQUIRED
    planetiler_form: { mode: 'standard', archive_format: 'pmtiles' /* or mbtiles */, ... },
  },
});
```

Dialog: archive **PMTiles | MBTiles** + **标准 | 自定义** (real `--exclude-layers` / maxzoom).

Handler:
1. XML → PBF if needed (`@osmix/pbf`)
2. Ensure aux under `data/sources`
3. `java -jar planetiler.jar --osm-path=… --bbox=… --output=….pmtiles|.mbtiles --download=false …`

## Related

- `vector-tile-pipeline.md`
- `planetiler-convert-options.md`
- `raster-xyz-download.md`
