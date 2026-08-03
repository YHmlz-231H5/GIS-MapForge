# Map Downloader

[English](README.en.md) | 中文

面向桌面的 **地图数据下载与离线瓦片打包工具**。在地图上选定区域后，可下载 OpenStreetMap 矢量数据或 XYZ 栅格瓦片，并在本机用 Planetiler 生成标准 **PMTiles / MBTiles**，支持应用内预览与样式工作室。

> 运行时需要网络（底图、地名搜索、数据下载）。产物（PMTiles 等）可拷贝到其他离线地图应用中使用。

**许可证：** [MIT](./LICENSE)

---

## 功能概览

### 区域选择

- 地图框选 / 绘制（Terra Draw + MapLibre）
- Photon / DataV 地名与行政区搜索
- GeoJSON 导入、手动 bbox
- 可选下载边界外扩（度）

### 矢量数据（OSM → 瓦片包）

| 步骤 | 说明 |
|------|------|
| 下载 | 默认 **Overpass** 分块抓取 → `.osm`；备选 **Geofabrik** 直链 → `.osm.pbf` |
| 转换 | 本机 **Planetiler**（Java）→ OpenMapTiles schema |
| 输出 | **PMTiles**（默认）或 **MBTiles**；标准 / 自定义图层与缩放 |

- 任务队列：排队、进度、日志、历史筛选与分页
- 应用内 **PMTiles 预览**（MapLibre + 本地 `pmtiles://` 协议）
- **样式工作室**：图层开关、导出自托管部署说明（字体 / sprite）

### 栅格数据（XYZ → 归档）

- 精选可批量下载的 XYZ 源（街道 / 影像 / 地形等），下载前探测可用性
- 按 bbox + 缩放范围并发下载，失败瓦片可识别拦截页
- 打包为 **PMTiles**（标准 v3）或 **MBTiles**
- 栅格预览与选区叠加

### 其他

- 设置：输出目录、Java 堆、MapTiler Key（底图）、界面语言等
- 内置使用说明面板
- Windows / macOS / Linux 打包（electron-builder：NSIS / portable / DMG / AppImage 等）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | **Electron 33** |
| UI | **React 18** · **TypeScript** · **Vite 6** · **Tailwind CSS** · Zustand · Lucide |
| 地图 | **MapLibre GL JS 5.7.x** · **pmtiles** · Terra Draw / `@watergis/maplibre-gl-terradraw` |
| 主进程 | Node · **better-sqlite3**（任务持久化）· Worker（Overpass / 栅格下载） |
| 矢量切片 | **Planetiler**（外部 JAR + JDK 21+）· `@osmix/pbf`（XML→PBF 等） |
| 测试 | Playwright（e2e） |
| 打包 | electron-builder |

### 架构示意

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React)                                        │
│  MapView · RegionPanel · TaskQueue · Preview · Studio    │
└──────────────────────────┬──────────────────────────────┘
                           │ preload IPC
┌──────────────────────────▼──────────────────────────────┐
│  Main (Electron)                                         │
│  任务调度 · SQLite · Planetiler 子进程 · 瓦片 Worker      │
│  pmtiles 本地 Range 协议                                  │
└─────────────────────────────────────────────────────────┘
```

源码布局要点：

- `src/main/` — Electron 主进程、IPC、任务处理器
- `src/preload/` — 安全桥接
- `src/renderer/` — React UI
- `src/shared/` — 类型与下载源配置（主/渲染共用）
- `scripts/` — 开发编排、构建、拉取 map-assets
- `vendor/` — CSP 辅助脚本等（**不含**大体量字体/sprite，见下文）
- `skill/` — 流水线与选项说明（设计/实现参考）

### Electron + MapLibre 注意

MapLibre 运行时以 npm 包为准，`vendor/` 不再内置 `maplibre-gl.js`；请勿通过 `<script>` 引入第二份 MapLibre（双实例会破坏 Worker）。不要 monkey-patch `window.Blob`。在 Electron 33 上建议锁定 MapLibre **5.7.x**。

---

## 环境要求

1. **Node.js** 20+（推荐 LTS）与 npm  
2. **JDK 21+**，且 `java` 在 `PATH` 中（矢量切片）  
3. **Planetiler JAR**（矢量切片）  
4. 稳定网络（下载与底图）

可选：用于在线底图的 MapTiler（或其它）API Key，在应用设置中配置。

---

## 快速开始

### 1. 克隆与安装

```bash
git clone https://github.com/YHmlz-231H5/GIS-MapForge.git
cd GIS-MapForge
npm install
```

`postinstall` 会尝试为 Electron 重建 `better-sqlite3`；若失败可手动：

```bash
npm run rebuild:native
```

### 2. 下载预览用字体 / Sprite（约 100MB，不进仓库）

```bash
npm run fetch:map-assets
```

将写入 `vendor/map-assets/`（已在 `.gitignore`）。不做此步时，在线底图可用，但 **本地 PMTiles 预览的文字/图标** 可能缺失。

### 3. 放置 Planetiler

从 [Planetiler releases](https://github.com/onthegomap/planetiler/releases) 下载发行版 JAR，保存为：

```text
tools/planetiler.jar
```

（`tools/*.jar` 已忽略，请勿提交二进制。）

### 4. 开发运行

```bash
npm run dev
```

GPU 异常时可试：

```bash
npm run dev:no-gpu
```

### 5. 生产构建

```bash
npm run build
npm run electron:build
```

安装包输出在 `release/<version>/`。

---

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 并行启动 Vite + main/preload/workers 监听 + Electron |
| `npm run build` | 构建 renderer + main + workers + preload |
| `npm run electron:build` | 构建并打包安装包 |
| `npm run fetch:map-assets` | 拉取 glyphs / sprites 到 `vendor/map-assets` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run rebuild:native` | 重建 better-sqlite3 |

---

## 数据流（主路径）

**矢量：**

```text
选区域 → Overpass（.osm）→ [XML→PBF] → Planetiler → .pmtiles / .mbtiles
         └─ 或 Geofabrik 直链（.osm.pbf）──┘
```

**栅格：**

```text
选区域 + XYZ 源 → 并发下载瓦片目录 → 打包 PMTiles / MBTiles
```

任务状态持久化在本地 SQLite（位于应用 `data/` 目录，不进仓库）。

---

## 仓库包含 / 不包含

为控制体积，**本仓库只提交源码与必要配置**，不包含：

| 路径 | 原因 |
|------|------|
| `node_modules/` | 依赖，本地 `npm install` |
| `data/`、`downloads/`、`output/` | 运行时数据与下载结果 |
| `dist/`、`dist-electron/`、`release/` | 构建产物 |
| `tools/*.jar` | Planetiler 等大型 JAR |
| `vendor/map-assets/` | 字体与 sprite（`npm run fetch:map-assets`） |
| `docs/` | 内部开发文档 / 审核记录（不公开） |

小体积 `vendor/suppress-csp-warning.js`（及可选遗留静态资源）可随仓库提供；MapLibre 运行时以 **npm 包** 为准。

---

## 合规与使用建议

- **OSM 数据**遵循 [ODbL](https://opendatacommons.org/licenses/odbl/)；对外分发请保留署名与份额要求。  
- **栅格瓦片**请遵守各服务商 ToS；仓库内精选源偏「可礼貌批量使用」的公共图层，仍可能因网络或策略返回拦截页，应用会尽量识别并失败提示。  
- **Overpass / Geofabrik** 为公共基础设施，请控制并发与区域大小，避免滥用。  
- 本软件按 MIT **按原样提供**，作者不对下载内容的合法性、完整性或第三方服务可用性负责。

---

## 贡献

Issue / PR 欢迎。较大改动请先开 Issue 说明动机。本地请遵循现有目录与 TypeScript 风格；涉及 MapLibre 时注意上文 Electron 约束。

---

## 致谢

- [MapLibre](https://maplibre.org/) · [PMTiles](https://github.com/protomaps/PMTiles) · [Planetiler](https://github.com/onthegomap/planetiler)  
- [OpenStreetMap](https://www.openstreetmap.org/) 贡献者与 Overpass / Geofabrik  
- OpenFreeMap / OpenMapTiles 字体与样式相关资源（经 `fetch:map-assets` 拉取）

---

## 版本

当前开发版见 `package.json` 的 `version`（`0.1.0`）。API 与 UI 仍可能变化。
