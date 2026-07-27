# CN Administrative Region Lookup (NEW 2026-07-19)

When the app needs to let a user pick a Chinese administrative region
by **name** (e.g. "龙华区", "深圳市", "成都市锦江区") and get back a
bbox / adcode for the download pipeline, you have multiple options. The
**开源友好 (GitHub-friendly)** constraint rules out services that require
an API key per-user.

## Hard constraint

- The user wants the app to be **fork-able and runnable** without filling
  in any API key. Anything that 401s on `key=dummy` is disqualified from
  the default path.

## The 5 candidate services (validated 2026-07-19)

| Service | Endpoint | Key? | CN reach | 中文准确 | bbox in reply? | Notes |
|---|---|---|---|---|---|---|
| **Photon (Komoot)** | `https://photon.komoot.io/api/?q={name}&limit=5` | ❌ | ★★★★ | ★★★★ | ✅ `extent` | **推荐默认** |
| OSM Nominatim | `https://nominatim.openstreetmap.org/search?q={name}&countrycodes=cn&format=json` | ❌ | ★★ | ★★ (中文乱码多) | ✅ `boundingbox` | fallback only |
| Nominatim CN mirror | `https://nominatim.openstreetmap.cn/...` | ❌ | ★★★ | ★★★ | ✅ | 不稳定, 维护不勤 |
| 高德 district | `https://restapi.amap.com/v3/config/district?keywords={name}&key={...}` | ✅ | ★★★★★ | ★★★★★ | ❌ (只有 center, 自己算 bbox) | 实名 key |
| 腾讯 district | `https://apis.map.qq.com/ws/district/v1/search?...&key={...}` | ✅ | ★★★★★ | ★★★★ | ✅ | QQ 登录 |
| 百度 district | `https://api.map.baidu.com/place/v2/search?query={name}&region={city}&ak={...}` | ✅ | ★★★★ | ★★★★ | ✅ | 手机号申请 |
| DataV.GeoAtlas | `https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json` | ❌ | ★★★★★ | ★★★★★ | ✅ (geometry) | **无关键字 API** |

## The two-phase pattern (recommended default)

**No service alone gives you everything** — Photon has bbox + center but no
adcode; DataV has geometry + adcode but no keyword search. The pattern is:

```
[Step 1] Photon (key=null, no key, public)
    GET https://photon.komoot.io/api/?q=龙华区&limit=5
    → { osm_id, osm_type, properties: {name, city, state, extent=[w,s,e,n], ...} }
    → returns bbox + center + multi-language match disambiguation (深圳龙华 vs 海南海口龙华)

[Step 2] If you need adcode (for downstream DataV full geometry):
    → Photon gives OSM `osm_id` (R5664193), NOT 国标 adcode (440309)
    → Two options:
        (a) User supplies the adcode manually (degrade gracefully)
        (b) Hard-coded lookup table for common regions (only 5-10% of users hit this)
        (c) Probe by bbox: hit DataV for each level-1 province, walk down the tree
            matching bbox containment — slow, fragile, NOT recommended
```

**For the v1 app**: ship Photon-only. Don't bother with DataV full geometry
overlay — the bbox + center is enough for OSM download + fitBounds.

## Photon response shape (full)

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [114.0398603, 22.6994309] },
      "properties": {
        "osm_id": 5664193,
        "osm_type": "R",
        "osm_key": "place",
        "osm_value": "county",
        "type": "district",
        "name": "龙华区",
        "city": "深圳市",
        "state": "广东省",
        "country": "中国",
        "postcode": "518110",
        "countrycode": "CN",
        "extent": [113.9614318, 22.7746034, 114.1084677, 22.5839926]
      }
    },
    {
      "osm_id": 5401982,
      "properties": {
        "name": "龙华区",
        "city": "海口市",
        "state": "海南省",
        "extent": [110.2450125, 20.0877775, 110.4131198, 19.7165665]
      }
    }
  ]
}
```

**Critical**: `extent` is `[minX, minY, maxX, maxY]` in lon/lat — perfect for
MapLibre `fitBounds([w,s], [e,n])`. Note that `extent[1] > extent[3]`
(north > south), so `[w, s, e, n]` mapping is `extent[0], extent[3], extent[2], extent[1]`.

**Disambiguation**: when multiple regions share the same name (like 龙华区 in
both Shenzhen and Haikou), filter by state or city:
- Show all results in a list, let user click
- Auto-filter by current `networkMode === 'cn'`? Not reliable — user might
  search "龙华区" while looking at Haikou. Always show all.

## Photon usage gotchas

1. **CORS is open** — works from any browser/Electron renderer. No proxy needed.
2. **Rate limit** — Komoot doesn't publish exact limits; observed fair-use is
   ~1 req/sec sustained. Batch your geocodes — don't fire 10 in a row on
   keystroke. Debounce input by 300ms minimum.
3. **English vs Chinese** — `q=Longhua+Shenzhen` works; Chinese `q=龙华区`
   also works (URL-encoded). Pass through the raw input; Photon handles both.
4. **Multi-word disambiguation** — `q=南京` returns both 江苏省南京市 (Nanjing
   city) and a station/road. Filter by `osm_value` (`city`/`town`/`village`/
   `suburb`/`county`) to keep only administrative results.
5. **No state-level returns for `区`** — Photon returns `county` for both
   "龙华区" (district) and 海口 "龙华区" (district). OSM has them at different
   admin levels. Don't assume "district" maps to the OSM `place=county` tag.
6. **`lang` parameter is restricted** — Photon returns HTTP 400 if you pass
   `lang=zh`. Valid values are `{default, de, en, fr}` only. Don't pass
   anything; the search query (`q=`) is already in the user's language and
   Photon returns the response in the matching locale. **This is a common
   bug** — code that assumes "set lang to user's UI language" will break
   for Chinese / Japanese / Korean users. See SKILL.md Pitfall 32.

## Photon vs Nominatim code

```ts
async function geocodeCn(name: string, limit = 5): Promise<PhotonResult[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(name)}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  return data.features.filter(
    (f: any) => f.properties.countrycode === 'CN',
  );
}
```

That's all you need. No key, no token, no sign-up.

## When you DO need full geometry (downstream fancy)

DataV `bound/{adcode}_full.json` returns the full MultiPolygon + bbox + center.
You can use it for **drawing the administrative boundary as an overlay**
(yellow fill + dashed line) before user clicks "download". To get from Photon's
osm_id to adcode without a separate service:

- **Compromise**: just don't render the boundary overlay. Photon's `extent`
  bbox is enough — draw that as a rectangle.
- **Best-effort probe**: `https://geo.datav.aliyun.com/areas_v3/bound/{code}.json`
  where `code` is something you guessed. Won't work for arbitrary input.
- **Local index download** (~5 MB) — DataV lets you download the full tree
  at `bound/100000_full.json` (35 provinces) + recursive `_full.json` per
  province. Total ~50 MB. Cache locally with 30-day TTL. **Recommended
  only if you need to draw overlays**.

## Photon + DataV bridge (when you DO want boundary overlay, 2026-07-19 update)

If you decide to draw the exact administrative boundary polygon (not just a
bbox rectangle) for the chosen region, you need both the **Photon bbox** AND
the **DataV adcode**. The bridge: probe DataV by name match at each level.

```ts
// datav-client.ts (bestEffortAdcode heuristic)
export async function bestEffortAdcode(
  name: string,                    // local name e.g. "龙华区"
  bbox: [number, number, number, number]
): Promise<string | undefined> {
  try {
    // 1. Country-level: 35 provinces
    const country = await fetchDataVByAdcode('100000');
    for (const prov of country.features) {
      // 2. Skip provinces whose center is outside the bbox
      const c = prov.properties.center;
      if (!(bbox[0] <= c[0] && bbox[2] >= c[0] && bbox[1] <= c[1] && bbox[3] >= c[1])) continue;
      // 3. Walk cities under this province
      const cities = await fetchDataVByAdcode(String(prov.properties.adcode));
      for (const city of cities.features) {
        const cc = city.properties.center;
        if (!(bbox[0] <= cc[0] && bbox[2] >= cc[0] && bbox[1] <= cc[1] && bbox[3] >= cc[1])) continue;
        // 4. Walk districts under this city, match by NAME
        const districts = await fetchDataVByAdcode(String(city.properties.adcode));
        for (const dist of districts.features) {
          if (dist.properties.name === name) {
            return String(dist.properties.adcode);
          }
        }
      }
    }
  } catch {
    // DataV unreachable → return undefined; bbox-only mode is fine
  }
  return undefined;
}
```

**Cost**: 1 + N_province + N_city requests. Worst case ~5 HTTP calls for a
small bbox. Each `_full.json` is 30-200 KB. Total ~600 KB for full
resolution. Acceptable for an interactive "search → preview" flow.

**Fallback**: if heuristic fails, the region still has the bbox + name;
just no green polygon overlay. The bbox rectangle (blue dashed) is enough
to start a download.

## URL whitelist for your README

When documenting the no-key path, point users at:

- **Photon**: `https://photon.komoot.io/` (free public API, no signup)
- **OpenFreeMap** (for basemap tiles): `https://openfreemap.org/` (already in
  the basemap catalog)
- **DataV.GeoAtlas** (for geometry overlay): `https://datav.aliyun.com/portal/school/atlas/area_selector`

No API keys required for any of these. Forking the repo works out of the box.
