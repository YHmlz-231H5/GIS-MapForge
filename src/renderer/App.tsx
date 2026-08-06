import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { RegionPanel } from './components/RegionPanel';
import { MapView } from './components/MapView';
import { TaskQueue } from './components/TaskQueue';
import { LayerCurationDrawer } from './components/LayerCurationDrawer';
import { DownloadTypeDrawer } from './components/DownloadTypeDrawer';
import { SettingsPanel } from './components/SettingsPanel';
import { HelpGuidePanel } from './components/HelpGuidePanel';
import { FloatingSidePanel } from './components/FloatingSidePanel';
import { PmtilesPreviewPanel } from './components/PmtilesPreviewPanel';
import { RasterPreviewPanel } from './components/RasterPreviewPanel';
import { StyleStudioPanel } from './components/StyleStudioPanel';
import { TitleBar } from './components/TitleBar';
import appLogo from './assets/mountain-river.png';

const LEFT_PANEL_W = 320;
const RIGHT_PANEL_W = 360;

export default function App() {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [styleStudioOpen, setStyleStudioOpen] = useState(false);
  const [logoPreviewOpen, setLogoPreviewOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement>(null);

  const version = useAppStore((s) => s.version);
  const setVersion = useAppStore((s) => s.setVersion);
  const javaPath = useAppStore((s) => s.javaPath);
  const setJavaPath = useAppStore((s) => s.setJavaPath);
  const planetilerJar = useAppStore((s) => s.planetilerJar);
  const setPlanetilerJar = useAppStore((s) => s.setPlanetilerJar);
  const leftPanelOpen = useAppStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const pmtilesPreviewPath = useAppStore((s) => s.pmtilesPreviewPath);
  const pmtilesPreviewBbox = useAppStore((s) => s.pmtilesPreviewBbox);
  const openPmtilesPreview = useAppStore((s) => s.openPmtilesPreview);
  const rasterPreview = useAppStore((s) => s.rasterPreview);
  const openRasterPreview = useAppStore((s) => s.openRasterPreview);
  const setTaskHistoryOpen = useAppStore((s) => s.setTaskHistoryOpen);
  const taskCount = useAppStore((s) => s.tasks.filter((task) => !task.archived).length);

  useEffect(() => {
    const upsert = useAppStore.getState().upsertTask;
    const refresh = async () => {
      const [list, ver, java, jar] = await Promise.all([
        window.api.listTasks(),
        window.api.version(),
        window.api.detectJava(),
        window.api.resolvePlanetilerJar(),
      ]);
      if (list.ok && list.data) {
        useAppStore.setState((s) => {
          const live = new Map(s.tasks.map((t) => [t.id, t]));
          const merged = (list.data as typeof s.tasks).map((t) => {
            const prev = live.get(t.id);
            if (
              prev &&
              prev.status === 'running' &&
              (prev.progress?.ratio ?? 0) >= (t.progress?.ratio ?? 0) &&
              (prev.progress?.tiles?.length ?? 0) >= (t.progress?.tiles?.length ?? 0)
            ) {
              return {
                ...t,
                progress: prev.progress,
                status: prev.status,
              };
            }
            return t;
          });
          return { tasks: merged };
        });
      }
      if (ver.ok) setVersion(ver.data ?? '');
      if (java.ok && java.data) setJavaPath(java.data.path);
      if (jar.ok && jar.data) setPlanetilerJar(jar.data.path);
    };
    refresh();
    const offUpdate = window.api.subscribeTaskUpdates?.((task) => {
      upsert(task);
    });
    const t = setInterval(refresh, 5000);
    return () => {
      clearInterval(t);
      offUpdate?.();
    };
  }, [setVersion, setJavaPath, setPlanetilerJar]);

  // Side-panel dialogs still use position:fixed; keep them below the chrome.
  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty(
        '--app-chrome-height',
        `${Math.round(el.getBoundingClientRect().height)}px`
      );
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--app-chrome-height');
    };
  }, []);

  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 text-slate-900 overflow-hidden">
      <div ref={chromeRef} className="shrink-0 relative z-[60]">
        <TitleBar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenStyleStudio={() => setStyleStudioOpen(true)}
          onOpenTaskHistory={() => setTaskHistoryOpen(true)}
          onToggleLeftPanel={toggleLeftPanel}
          onToggleRightPanel={toggleRightPanel}
        />

        {/* pl/py match so toolbar logo has equal inset on all sides (8px). */}
        <header className="relative border-b bg-white/95 backdrop-blur py-2 pl-2 pr-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLogoPreviewOpen(true)}
              className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title={t('app.logoPreview')}
              data-testid="app-logo-button"
            >
              <img
                src={appLogo}
                alt={t('app.title')}
                className="h-8 w-8 rounded-md object-cover shadow-sm ring-1 ring-slate-200/80 hover:ring-sky-300 transition-[box-shadow]"
                draggable={false}
              />
            </button>
            <h1 className="font-semibold">{t('app.title')}</h1>
            <span className="text-xs text-slate-400 font-mono">v{version}</span>
          </div>
          <div className="text-xs text-slate-500 flex gap-3 items-center">
            <span>
              {t('app.java')}:{' '}
              <span className={javaPath ? 'text-emerald-600' : 'text-rose-600'}>
                {javaPath ? '✓' : '✗'}
              </span>
            </span>
            <span>
              {t('app.planetiler')}:{' '}
              <span className={planetilerJar ? 'text-emerald-600' : 'text-rose-600'}>
                {planetilerJar ? '✓' : '✗'}
              </span>
            </span>
            <button
              onClick={() => setStyleStudioOpen(true)}
              className="px-2 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded text-xs"
              data-testid="style-studio-button"
              title={t('app.styleStudioTitle')}
            >
              🎨 {t('app.styleStudio')}
            </button>
            <button
              onClick={() => setTaskHistoryOpen(true)}
              className="px-2 py-0.5 bg-violet-50 hover:bg-violet-100 text-violet-800 rounded text-xs inline-flex items-center gap-1"
              data-testid="task-history-button"
              title={t('app.allTasksTitle')}
            >
              📋 {t('app.allTasks')}
              {taskCount > 0 ? <span className="tabular-nums opacity-70">({taskCount})</span> : null}
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs"
              data-testid="help-button"
              title={t('app.helpTitle')}
            >
              📖 {t('app.help')}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs"
              data-testid="settings-button"
            >
              ⚙ {t('app.settings')}
            </button>
          </div>
        </header>
      </div>

      {/* Overlays are absolute here so they never cover TitleBar / toolbar / window controls. */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <main className="absolute inset-0 overflow-hidden">
          <MapView
            leftPanelOpen={leftPanelOpen}
            leftPanelWidth={LEFT_PANEL_W}
            rightPanelOpen={rightPanelOpen}
            rightPanelWidth={RIGHT_PANEL_W}
          />

          <FloatingSidePanel
            side="left"
            open={leftPanelOpen}
            onToggle={toggleLeftPanel}
            width={LEFT_PANEL_W}
            label={t('app.panelRegion')}
          >
            <div className="h-full overflow-y-auto thin-scroll">
              <RegionPanel />
            </div>
          </FloatingSidePanel>

          <FloatingSidePanel
            side="right"
            open={rightPanelOpen}
            onToggle={toggleRightPanel}
            width={RIGHT_PANEL_W}
            label={t('app.panelTasks')}
          >
            <TaskQueue />
          </FloatingSidePanel>
        </main>

        <LayerCurationDrawer />
        <DownloadTypeDrawer />
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <HelpGuidePanel open={helpOpen} onClose={() => setHelpOpen(false)} />
        <StyleStudioPanel open={styleStudioOpen} onClose={() => setStyleStudioOpen(false)} />
        <PmtilesPreviewPanel
          filePath={pmtilesPreviewPath}
          downloadBbox={pmtilesPreviewBbox}
          onClose={() => openPmtilesPreview(null)}
        />
        <RasterPreviewPanel target={rasterPreview} onClose={() => openRasterPreview(null)} />

        {logoPreviewOpen ? (
          <div
            className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
            onClick={() => setLogoPreviewOpen(false)}
            role="dialog"
            aria-label={t('app.logoPreview')}
          >
            <img
              src={appLogo}
              alt={t('app.title')}
              className="max-h-full max-w-full rounded-lg shadow-2xl object-contain bg-white"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
