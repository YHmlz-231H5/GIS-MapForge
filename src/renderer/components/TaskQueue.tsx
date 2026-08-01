import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { Task, TaskLogLine, TaskStatus } from '../../shared/types';
import { useAppStore } from '../store';
import i18n, { formatLocalizedTime } from '../i18n';

const SIDEBAR_TASK_LIMIT = 12;
const HISTORY_PAGE_SIZE = 12;

export function TaskQueue() {
  const { t } = useTranslation();
  const tasks = useAppStore((s) => s.tasks);
  const historyOpen = useAppStore((s) => s.taskHistoryOpen);
  const setHistoryOpen = useAppStore((s) => s.setTaskHistoryOpen);
  const [selectedLogTask, setSelectedLogTask] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<TaskLogLine[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [packTarget, setPackTarget] = useState<Task | null>(null);
  const [packBusy, setPackBusy] = useState(false);

  useEffect(() => {
    const off = (window as any).api?.subscribeTaskLogs?.('*', (line: TaskLogLine) => {
      setLogLines((prev) => [...prev.slice(-200), line]);
    });
    return off;
  }, []);

  const refreshTasks = async () => {
    const r = await window.api.listTasks();
    if (r.ok && r.data) useAppStore.setState({ tasks: r.data });
  };

  const onRefreshClick = async () => {
    setRefreshing(true);
    try {
      await refreshTasks();
    } finally {
      setRefreshing(false);
    }
  };

  const clearCompleted = async () => {
    await window.api.clearCompletedTasks();
    await refreshTasks();
  };

  const clearAll = async () => {
    if (!confirm(t('tasks.clearAllConfirm'))) return;
    await window.api.clearAllTasks();
    await refreshTasks();
  };

  const confirmDelete = async (deleteFiles: boolean) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await window.api.deleteTask(deleteTarget.id, { deleteFiles });
      if (!r.ok) {
        alert(`删除失败: ${r.error}`);
        return;
      }
      if (deleteFiles && r.data?.fileErrors?.length) {
        alert(
          `任务已删除，但部分文件未能清除：\n${r.data.fileErrors.slice(0, 5).join('\n')}`
        );
      }
      setDeleteTarget(null);
      await refreshTasks();
    } finally {
      setDeleting(false);
    }
  };

  const cancelTask = async (id: string) => {
    await window.api.cancelTask(id);
    await refreshTasks();
  };

  const resumeTask = async (id: string) => {
    const r = await window.api.resumeTask(id);
    if (!r.ok) {
      alert(`无法继续任务: ${r.error}`);
      return;
    }
    await refreshTasks();
  };

  const convertToPmtiles = (task: Task) => {
    if (!task.output_path) {
      alert('该任务没有输出文件，无法转换');
      return;
    }
    const tiles = task.progress?.tiles;
    if (Array.isArray(tiles) && tiles.length > 0) {
      const bad = tiles.filter((t) => t.status !== 'done');
      if (bad.length > 0) {
        alert(
          `下载格子未全部成功（${bad.filter((t) => t.status === 'failed').length} 失败 / ${bad.length} 未完成）。请先点「重试失败格」补全后再「矢量数据切片打包」，否则地图会出现空洞/分界。`
        );
        return;
      }
    }
    useAppStore.getState().openPmtilesCuration(task);
  };

  const resolveRasterTileDir = (task: Task): string | null => {
    if (typeof task.metadata?.tile_dir === 'string' && task.metadata.tile_dir) {
      return task.metadata.tile_dir;
    }
    const p = task.output_path;
    if (!p) return null;
    const lower = p.toLowerCase();
    if (lower.endsWith('.mbtiles') || lower.endsWith('.pmtiles')) return null;
    return p;
  };

  const packRaster = async (task: Task, archive: 'mbtiles' | 'pmtiles') => {
    const tileDir = resolveRasterTileDir(task);
    if (!tileDir) {
      alert('找不到瓦片目录（tile_dir），无法打包');
      return;
    }
    const rs = task.options.raster_source;
    const metaFmt = typeof task.metadata?.format === 'string' ? task.metadata.format : null;
    const format = (rs?.format ?? metaFmt ?? 'png') as 'png' | 'jpeg' | 'webp';
    setPackBusy(true);
    try {
      const r = await window.api.submitTask({
        kind: 'raster-pack-archive',
        region: task.region,
        options: {
          raster_pack: {
            tile_dir: tileDir,
            archive,
            format: format === 'jpeg' ? 'jpeg' : format === 'webp' ? 'webp' : 'png',
            attribution:
              rs?.attribution ??
              (typeof task.metadata?.attribution === 'string' ? task.metadata.attribution : ''),
            source_id:
              rs?.source_id ??
              (typeof task.metadata?.source_id === 'string' ? task.metadata.source_id : 'raster'),
            min_zoom:
              rs?.min_zoom ??
              (typeof task.metadata?.min_zoom === 'number' ? task.metadata.min_zoom : 0),
            max_zoom:
              rs?.max_zoom ??
              (typeof task.metadata?.max_zoom === 'number' ? task.metadata.max_zoom : 20),
            bbox: task.region.bbox,
          },
        },
      });
      if (!r.ok) {
        alert(`提交打包失败: ${r.error}`);
        return;
      }
      setPackTarget(null);
      await refreshTasks();
    } finally {
      setPackBusy(false);
    }
  };

  const previewRaster = (task: Task) => {
    const out = task.output_path;
    const tileDir = resolveRasterTileDir(task);
    const fmtRaw =
      task.options.raster_source?.format ??
      (typeof task.metadata?.format === 'string' ? task.metadata.format : 'png');
    const format = (fmtRaw === 'jpeg' ? 'jpg' : fmtRaw) as 'png' | 'jpg' | 'webp';
    const selectionGeojson =
      task.region.boundary_geojson ?? task.region.imported_geojson ?? null;
    if (out?.toLowerCase().endsWith('.pmtiles')) {
      useAppStore.getState().openPmtilesPreview(out, task.region.bbox);
      return;
    }
    useAppStore.getState().openRasterPreview({
      tileDir: out?.toLowerCase().endsWith('.mbtiles') ? null : tileDir,
      mbtilesPath: out?.toLowerCase().endsWith('.mbtiles') ? out : null,
      format,
      minZoom:
        task.options.raster_source?.min_zoom ??
        (typeof task.metadata?.min_zoom === 'number' ? task.metadata.min_zoom : 0),
      maxZoom:
        task.options.raster_source?.max_zoom ??
        (typeof task.metadata?.max_zoom === 'number' ? task.metadata.max_zoom : 20),
      attribution:
        task.options.raster_source?.attribution ??
        (typeof task.metadata?.attribution === 'string' ? task.metadata.attribution : ''),
      bbox: task.region.bbox,
      selectionGeojson,
    });
  };

  const openOutput = async (task: Task) => {
    // Prefer final file → task's output_dir → Settings output dir.
    // Never open the internal .tile-cache folder for this button.
    const outputDir = typeof task.metadata?.output_dir === 'string' ? task.metadata.output_dir : null;
    const path = task.output_path || outputDir;
    if (path) {
      const r = await window.api.openFolder(path);
      if (!r.ok) alert(`无法打开文件夹: ${r.error}`);
      return;
    }
    const resolved = await window.api.resolveOutputDir();
    if (!resolved.ok || !resolved.data) {
      alert(`无法解析输出目录: ${resolved.error ?? 'unknown'}`);
      return;
    }
    const r = await window.api.openFolder(resolved.data);
    if (!r.ok) alert(`无法打开文件夹: ${r.error}`);
  };

  const taskCardProps = (t: Task) => ({
    task: t,
    onCancel: () => cancelTask(t.id),
    onResume: () => resumeTask(t.id),
    onRemove: () => setDeleteTarget(t),
    onShowLog: () => setSelectedLogTask(t.id),
    onConvert: () => convertToPmtiles(t),
    onOpenFolder: () => openOutput(t),
    onPreview: () => {
      if (t.output_path?.toLowerCase().endsWith('.pmtiles')) {
        const clip =
          t.options.planetiler_form?.bbox_clip ?? t.options.planetiler?.bbox_clip ?? null;
        const bbox = t.region?.bbox ?? clip;
        useAppStore.getState().openPmtilesPreview(t.output_path, bbox);
      }
    },
    onPackRaster: () => setPackTarget(t),
    onPreviewRaster: () => previewRaster(t),
  });

  return (
    <div className="flex flex-col h-full min-h-0 text-sm">
      <div className="flex-1 min-h-0 overflow-y-auto thin-scroll p-3 space-y-2">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="font-semibold text-base">📋 {t('tasks.title')}</h2>
            <button
              type="button"
              className="shrink-0 p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              title={t('tasks.refresh')}
              aria-label={t('tasks.refresh')}
              disabled={refreshing}
              onClick={onRefreshClick}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex gap-1 shrink-0">
            <button className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded border" onClick={clearCompleted}>
              {t('tasks.clearCompleted')}
            </button>
            <button
              className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 rounded border border-red-200 text-red-700"
              onClick={clearAll}
              disabled={!tasks.length}
            >
              {t('tasks.clearAll')}
            </button>
          </div>
        </div>

        {tasks.length === 0 && (
          <div className="text-xs text-slate-400 py-8 text-center">{t('tasks.empty')}</div>
        )}

        <div className="space-y-2">
          {tasks.slice(0, SIDEBAR_TASK_LIMIT).map((task) => (
            <TaskCard key={task.id} {...taskCardProps(task)} />
          ))}
        </div>

        {tasks.length > SIDEBAR_TASK_LIMIT && (
          <button
            type="button"
            className="w-full text-[11px] py-1.5 rounded border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400"
            onClick={() => setHistoryOpen(true)}
          >
            {t('tasks.moreOpenAll', { count: tasks.length - SIDEBAR_TASK_LIMIT })}
          </button>
        )}

        {packTarget &&
          createPortal(
            <div className="fixed inset-0 z-[210] bg-black/40 flex items-center justify-center p-3">
              <div className="bg-white w-full max-w-sm rounded-lg shadow-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{t('tasks.packRasterTitle')}</h3>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">{packTarget.region.name}</p>
                  </div>
                  <button
                    type="button"
                    className="text-slate-500 hover:text-slate-800"
                    onClick={() => setPackTarget(null)}
                    disabled={packBusy}
                  >
                    ✕
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">{t('tasks.packRasterHint')}</p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={packBusy}
                    className="text-left px-3 py-2.5 rounded-lg border-2 border-slate-200 hover:border-amber-500 hover:bg-amber-50 disabled:opacity-50"
                    onClick={() => packRaster(packTarget, 'mbtiles')}
                  >
                    <div className="text-sm font-semibold">MBTiles</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{t('tasks.mbtilesHint')}</div>
                  </button>
                  <button
                    type="button"
                    disabled={packBusy}
                    className="text-left px-3 py-2.5 rounded-lg border-2 border-slate-200 hover:border-violet-500 hover:bg-violet-50 disabled:opacity-50"
                    onClick={() => packRaster(packTarget, 'pmtiles')}
                  >
                    <div className="text-sm font-semibold">PMTiles</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{t('tasks.pmtilesHint')}</div>
                  </button>
                </div>
                {packBusy && <p className="text-[11px] text-slate-500">{t('tasks.packSubmitting')}</p>}
              </div>
            </div>,
            document.body
          )}

        {selectedLogTask && (
          <div className="mt-3 border rounded p-2 bg-slate-900 text-slate-100 text-[10px] font-mono max-h-48 overflow-auto">
            <div className="flex justify-between mb-1">
              <span>实时日志 · {selectedLogTask.slice(0, 8)}</span>
              <button className="text-slate-400 hover:text-white" onClick={() => setSelectedLogTask(null)}>
                ✕
              </button>
            </div>
            {logLines
              .filter((l) => l.task_id === selectedLogTask)
              .slice(-50)
              .map((l, i) => (
                <div key={i} className={l.stream === 'err' ? 'text-rose-300' : 'text-slate-200'}>
                  {l.line}
                </div>
              ))}
          </div>
        )}
      </div>

      {deleteTarget &&
        createPortal(
          <DeleteTaskDialog
            task={deleteTarget}
            busy={deleting}
            onCancel={() => !deleting && setDeleteTarget(null)}
            onDeleteTaskOnly={() => confirmDelete(false)}
            onDeleteWithFiles={() => confirmDelete(true)}
          />,
          document.body
        )}

      {historyOpen &&
        createPortal(
          <TaskHistoryDialog
            tasks={tasks}
            onClose={() => setHistoryOpen(false)}
            onRefresh={async () => {
              await refreshTasks();
            }}
            actionsFor={(t) => ({
              onCancel: () => cancelTask(t.id),
              onResume: () => resumeTask(t.id),
              onRemove: () => setDeleteTarget(t),
              onConvert: () => convertToPmtiles(t),
              onOpenFolder: () => openOutput(t),
              onPreview: () => {
                if (t.output_path?.toLowerCase().endsWith('.pmtiles')) {
                  const clip =
                    t.options.planetiler_form?.bbox_clip ?? t.options.planetiler?.bbox_clip ?? null;
                  const bbox = t.region?.bbox ?? clip;
                  useAppStore.getState().openPmtilesPreview(t.output_path, bbox);
                }
              },
              onPackRaster: () => setPackTarget(t),
              onPreviewRaster: () => previewRaster(t),
            })}
          />,
          document.body
        )}

      <DownloadSpeedBar tasks={tasks} />
    </div>
  );
}

function summarizeDeletePaths(task: Task): string[] {
  const paths: string[] = [];
  if (task.output_path) paths.push(task.output_path);
  const tileDir = task.metadata?.tile_dir;
  if (typeof tileDir === 'string' && tileDir) paths.push(tileDir);
  if (task.log_path) paths.push(task.log_path);
  return paths;
}

function DeleteTaskDialog({
  task,
  busy,
  onCancel,
  onDeleteTaskOnly,
  onDeleteWithFiles,
}: {
  task: Task;
  busy: boolean;
  onCancel: () => void;
  onDeleteTaskOnly: () => void;
  onDeleteWithFiles: () => void;
}) {
  const { t } = useTranslation();
  const paths = summarizeDeletePaths(task);
  return (
    <div
      className="fixed inset-0 z-[210] bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="delete-task-title"
      >
        <h3 id="delete-task-title" className="text-sm font-semibold text-slate-900">
          {t('tasks.deleteTitle')}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          <span className="font-medium text-slate-800">{labelFor(task.kind)}</span>
          {' · '}
          {task.region.name}
        </p>
        {paths.length > 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-2 max-h-28 overflow-auto">
            <div className="text-[10px] text-slate-500 mb-1">{t('tasks.relatedPaths')}</div>
            <ul className="text-[10px] font-mono text-slate-700 space-y-0.5 break-all">
              {paths.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[10px] text-slate-400">{t('tasks.noPaths')}</p>
        )}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            className="w-full text-xs px-3 py-2 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
            onClick={onDeleteTaskOnly}
          >
            {t('tasks.deleteTaskOnly')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="w-full text-xs px-3 py-2 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 font-medium disabled:opacity-50"
            onClick={onDeleteWithFiles}
          >
            {t('tasks.deleteWithFiles')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="w-full text-xs px-3 py-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-50"
            onClick={onCancel}
          >
            {t('tasks.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskHistoryDialog({
  tasks,
  onClose,
  onRefresh,
  actionsFor,
}: {
  tasks: Task[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  actionsFor: (t: Task) => Omit<TaskActionHandlers, 'onShowLog'>;
}) {
  const { t } = useTranslation();
  type StatusFilter = 'all' | TaskStatus;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return tasks;
    return tasks.filter((task) => task.status === statusFilter);
  }, [tasks, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (safePage - 1) * HISTORY_PAGE_SIZE,
    safePage * HISTORY_PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: t('tasks.filterAll') },
    { id: 'running', label: t('tasks.filterRunning') },
    { id: 'queued', label: t('tasks.filterQueued') },
    { id: 'done', label: t('tasks.filterDone') },
    { id: 'failed', label: t('tasks.filterFailed') },
    { id: 'killed', label: t('tasks.filterKilled') },
    { id: 'cancelled', label: t('tasks.filterCancelled') },
  ];

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/40 flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-labelledby="task-history-title"
    >
      <div
        className="flex-1 m-2 md:m-3 bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h2 id="task-history-title" className="text-base font-semibold">
              {t('tasks.historyTitle')}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t('tasks.historySummary', { total: tasks.length })}
              {statusFilter !== 'all' ? t('tasks.historyFiltered', { count: filtered.length }) : ''}
              {t('tasks.historyPerPage', { size: HISTORY_PAGE_SIZE })}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className="p-1.5 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              title={t('common.refresh')}
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await onRefresh();
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" className="text-slate-500 hover:text-slate-800 px-2" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b bg-slate-50 flex flex-wrap gap-1 shrink-0">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`text-[11px] px-2 py-1 rounded border ${
                statusFilter === f.id
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full overflow-y-auto thin-scroll p-3">
            {pageItems.length === 0 ? (
              <div className="text-xs text-slate-400 py-12 text-center">{t('tasks.historyEmpty')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[11px] border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10 bg-white border-b">
                    <tr>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">{t('tasks.colStart')}</th>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">{t('tasks.colTask')}</th>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">{t('tasks.colType')}</th>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">{t('tasks.colZoom')}</th>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">{t('tasks.colStatus')}</th>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">{t('tasks.colProgress')}</th>
                      <th className="text-left font-semibold px-2 py-2 whitespace-nowrap min-w-[220px]">
                        {t('tasks.colActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((task) => {
                      const pct = Math.round((task.progress?.ratio ?? 0) * 100);
                      const phase = task.progress?.phase ?? '—';
                      const zoom = zoomRangeFor(task);
                      const startTs = task.started_at ?? task.created_at;
                      const archive = labelForArchive(task);
                      return (
                        <tr key={task.id} className="border-b hover:bg-slate-50 align-top">
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600">
                            {startTs ? formatTaskTime(startTs) : '—'}
                          </td>
                          <td className="px-2 py-2 max-w-[200px]">
                            <div className="font-medium truncate" title={task.region.name}>
                              {task.region.name}
                            </div>
                            {task.error && task.status !== 'done' ? (
                              <div className="text-[10px] text-rose-600 truncate mt-0.5" title={task.error}>
                                {task.error}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-1">
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${kindTone(task.kind)}`}
                              >
                                {labelFor(task.kind)}
                              </span>
                              {archive ? (
                                <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                  {archive}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {zoom ? (
                              <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-800 border border-indigo-100">
                                {t('tasks.zoomTab', { min: zoom.min, max: zoom.max })}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <StatusBadge status={task.status} />
                          </td>
                          <td className="px-2 py-2">
                            <div className="font-mono text-[10px] text-slate-700 truncate" title={phase}>
                              {phase}
                            </div>
                            <div className="text-[10px] text-slate-500 tabular-nums">{pct}%</div>
                          </td>
                          <td className="px-2 py-2">
                            <TaskActionButtons
                              task={task}
                              showLog={false}
                              showDetails={false}
                              {...actionsFor(task)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-2.5 border-t flex items-center justify-between gap-2 shrink-0 bg-white">
          <span className="text-[11px] text-slate-500 tabular-nums">
            {t('tasks.page', { page: safePage, total: totalPages })}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t('tasks.prevPage')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t('tasks.nextPage')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadSpeedBar({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation();
  const running = tasks.find(
    (task) =>
      task.status === 'running' &&
      (task.kind === 'pbf-download-osm-api' ||
        task.kind === 'pbf-download-geofabrik' ||
        task.kind === 'raster-download-xyz')
  );
  const [speed, setSpeed] = useState(0);
  const lastRef = useRef<{ bytes: number; ts: number; taskId: string } | null>(null);

  useEffect(() => {
    if (!running) {
      lastRef.current = null;
      setSpeed(0);
      return;
    }
    const bytes = running.progress?.bytes ?? 0;
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.taskId === running.id && bytes >= last.bytes) {
      const dt = (now - last.ts) / 1000;
      if (dt >= 0.5) {
        setSpeed((bytes - last.bytes) / dt);
        lastRef.current = { bytes, ts: now, taskId: running.id };
      }
    } else {
      lastRef.current = { bytes, ts: now, taskId: running.id };
    }
  }, [running?.id, running?.progress?.bytes, running?.progress?.ratio]);

  return (
    <div className="shrink-0 border-t border-slate-200/90 bg-white/95 backdrop-blur-sm px-3 py-2 text-[10px] text-slate-600 flex items-center justify-between gap-2">
      <span className="text-slate-500 shrink-0">{t('tasks.downloadSpeed')}</span>
      {running ? (
        <span className="font-mono tabular-nums text-right truncate">
          <span className="text-emerald-600">↓ {formatSpeed(speed)}</span>
          {running.progress?.bytes ? (
            <span className="text-slate-500"> · {formatBytes(running.progress.bytes)}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-slate-400">{t('tasks.idle')}</span>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0 || !Number.isFinite(bps)) return '—';
  return `${formatBytes(bps)}/s`;
}

type TaskActionHandlers = {
  onCancel: () => void;
  onResume: () => void;
  onRemove: () => void;
  onConvert: () => void;
  onOpenFolder: () => void;
  onPreview: () => void;
  onPackRaster: () => void;
  onPreviewRaster: () => void;
  onShowLog?: () => void;
};

function taskActionFlags(task: Task) {
  const canResume = task.status === 'killed' || task.status === 'failed' || task.status === 'cancelled';
  const failedTileCount =
    task.kind === 'pbf-download-osm-api'
      ? task.progress?.tiles?.filter((t) => t.status === 'failed').length ?? 0
      : 0;
  const pendingTileCount =
    task.kind === 'pbf-download-osm-api'
      ? task.progress?.tiles?.filter((t) => t.status === 'pending').length ?? 0
      : 0;
  const hasTileHoles = failedTileCount > 0 || pendingTileCount > 0;
  const folderHint =
    task.output_path ||
    (typeof task.metadata?.output_dir === 'string' ? task.metadata.output_dir : null);
  const isRasterDownloadDone = task.kind === 'raster-download-xyz' && task.status === 'done';
  const isRasterPackDone = task.kind === 'raster-pack-archive' && task.status === 'done';
  const rasterTileDir =
    typeof task.metadata?.tile_dir === 'string'
      ? task.metadata.tile_dir
      : task.output_path &&
          !task.output_path.toLowerCase().endsWith('.mbtiles') &&
          !task.output_path.toLowerCase().endsWith('.pmtiles')
        ? task.output_path
        : null;
  const canPackRaster = isRasterDownloadDone && Boolean(rasterTileDir);
  const outLower = task.output_path?.toLowerCase() ?? '';
  const canPreviewPmtiles = task.status === 'done' && outLower.endsWith('.pmtiles');
  const canPreviewRaster =
    (isRasterDownloadDone || isRasterPackDone) &&
    (outLower.endsWith('.mbtiles') || Boolean(rasterTileDir) || canPreviewPmtiles);
  const canConvert =
    (task.kind === 'pbf-download-osm-api' || task.kind === 'pbf-download-geofabrik') &&
    task.status === 'done' &&
    !hasTileHoles;
  const canDelete =
    task.status === 'done' ||
    task.status === 'failed' ||
    task.status === 'killed' ||
    task.status === 'cancelled';

  return {
    canResume,
    hasTileHoles,
    failedTileCount,
    pendingTileCount,
    folderHint,
    canPackRaster,
    canPreviewPmtiles,
    canPreviewRaster,
    canConvert,
    canDelete,
  };
}

function TaskActionButtons({
  task,
  showLog = true,
  showDetails = false,
  detailsExpanded,
  onToggleDetails,
  onCancel,
  onResume,
  onRemove,
  onConvert,
  onOpenFolder,
  onPreview,
  onPackRaster,
  onPreviewRaster,
  onShowLog,
}: TaskActionHandlers & {
  task: Task;
  showLog?: boolean;
  showDetails?: boolean;
  detailsExpanded?: boolean;
  onToggleDetails?: () => void;
}) {
  const { t } = useTranslation();
  const f = taskActionFlags(task);

  return (
    <div className="flex flex-wrap gap-1">
      {showDetails && onToggleDetails ? (
        <button
          className="text-[10px] px-1 py-0.5 bg-slate-100 hover:bg-slate-200 rounded"
          onClick={onToggleDetails}
        >
          {detailsExpanded ? t('tasks.collapse') : t('tasks.details')}
        </button>
      ) : null}
      {showLog && onShowLog ? (
        <button
          className="text-[10px] px-1 py-0.5 bg-slate-100 hover:bg-slate-200 rounded"
          onClick={onShowLog}
        >
          {t('tasks.log')}
        </button>
      ) : null}
      {task.status === 'running' && (
        <button
          className="text-[10px] px-1 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded"
          onClick={onCancel}
        >
          {t('tasks.stop')}
        </button>
      )}
      {f.canResume && (
        <button
          className="text-[10px] px-1.5 py-0.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded font-medium"
          onClick={onResume}
        >
          {f.hasTileHoles ? t('tasks.retryFailedTiles') : t('tasks.resume')}
        </button>
      )}
      <button
        className="text-[10px] px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded border border-sky-200"
        onClick={onOpenFolder}
        title={f.folderHint ?? undefined}
      >
        {t('tasks.openFolder')}
      </button>
      {f.canDelete ? (
        <button
          className="text-[10px] px-1 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded"
          onClick={onRemove}
        >
          {t('tasks.delete')}
        </button>
      ) : null}
      {f.canConvert && (
        <button
          className="text-[10px] px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded font-medium"
          onClick={onConvert}
        >
          {t('tasks.packVector')}
        </button>
      )}
      {f.canPackRaster && (
        <button
          className="text-[10px] px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded font-medium"
          onClick={onPackRaster}
        >
          {t('tasks.packRaster')}
        </button>
      )}
      {f.canPreviewPmtiles && (
        <button
          className="text-[10px] px-1.5 py-0.5 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded font-medium"
          onClick={onPreview}
          title={task.output_path ?? ''}
        >
          {t('tasks.preview')}
        </button>
      )}
      {f.canPreviewRaster && !f.canPreviewPmtiles && (
        <button
          className="text-[10px] px-1.5 py-0.5 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded font-medium"
          onClick={onPreviewRaster}
        >
          {t('tasks.preview')}
        </button>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onCancel,
  onResume,
  onRemove,
  onShowLog,
  onConvert,
  onOpenFolder,
  onPreview,
  onPackRaster,
  onPreviewRaster,
}: {
  task: Task;
  onCancel: () => void;
  onResume: () => void;
  onRemove: () => void;
  onShowLog: () => void;
  onConvert: () => void;
  onOpenFolder: () => void;
  onPreview: () => void;
  onPackRaster: () => void;
  onPreviewRaster: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round((task.progress?.ratio ?? 0) * 100);
  const isLive = task.status === 'running' || task.status === 'queued';
  const showBar = isLive || (task.progress?.ratio ?? 0) > 0 || Boolean(task.progress?.phase);
  const fillClass = task.status === 'failed' ? 'bg-rose-500' : 'bg-emerald-500';
  const f = taskActionFlags(task);

  return (
    <div className="border border-slate-200 rounded p-2 text-xs space-y-1.5 bg-white hover:bg-slate-50">
      <div className="flex justify-between items-start gap-[var(--ui-space-sm)]">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-medium text-sm truncate text-slate-900" title={task.region.name}>
            {task.region.name}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={`inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${kindTone(task.kind)}`}
              title={labelFor(task.kind)}
            >
              {labelFor(task.kind)}
            </span>
            {labelForArchive(task) && (
              <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {labelForArchive(task)}
              </span>
            )}
            {(() => {
              const zoom = zoomRangeFor(task);
              if (!zoom) return null;
              return (
                <span
                  className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-800 border border-indigo-100"
                  title={t('tasks.colZoom')}
                >
                  {t('tasks.zoomTab', { min: zoom.min, max: zoom.max })}
                </span>
              );
            })()}
          </div>
          <div className="text-[10px] text-slate-500 tabular-nums">
            {t('tasks.started', { time: formatTaskTime(task.started_at ?? task.created_at) })}
          </div>
        </div>
        <StatusBadge status={task.status} />
      </div>
      {f.hasTileHoles &&
        (task.status === 'failed' || task.status === 'killed' || task.status === 'cancelled') && (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900 leading-snug">
            {t('tasks.tileHoles', {
              failed: f.failedTileCount,
              pending:
                f.pendingTileCount > 0
                  ? t('tasks.pendingSuffix', { count: f.pendingTileCount })
                  : '',
            })}
          </div>
        )}
      {task.error && task.status !== 'done' && (
        <div className="text-[10px] text-rose-600 leading-snug break-words">{task.error}</div>
      )}
      {showBar && (
        <div>
          <div className="h-1.5 bg-black rounded overflow-hidden">
            <div
              className={`task-progress-fill h-full ${fillClass} transition-[width] duration-300 ${
                task.status === 'running' ? 'task-progress-fill--running' : ''
              }`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
            <span>{task.progress?.phase ?? '—'}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}
      <TaskActionButtons
        task={task}
        showLog
        showDetails
        detailsExpanded={expanded}
        onToggleDetails={() => setExpanded(!expanded)}
        onCancel={onCancel}
        onResume={onResume}
        onRemove={onRemove}
        onShowLog={onShowLog}
        onConvert={onConvert}
        onOpenFolder={onOpenFolder}
        onPreview={onPreview}
        onPackRaster={onPackRaster}
        onPreviewRaster={onPreviewRaster}
      />
      {expanded && (
        <pre className="text-[10px] font-mono bg-slate-50 p-2 rounded overflow-auto max-h-32">
{JSON.stringify(task, null, 2)}
        </pre>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  const { t } = useTranslation();
  const m: Record<Task['status'], string> = {
    queued: 'bg-slate-100 text-slate-700',
    running: 'bg-blue-100 text-blue-700',
    done: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-rose-100 text-rose-700',
    killed: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };
  const labels: Record<Task['status'], string> = {
    queued: t('tasks.statusQueued'),
    running: t('tasks.statusRunning'),
    done: t('tasks.statusDone'),
    failed: t('tasks.statusFailed'),
    killed: t('tasks.statusKilled'),
    cancelled: t('tasks.statusCancelled'),
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${m[status]}`}>
      {labels[status]}
    </span>
  );
}

function labelFor(kind: Task['kind']): string {
  const map: Record<Task['kind'], string> = {
    'pbf-download-osm-api': 'tasks.kindOsm',
    'pbf-download-geofabrik': 'tasks.kindGeofabrik',
    'planetiler-convert': 'tasks.kindPlanetiler',
    'raster-download-xyz': 'tasks.kindRasterXyz',
    'raster-pack-archive': 'tasks.kindRasterPack',
  };
  return i18n.t(map[kind]);
}

function kindTone(kind: Task['kind']): string {
  return {
    'pbf-download-osm-api': 'bg-emerald-50 text-emerald-800 border border-emerald-100',
    'pbf-download-geofabrik': 'bg-teal-50 text-teal-800 border border-teal-100',
    'planetiler-convert': 'bg-sky-50 text-sky-800 border border-sky-100',
    'raster-download-xyz': 'bg-amber-50 text-amber-900 border border-amber-100',
    'raster-pack-archive': 'bg-orange-50 text-orange-900 border border-orange-100',
  }[kind];
}

function labelForArchive(task: Task): string | null {
  const out = task.output_path?.toLowerCase() ?? '';
  if (out.endsWith('.mbtiles')) return 'MBTiles';
  if (out.endsWith('.pmtiles')) return 'PMTiles';
  if (task.kind === 'planetiler-convert') {
    const fmt = task.options?.planetiler_form?.archive_format;
    if (fmt === 'mbtiles') return 'MBTiles';
    if (fmt === 'pmtiles') return 'PMTiles';
  }
  if (
    (task.kind === 'raster-download-xyz' || task.kind === 'raster-pack-archive') &&
    (task.metadata?.container === 'directory' ||
      task.metadata?.container === 'pmtiles-pending' ||
      (!out && task.metadata?.tile_dir))
  ) {
    return i18n.t('tasks.archiveDirectory');
  }
  const container = task.metadata?.container;
  if (container === 'mbtiles') return 'MBTiles';
  if (container === 'pmtiles' || container === 'pmtiles-pending') return 'PMTiles';
  if (container === 'directory') return i18n.t('tasks.archiveDirectory');
  return null;
}

function numMeta(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Zoom range shown as a small tab on task cards / history table. */
function zoomRangeFor(task: Task): { min: number; max: number } | null {
  if (task.kind === 'raster-download-xyz' || task.kind === 'raster-pack-archive') {
    const rs = task.options.raster_source;
    const pack = task.options.raster_pack;
    const min =
      rs?.min_zoom ??
      pack?.min_zoom ??
      numMeta(task.metadata?.min_zoom);
    const max =
      rs?.max_zoom ??
      pack?.max_zoom ??
      numMeta(task.metadata?.max_zoom);
    if (min == null || max == null) return null;
    return { min, max };
  }
  if (task.kind === 'planetiler-convert') {
    const form = task.options.planetiler_form;
    const legacy = task.options.planetiler;
    const min = form?.minzoom ?? legacy?.zoom_min ?? null;
    const max = form?.maxzoom ?? legacy?.zoom_max ?? null;
    if (min == null || max == null) return null;
    return { min, max };
  }
  return null;
}

function formatTaskTime(ts: number | null | undefined): string {
  return formatLocalizedTime(ts);
}
