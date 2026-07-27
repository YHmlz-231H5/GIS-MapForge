# PC Map Downloader — Planning HTML Doc Template

This is a **HTML planning template** for "build me a PC/desktop app around the
existing offline-map toolchain". Last used and validated 2026-07-18 by the
user requesting "a PC 跨端带 UI 的程序来可视化 [the offline map download]
流程". The final app is `app-map-downloader/` next to `demo/`.

**Why a planning HTML doc (and not Markdown)**:
- The user explicitly said "先出一个规划文档 html 格式的，写出页面 UI" — they
  wanted mockups and UI structure visible before any code is written.
- HTML mockups communicate UI intent faster than paragraphs of description.
- The same file becomes the project README delivered to stakeholders.

**Reuse this template** when the user asks for any desktop wrapper, web UI,
or comparison doc around a non-trivial software component. The structure is
intentionally generic — replace placeholders + add/remove sections as
needed.

## How to apply

1. Copy `templates/pc-app-planning-doc.html` into a working directory.
2. Replace the placeholders at the top:
   - **A. 下载类型 / B. 交互 / C. 并发策略 / D. 技术栈 / E. 输出位置 / F. 联网要求**
3. Add or remove sections. The numbered `##` headings are stable layout —
   most users expect:
   - §1 Project overview
   - §2 Scope / locked-in requirements
   - §3 Personas & workflow
   - §4 UI mockup (FULL HTML with tailwind-style classes — required!)
   - §5 Detailed features
   - §6 Tech architecture & stack comparison (with comparison cards)
   - §7 Data flow (sequence diagram in code blocks)
   - §8 Storage / directory / SQLite schema
   - §9 Error handling
   - §10 Roadmap (7 weeks with phase gating)
   - §11 Next steps (the locked-in decisions still pending)
4. Embed `clarify()` calls OR an explicit "if you don't choose, here's the recommended default"
   for each open section.
5. Have the user review & confirm BEFORE writing any project code.

## Why this template works (lessons from 2026-07-18)

- **Locked-in specs come first** — §2 has a single table of axis:answer rows.
  Each axis is something that *must* be decided before design. Failing to
  lock them costs hours of redesign later.
- **Mockups over prose** — §4's `<div class="mockup">` blocks show actual
  UI flow before any code runs. The user gets to give specific feedback
  like "the task queue should be at bottom not right" without touching code.
- **Stack comparison is mandatory** — §6 shows 4 candidate stacks (Electron,
  Tauri, PyQt, MAUI) side-by-side, with a recommended default and explicit
  reasons. Locking the stack upfront prevents tool drift mid-build.
- **Phase 8a layer curation** is referenced — for any tool that handles
  PMTiles, the layer-set 6-question workflow reduces "include everything"
  defaults that the user has explicitly rejected.

## Common pitfalls when planning desktop apps

- **Don't promise offline-first if it isn't** — IPv6 LoRa mesh, BLE-tethered,
  satellite uplinks are special. Default to "needs internet" unless told
  otherwise.
- **Default task model**: heavy task mutex (Planetiler, large file
  downloads) + multiple light tasks (PBF tiles) running in parallel. The
  user explicitly asked for this in 2026-07-18 — single-threaded serial
  queues feel sluggish; unbounded parallel heavy tasks OOM the machine.
- **Pitfall IPC types** — contextBridge IpcResult<T> default `<T = unknown>`
  so handlers can return mixed types. Document the IPC contract as
  `shared/types.ts` and import in both preload + main.
- **Pitfall native deps** — better-sqlite3 / canvas / sharp / maplibre-gl all
  have native bindings; npm install can take 5+ min on Windows. Don't kill
  it prematurely.

## See also

- `references/pmtiles-layer-curator.md` — the
  Layer Curation pattern referenced by §2's transparent Planetiler
  constraint ("OpenMapTiles is monolithic, can't exclude layers from
  PMTiles file").
- `SKILL.md` — for the underlying map rendering
  pipeline the app will wrap.

(This template supersedes plain markdown plans for any non-trivial
desktop/wrapper project. Markdown is fine for code plans with
line-by-line directions; HTML is preferred when UI/UX is involved.)
