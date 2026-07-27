# Self-Contained Project for GitHub Open-Source

## Principle

```
All runtime paths must resolve inside app-map-downloader/
→ Zero cross-directory references to parent project
→ Fork-and-run: clone, npm i, npm run dev
```

## Files that must be INSIDE the project

| File | Location | Size | Gitignored? |
|------|----------|------|-------------|
| `maplibre-gl.js/css` | `vendor/` | 1.1 MB | No (committed) |
| `pmtiles.js` | `vendor/` | 20 KB | No (committed) |
| `suppress-csp-warning.js` | `vendor/` | 722 B | No (committed) |
| `planetiler.jar` | `tools/` | 89 MB | **Yes** — user downloads |

## Cross-directory references to REMOVE

### 1. `src/main/ipc/system.ts`
```diff
- join(app.getAppPath(), '..', 'tools', 'planetiler.jar')
```
Only search inside `app-map-downloader/tools/`.

### 2. `src/main/tasks/handlers/planetiler-convert.ts`
```diff
- resolve(process.cwd(), '..', 'tools', 'planetiler.jar')
```
Only `process.cwd()/tools/planetiler.jar`.

## .gitignore additions

```
tools/planetiler.jar   # 89 MB, users download from planetiler releases
test-results/           # Playwright output
test-results.json
tsconfig.tsbuildinfo    # TypeScript incremental cache
```

## Files to DELETE before first commit

| File | Reason |
|------|--------|
| `test-results/` + `.json` | Playwright artifact |
| `test-tiles/` | Worker test output |
| `tsconfig.main.json` / `.preload.json` / `.shared.json` | Unreferenced |
| `tsconfig.tsbuildinfo` | TS cache |
| `src/shared/style-generator.ts` | Zero imports |
| `e2e/console-clean.spec.ts` / `submit-task.spec.ts` | Superseded by full-submit-flow |

## Final file count

56 source files, ~1.7 MB (excluding node_modules + planetiler.jar).

## README note for users

```
### Install Planetiler
Download planetiler.jar from https://github.com/onthegomap/planetiler/releases
Place it in tools/planetiler.jar
```
