/**
 * SettingsPanel — slide-out right panel for runtime configuration.
 * Persisted via IPC → main process → SQLite config table.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import {
  applyLocalePreference,
  type LocalePreference,
} from '../i18n';

interface Settings {
  maptiler_key?: string;
  java_heap?: '4g' | '6g' | '8g';
  output_dir?: string;
  locale?: LocalePreference;
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const setBasemapId = useAppStore((s) => s.setBasemapId);

  const [settings, setSettings] = useState<Settings>({ java_heap: '6g', locale: 'system' });
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
        const loc = d.locale;
        setSettings({
          maptiler_key: (d.maptiler_key as string) ?? '',
          java_heap: (d.java_heap as Settings['java_heap']) ?? '6g',
          output_dir: (d.output_dir as string) ?? '',
          locale:
            loc === 'zh-CN' || loc === 'en' || loc === 'system'
              ? loc
              : 'system',
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
      if (k === 'locale') {
        await window.api.setConfig(k, v ?? 'system');
        continue;
      }
      if (v != null && v !== '') await window.api.setConfig(k, v);
    }
    await applyLocalePreference(settings.locale ?? 'system');
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
          <h2 className="text-lg font-semibold">⚙ {t('settings.title')}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5 text-sm">
          <section>
            <h3 className="font-medium text-base mb-2">{t('settings.language')}</h3>
            <p className="text-xs text-slate-500 mb-2">{t('settings.languageHint')}</p>
            <select
              className="w-full px-2 py-1.5 border border-slate-300 rounded"
              value={settings.locale ?? 'system'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  locale: e.target.value as LocalePreference,
                })
              }
            >
              <option value="system">{t('settings.localeSystem')}</option>
              <option value="zh-CN">{t('settings.localeZh')}</option>
              <option value="en">{t('settings.localeEn')}</option>
            </select>
          </section>

          <section>
            <h3 className="font-medium text-base mb-2">🔑 {t('settings.maptilerTitle')}</h3>
            <p className="text-xs text-slate-500 mb-2">
              {t('settings.maptilerHint')}{' '}
              <a
                className="text-blue-600 hover:underline"
                href="https://maptiler.com/cloud/"
                target="_blank"
                rel="noreferrer"
              >
                maptiler.com
              </a>
            </p>
            <input
              type="password"
              placeholder={t('settings.maptilerPlaceholder')}
              className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-xs"
              value={settings.maptiler_key ?? ''}
              onChange={(e) => setSettings({ ...settings, maptiler_key: e.target.value })}
            />
            <button
              onClick={() => setBasemapId('maptiler-streets')}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              → {t('settings.useMaptilerBasemap')}
            </button>
          </section>

          <section>
            <h3 className="font-medium text-base mb-2">☕ {t('settings.javaHeapTitle')}</h3>
            <p className="text-xs text-slate-500 mb-2">{t('settings.javaHeapHint')}</p>
            <select
              className="w-full px-2 py-1.5 border border-slate-300 rounded"
              value={settings.java_heap ?? '6g'}
              onChange={(e) =>
                setSettings({ ...settings, java_heap: e.target.value as Settings['java_heap'] })
              }
            >
              <option value="4g">{t('settings.javaHeap4g')}</option>
              <option value="6g">{t('settings.javaHeap6g')}</option>
              <option value="8g">{t('settings.javaHeap8g')}</option>
            </select>
          </section>

          <section>
            <h3 className="font-medium text-base mb-2">📁 {t('settings.outputTitle')}</h3>
            <p className="text-xs text-slate-500 mb-2">{t('settings.outputHint')}</p>
            <div className="flex gap-2">
              <input
                className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded font-mono text-xs"
                value={settings.output_dir ?? ''}
                onChange={(e) => setSettings({ ...settings, output_dir: e.target.value })}
                placeholder={t('settings.outputPlaceholder')}
              />
              <button
                type="button"
                className="shrink-0 w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                title={t('settings.pickDir')}
                aria-label={t('settings.pickDir')}
                onClick={async () => {
                  const r = await window.api.pickDirectory();
                  if (!r.ok) {
                    alert(t('settings.pickDirFailed', { error: r.error }));
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
                {t('settings.currentWritePath', { path: resolvedOutputDir })}
              </p>
            )}
          </section>

          <div className="sticky bottom-0 bg-white pt-2">
            <button
              onClick={handleSave}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
            >
              {saved ? `✓ ${t('settings.saved')}` : `💾 ${t('settings.save')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
