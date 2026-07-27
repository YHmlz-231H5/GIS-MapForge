import { useEffect, useState } from 'react';
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
import appLogo from './assets/mountain-river.png';

const APP_VERSION = '0.1.0';
const LEFT_PANEL_W = 320;
const RIGHT_PANEL_W = 360;

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [styleStudioOpen, setStyleStudioOpen] = useState(false);

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
      if (ver.ok) setVersion(ver.data ?? APP_VERSION);
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

  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 text-slate-900 overflow-hidden">
      <header className="relative z-30 border-b bg-white/95 backdrop-blur px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <img
            src={appLogo}
            alt=""
            className="h-8 w-8 rounded-md object-cover shadow-sm ring-1 ring-slate-200/80"
            draggable={false}
          />
          <h1 className="font-semibold">地图下载器</h1>
          <span className="text-xs text-slate-400 font-mono">v{version}</span>
        </div>
        <div className="text-xs text-slate-500 flex gap-3">
          <span>
            Java:{' '}
            <span className={javaPath ? 'text-emerald-600' : 'text-rose-600'}>
              {javaPath ? '✓' : '✗'}
            </span>
          </span>
          <span>
            Planetiler:{' '}
            <span className={planetilerJar ? 'text-emerald-600' : 'text-rose-600'}>
              {planetilerJar ? '✓' : '✗'}
            </span>
          </span>
          <button
            onClick={() => setStyleStudioOpen(true)}
            className="px-2 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded text-xs"
            data-testid="style-studio-button"
            title="矢量配图（本地 PMTiles）"
          >
            🎨 配图
          </button>
          <button
            onClick={() => setHelpOpen(true)}
            className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs"
            data-testid="help-button"
            title="使用说明与数据流程"
          >
            📖 说明
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs"
            data-testid="settings-button"
          >
            ⚙ 设置
          </button>
        </div>
      </header>

      <main className="relative flex-1 min-h-0 overflow-hidden">
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
          label="选区"
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
          label="任务"
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
    </div>
  );
}
