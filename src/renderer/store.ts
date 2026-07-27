import { create } from 'zustand';
import type { Region, Task } from '../shared/types';

interface AppState {
  region: Region | null;
  setRegion: (r: Region | null) => void;

  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;

  layerDrawerOpen: boolean;
  /** Open Layer Curation for vector-tile convert; pass null to close. */
  openPmtilesCuration: (sourceTask: Task | null) => void;

  /** Completed OSM download task waiting for Planetiler options. */
  pendingConvertTask: Task | null;

  /** Download type chooser (vector OSM vs raster XYZ). */
  downloadDrawerOpen: boolean;
  openDownloadDrawer: () => void;
  closeDownloadDrawer: () => void;

  /** Local .pmtiles path open in preview modal */
  pmtilesPreviewPath: string | null;
  /** Download/clip bbox to draw on preview — [west,south,east,north] */
  pmtilesPreviewBbox: [number, number, number, number] | null;
  openPmtilesPreview: (
    path: string | null,
    bbox?: [number, number, number, number] | null
  ) => void;

  /** Local raster directory / MBTiles preview */
  rasterPreview: import('./components/RasterPreviewPanel').RasterPreviewTarget | null;
  openRasterPreview: (
    target: import('./components/RasterPreviewPanel').RasterPreviewTarget | null
  ) => void;

  version: string;
  setVersion: (v: string) => void;

  javaPath: string | null;
  setJavaPath: (p: string | null) => void;
  planetilerJar: string | null;
  setPlanetilerJar: (p: string | null) => void;

  // === Map style / basemap state ===
  basemapId: string;
  setBasemapId: (id: string) => void;
  basemapRanked: import('./lib/basemapHealth').ProbeResult[];
  setBasemapRanked: (r: import('./lib/basemapHealth').ProbeResult[]) => void;
  basemapReady: boolean;
  setBasemapReady: (b: boolean) => void;

  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;

  /** When true, finishing a terra-draw rectangle snaps to a geographic square. */
  drawPreferSquare: boolean;
  setDrawPreferSquare: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  region: null,
  setRegion: (r) => set({ region: r }),

  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) =>
    set((s) => {
      const i = s.tasks.findIndex((t) => t.id === task.id);
      if (i >= 0) {
        const next = [...s.tasks];
        next[i] = task;
        return { tasks: next };
      }
      return { tasks: [task, ...s.tasks] };
    }),

  layerDrawerOpen: false,
  pendingConvertTask: null,
  openPmtilesCuration: (sourceTask) =>
    set({
      pendingConvertTask: sourceTask,
      layerDrawerOpen: Boolean(sourceTask),
    }),

  downloadDrawerOpen: false,
  openDownloadDrawer: () => set({ downloadDrawerOpen: true }),
  closeDownloadDrawer: () => set({ downloadDrawerOpen: false }),

  pmtilesPreviewPath: null,
  pmtilesPreviewBbox: null,
  openPmtilesPreview: (path, bbox = null) =>
    set({
      pmtilesPreviewPath: path,
      pmtilesPreviewBbox: path ? bbox ?? null : null,
    }),

  rasterPreview: null,
  openRasterPreview: (rasterPreview) => set({ rasterPreview }),

  version: '0.1.0',
  setVersion: (v) => set({ version: v }),

  javaPath: null,
  setJavaPath: (p) => set({ javaPath: p }),
  planetilerJar: null,
  setPlanetilerJar: (p) => set({ planetilerJar: p }),

  // Basemap defaults — 'openfreemap-liberty' is a good default (CN + intl, no key).
  basemapId: 'openfreemap-liberty',
  setBasemapId: (basemapId) => set({ basemapId }),
  basemapRanked: [] as import('./lib/basemapHealth').ProbeResult[],
  setBasemapRanked: (basemapRanked) => set({ basemapRanked }),
  basemapReady: false,
  setBasemapReady: (basemapReady) => set({ basemapReady }),

  leftPanelOpen: true,
  rightPanelOpen: true,
  setLeftPanelOpen: (leftPanelOpen) => set({ leftPanelOpen }),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  drawPreferSquare: false,
  setDrawPreferSquare: (drawPreferSquare) => set({ drawPreferSquare }),
}));
