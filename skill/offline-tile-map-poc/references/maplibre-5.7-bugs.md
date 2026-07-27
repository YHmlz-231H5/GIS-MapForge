# maplibre-gl 5.7 已知 bug 升级清单

## 5.7.3 出现的 3 个真问题 (升级动机)

观察控制台 (DevTools 截图):

```
[GroupMarkerNotSet(crbug.com/242999)!:A0D0380084690000]Automatic fallback to software WebGL
  has been deprecated. Please use the --enable-unsafe-swiftshader flag...

[.WebGL-00003EE401BF2200]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV,
  High): GPU stall due to ReadPixels  (×N 次)

Expected value to be of type number, but found null instead.   ← 红字
  551d480f-425e-47b8-8...3e562f237bd87:2758
```

| # | 表现 | Root cause | 5.7 状态 | 5.8 状态 |
|---|---|---|---|---|
| 1 | `Expected value to be of type number, but found null` | tile-picking 同步 `readPixels` 返回 null | **bug** | 修 |
| 2 | `GPU stall due to ReadPixels` 反复触发 | 同上, sync readPixels 阻塞 GPU thread | **持续** | 修 (async) |
| 3 | `GroupMarkerNotSet` Software WebGL fallback | 1+2 综合: GPU 卡 → Chromium 自动 fallback | **bug** | 修 |

**根因**: maplibre 5.7 tile-picking 同步 readPixels, return null 而不是 number. V8 coerce 失败 → 整个 GPU 路径 crash.

## 升级到 5.8.0 (最小修复)

```bash
# 1. 安装
npm i maplibre-gl@5.8.0

# 2. 把 vendor 替换成新的 (因为我们用本地 vendor, 不走 CDN)
cp node_modules/maplibre-gl/dist/maplibre-gl.js vendor/maplibre-gl.js
cp node_modules/maplibre-gl/dist/maplibre-gl.css vendor/maplibre-gl.css

# 3. 重新 build
npm run build
```

## 验证升级

跑 Playwright e2e:

```ts
const forbidden = [
  'Expected value to be of type number',
  'GPU stall due to ReadPixels',
  'GroupMarkerNotSet',
];
for (const phrase of forbidden) {
  expect(captured.find((m) => m.text.includes(phrase))).toBeUndefined();
}
```

期望全部 0 (升级后). 升级前 3 个都出现.

## 不升级的 trade-off

- 5.7 vendor 文件较小 (992 KB vs 5.8 945 KB — 实际更小因为 5.8 修了 ReadPixels 的死代码)
- 5.8 API 完全向后兼容 (我们代码无需改)
- 5.8 是 LTS 之前的 stable 5.x, 之后还有 5.9..5.24

**推荐**: 至少 5.8.0. 如果跑新功能 (5.9+ 多了 terrain 3D 等) 才升 5.9+.

## 已知不会消失的 warning (不要浪费时间修)

- `Insecure Content-Security-Policy` — Electron 33 C++ land 内部, 仅 packaged build 消失
- `Download the React DevTools` — 开发提示, 关闭后无

## 相关: GPU flag 优化 (升级后进一步减少警告)

```ts
// 在 Electron 33 + Windows 11 + maplibre 5.8 验证过:
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,UseChromeOSDirectVideoDecoder'
);
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch(
  'enable-features',
  'VaapiVideoDecoder,VaapiIgnoreDriverChecks'
);
```

注意: `use-angle=d3d11` 是 Chromium 内部 flag, 不需要额外 `enable-features=Vulkan` (那是 web 平台的 Vulkan, Electron 33 上忽略).

## 关键 reference 链接

- maplibre-gl 5.8 changelog: https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md
- chromium GroupMarkerNotSet: https://issues.chromium.org/issues/40082852
- Electron disable-features list: https://www.electronjs.org/docs/latest/breaking-changes#planned-breaking-api-changes
