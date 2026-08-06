/**
 * Export helpers for Style Studio — portable style.json + developer guide.
 */
import type { StyleSpecification } from 'maplibre-gl';

/** Paths relative to the export folder (documented in the README). */
export const EXPORT_GLYPHS = './fonts/{fontstack}/{range}.pbf';
export const EXPORT_SPRITE = './sprites/sprite';

export function prepareExportStyle(
  style: StyleSpecification,
  opts?: { name?: string; pmtilesFileName?: string }
): StyleSpecification {
  const out = JSON.parse(JSON.stringify(style)) as StyleSpecification;
  if (opts?.name) out.name = opts.name;

  out.glyphs = EXPORT_GLYPHS;
  out.sprite = EXPORT_SPRITE;

  const tileUrl = opts?.pmtilesFileName
    ? `pmtiles://${opts.pmtilesFileName}`
    : 'pmtiles://./tiles.pmtiles';

  out.sources = {
    openmaptiles: {
      type: 'vector',
      url: tileUrl,
      // Also document HTTP template alternative in README; MapLibre pmtiles protocol needs registration.
    },
  };

  for (const layer of out.layers ?? []) {
    if ('source' in layer && layer.source) {
      (layer as { source?: string }).source = 'openmaptiles';
    }
  }

  delete (out as { metadata?: unknown }).metadata;
  return out;
}

export function buildStyleExportReadme(opts: {
  styleFileName: string;
  pmtilesHint: string;
}): string {
  const { styleFileName, pmtilesHint } = opts;
  return `# 离线矢量样式开发指南

本目录由「MapForge · 配图」导出，用于在 **MapLibre GL JS**（或兼容引擎）中加载本地矢量瓦片。

## 目录约定

\`\`\`
export-folder/
  ${styleFileName}          # MapLibre Style Specification (v8)
  README-开发指南.md         # 本文件
  tiles.pmtiles             # （可选）把 PMTiles 放在同目录并改 style 中的 url
  fonts/                    # （可选）从应用 vendor/map-assets/fonts 复制
    Noto Sans Regular/{range}.pbf
    Noto Sans Bold/{range}.pbf
    Noto Sans Italic/{range}.pbf
  sprites/                  # （可选）从应用 vendor/map-assets/sprites/positron 复制
    sprite.json / sprite.png
    sprite@2x.json / sprite@2x.png
\`\`\`

当前样式里：

- \`glyphs\`: \`${EXPORT_GLYPHS}\`
- \`sprite\`: \`${EXPORT_SPRITE}\`
- \`sources.openmaptiles.url\`: \`pmtiles://…\`（需注册 PMTiles protocol）

导出时参考的瓦片：\`${pmtilesHint}\`

---

## 快速接入（浏览器 / Vite）

\`\`\`bash
npm i maplibre-gl pmtiles
\`\`\`

\`\`\`html
<link href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css" rel="stylesheet" />
<div id="map" style="position:fixed;inset:0"></div>
<script type="module">
  import maplibregl from 'maplibre-gl';
  import { Protocol } from 'pmtiles';

  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);

  const style = await fetch('./${styleFileName}').then((r) => r.json());
  // 指向同目录瓦片（若你改了文件名，同步改 style.sources）
  style.sources.openmaptiles.url = 'pmtiles://./tiles.pmtiles';

  new maplibregl.Map({
    container: 'map',
    style,
    center: [116.4, 39.9],
    zoom: 10,
  });
</script>
\`\`\`

> 若页面通过 \`http://localhost\` 提供静态文件，\`pmtiles://./tiles.pmtiles\` 会由 Protocol 相对当前页去 fetch。  
> 也可写成绝对 URL：\`pmtiles://http://127.0.0.1:8080/tiles.pmtiles\`。

---

## Electron / 桌面端

与本应用相同：用自定义 \`Source.getBytes\` 做文件 range 读取，再 \`protocol.add(new PMTiles(source))\`, style 里用 \`pmtiles://你的key\`。

注意：从 IPC/\`Buffer\` 得到的 \`Uint8Array\` **必须**拷进新的 \`ArrayBuffer\`（\`new Uint8Array(ab).set(src)\`），不要直接用 \`.buffer\`。本应用桌面端已改用自定义 \`pmtiles-range://\` 协议读字节，避免 IPC 结构化克隆损坏瓦片。

---

## 字体与图标

1. 从本应用仓库复制：
   - \`vendor/map-assets/fonts\` → 导出目录 \`fonts/\`
   - \`vendor/map-assets/sprites/positron\`（或 \`dark-matter\`）→ 导出目录 \`sprites/\`，并保证文件名为 \`sprite.json\` / \`sprite.png\`（及 \`@2x\`）
2. 或改 \`style.glyphs\` / \`style.sprite\` 指向你自己的 CDN / 静态服务。
3. 样式内 \`text-font\` 已归一为 \`Noto Sans Regular|Bold|Italic\`；若换字体栈，目录名必须与 fontstack 一致。

---

## 与 OpenMapTiles 数据约定

本应用 Planetiler 输出遵循 **OpenMapTiles** 矢量层命名，例如：

\`water\` \`waterway\` \`landcover\` \`landuse\` \`park\` \`boundary\` \`aeroway\`  
\`transportation\` \`transportation_name\` \`building\` \`place\` \`poi\`  
\`housenumber\` \`mountain_peak\` \`aerodrome_label\` …

图层的 \`source-layer\` 必须与档案 metadata 中的 \`vector_layers[].id\` 一致。  
若某层在档案中不存在，MapLibre 会静默跳过，不会报错。

---

## 继续编辑

- 可用本应用「配图」再次 **导入** \`${styleFileName}\` 继续改。
- 也可用 [Maputnik](https://maplibre.org/maputnik/) 打开 JSON（需能访问你的瓦片与字体）。
- 高级：直接改 JSON 中的 \`paint\` / \`layout\` / \`filter\` 表达式（MapLibre Style Spec）。

---

## 校验清单

- [ ] \`style.version === 8\`
- [ ] \`sources.openmaptiles.type === "vector"\`
- [ ] 已 \`addProtocol('pmtiles', …)\`
- [ ] \`fonts/\` 与 \`sprites/\` 路径可被页面 fetch（无 404）
- [ ] 控制台无 \`Unimplemented type: 4\`（通常是 HTML 404 被当成 PBF 解析）

祝配图顺利。
`;
}
