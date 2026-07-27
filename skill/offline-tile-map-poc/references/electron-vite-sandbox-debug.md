# Electron + Vite 沙箱调试工作流

**场景**: 你在 sandbox (headless, no Windows desktop) 写 Electron + Vite + React 应用, 没有 GUI 来跑 dev.

## 核心问题

`npm run dev` 启动 Electron BrowserWindow 需要 display server, sandbox 跑不了. 你只能 commit → 跑到 Windows → 看 console → 发现错 → 回 sandbox 改 → 循环.

这个 5 分钟循环非常痛苦, 实际上你只需要: **Playwright `_electron.launch()` 启动 headless Electron**.

## 工作流

### 1. 安装 (一次性)

```bash
npm i -D @playwright/test
```

不需要下载 Playwright Chromium (我们用 Electron 自带).

### 2. playwright.config.ts (12 行)

```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,        // Electron 不能多实例
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'test-results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
```

### 3. 第一个 e2e test (gpu-warnings.spec.ts)

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync } from 'fs';
import process from 'process';

const PROJECT_DIR = process.cwd();
const DIST_MAIN = `${PROJECT_DIR}/dist-electron/main/index.cjs`;

test('boots without SwiftShader / GroupMarker warnings', async () => {
  test.skip(!existsSync(DIST_MAIN), 'build first');
  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--no-sandbox'],
    cwd: PROJECT_DIR,
    env: { ...process.env, MAP_LOAD_FROM_DIST: '1' },
  });
  const win = await app.firstWindow({ timeout: 15_000 });
  const captured: { type: string; text: string }[] = [];
  win.on('console', (msg) => captured.push({ type: msg.type(), text: msg.text() }));
  win.on('pageerror', (e) => captured.push({ type: 'pageerror', text: String(e) }));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(3_000);
  // assert: no 'Automatic fallback to software WebGL' in captured
  await app.close();
});
```

### 4. **关键陷阱**: MAP_LOAD_FROM_DIST env var

`playwright._electron.launch(['.'])` 启动的 Electron 是 **unpackaged**, 所以 `app.isPackaged === false`, 你的 main code 走 dev 分支尝试 `loadURL(ELECTRON_RENDERER_URL)` — 但 vite dev server 没在跑!

**解**: 加 env var, main code 检查后强制走 `loadFile`:

```ts
// src/main/index.ts
if (isDev && process.env['ELECTRON_RENDERER_URL'] && !process.env.MAP_LOAD_FROM_DIST) {
  mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
} else {
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}
```

```ts
// e2e spec
env: { ...process.env, MAP_LOAD_FROM_DIST: '1' }
```

### 5. **另一个关键陷阱**: dist/index.html 静态资源路径

vite 6 默认 `base: '/'`, 输出 `<script src="/assets/...">`. Electron `loadFile` 用 `file://` 协议, `/assets/...` 解析为 filesystem root, 找不到.

**解**: vite.config.ts 顶层加 `base: './'`, **不放 build.base** (vite 6 不会读):

```ts
export default defineConfig({
  base: './',  // ← 顶层, 关键
  build: { outDir: 'dist', assetsDir: 'assets' },
});
```

输出变 `./assets/...`, `file://` 协议解析正确.

### 6. 交互式 e2e (搜索框测试)

```ts
const searchInput = win.locator('input[placeholder*="搜索"]').first();
await searchInput.fill('深圳');
await searchInput.press('Enter');
await win.waitForTimeout(6_000);  // Photon + DataV roundtrip
// 现在 captured[] 里有所有 console 错误
```

**加 debug dump helper** — 如果测试失败, 看到 `rootHasContent: 0` + `url: chrome-error://chromewebdata/`, 立刻知道是 dist 资源路径错.

## 典型 win condition

- 0 个 SwiftShader fallback warning
- 0 个 GroupMarkerNotSet warning
- 0 个 ReadPixels GPU stall
- 0 个 `Expected value to be of type number, but found null` (maplibre 5.8+)
- 1 个 CSP warning (Electron 33 内部, packaged 后消失)

## 完整 sample

参考 `app-map-downloader/e2e/gpu-warnings.spec.ts` (~120 行):
- boot Electron headless
- capture 全部 console 消息
- assert 已知 warning 字符串不存在
- JSON dump 报告到 stdout
