/**
 * SettingsPanel — slide-out right panel for runtime configuration.
 * Covers:
 *   - MapTiler API key (for vector basemaps that require it)
 *   - Default Java heap for Planetiler (4g / 6g / 8g)
 *   - Default output directory for downloaded PMTiles
 *   - Reset to defaults
 *
 * Persisted via IPC → main process → SQLite config table.
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '../store';

interface Settings {
  maptiler_key?: string;
  java_heap?: '4g' | '6g' | '8g';
  output_dir?: string;
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const basemapId = useAppStore((s) => s.basemapId);
  const setBasemapId = useAppStore((s) => s.setBasemapId);

  const [settings, setSettings] = useState<Settings>({ java_heap: '6g' });
  const [saved, setSaved] = useState(false);
  const [resolvedOutputDir, setResolvedOutputDir] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [cfg, resolved] = await Promise.all([
        window.api.getConfig(),
        window.api.resolveOutputDir(),
      ]);
      if (cfg.ok && cfg.data) {
        const d = cfg.data as Record<string, unknown>;
        setSettings({
          maptiler_key: (d.maptiler_key as string) ?? '',
          java_heap: (d.java_heap as Settings['java_heap']) ?? '6g',
          output_dir: (d.output_dir as string) ?? '',
        });
      }
      if (resolved.ok && resolved.data) setResolvedOutputDir(resolved.data);
    })();
  }, [open]);

  const handleSave = async () => {
    for (const [k, v] of Object.entries(settings)) {
      if (k === 'output_dir') {
        await window.api.setConfig(k, String(v ?? '').trim());
        continue;
      }
      if (v != null && v !== '') await window.api.setConfig(k, v);
    }
    const resolved = await window.api.resolveOutputDir();
    if (resolved.ok && resolved.data) setResolvedOutputDir(resolved.data);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl">
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-semibold">⚙ 设置</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        <div className="p-4 space-y-5 text-sm">
          {/* MapTiler key section */}
          <section>
            <h3 className="font-medium text-base mb-2">🔑 MapTiler API key</h3>
            <p className="text-xs text-slate-500 mb-2">
              必填 for MapTiler Streets / Outdoor vector basemaps. 注册{' '}
              <a className="text-blue-600 hover:underline" href="https://maptiler.com/cloud/" target="_blank">maptiler.com</a>{' '}
              免费获得。
            </p>
            <input
              type="password"
              placeholder="您的 MapTiler  key (例如 get_your_own_OpIi9...)"
              className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-xs"
              value={settings.maptiler_key ?? ''}
              onChange={(e) => setSettings({ ...settings, maptiler_key: e.target.value })}
            />
            <button
              onClick={() => setBasemapId('maptiler-streets')}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              → 使用 MapTiler 作为当前底图
            </button>
          </section>

          {/* Java heap */}
          <section>
            <h3 className="font-medium text-base mb-2">☕ Planetiler Java heap</h3>
            <p className="text-xs text-slate-500 mb-2">
              小区域 (148 km²) 用 4g. 大区域 (Australia) 推荐 6g+. 32 GB+ RAM 选 8g.
            </p>
            <select
              className="w-full px-2 py-1.5 border border-slate-300 rounded"
              value={settings.java_heap ?? '6g'}
              onChange={(e) =>
                setSettings({ ...settings, java_heap: e.target.value as Settings['java_heap'] })
              }
            >
              <option value="4g">4 GB — 已验证适用于 &lt;300 km²</option>
              <option value="6g">6 GB — 完整 Australia (默认)</option>
              <option value="8g">8 GB — 32 GB+ 工作站</option>
            </select>
          </section>

          {/* Output directory */}
          <section>
            <h3 className="font-medium text-base mb-2">📁 输出目录</h3>
            <p className="text-xs text-slate-500 mb-2">
              OSM 下载（.osm）与 PMTiles 都写入此目录。留空则使用 AppData 下的默认目录。
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded font-mono text-xs"
                value={settings.output_dir ?? ''}
                onChange={(e) => setSettings({ ...settings, output_dir: e.target.value })}
                placeholder="例如 D:\Maps\output"
              />
              <button
                type="button"
                className="shrink-0 w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                title="选择目录"
                aria-label="选择目录"
                onClick={async () => {
                  const r = await window.api.pickDirectory();
                  if (!r.ok) {
                    alert(`选择目录失败: ${r.error}`);
                    return;
                  }
                  if (r.data) {
                    setSettings((s) => ({ ...s, output_dir: r.data! }));
                  }
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </button>
            </div>
            {resolvedOutputDir && (
              <p className="text-[10px] text-slate-500 mt-1.5 font-mono break-all">
                当前实际写入：{resolvedOutputDir}
              </p>
            )}
          </section>

          {/* Action */}
          <div className="sticky bottom-0 bg-white pt-2">
            <button
              onClick={handleSave}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
            >
              {saved ? '✓ 已保存' : '💾 保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
