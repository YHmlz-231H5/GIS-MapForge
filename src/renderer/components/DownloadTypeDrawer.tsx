/**
 * DownloadTypeDrawer — choose vector OSM vs raster XYZ after region is ready.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useAppStore } from '../store';
import { Button } from './ui/Button';
import {
  RASTER_DOWNLOAD_SOURCES,
  DEFAULT_RASTER_UI_MAX_ZOOM,
  defaultRasterSourceId,
  estimateRasterTileCount,
  type RasterTileSource,
} from '../../shared/raster-sources';
import { DEFAULT_BBOX_EXPAND_DEG, expandBbox } from '../../shared/planetiler-options';
import {
  probeAllRasterSources,
  type RasterProbeResult,
} from '../lib/rasterSourceProbe';

type DownloadKind = 'vector' | 'raster';

const KIND_LABEL: Record<RasterTileSource['kind'], string> = {
  streets: '街道',
  imagery: '影像',
  topo: '地形',
  overlay: '标注',
};

export function DownloadTypeDrawer() {
  const open = useAppStore((s) => s.downloadDrawerOpen);
  const close = useAppStore((s) => s.closeDownloadDrawer);
  const region = useAppStore((s) => s.region);

  const [kind, setKind] = useState<DownloadKind>('vector');
  const [sourceId, setSourceId] = useState(defaultRasterSourceId());
  const [minZoom, setMinZoom] = useState(0);
  const [maxZoom, setMaxZoom] = useState(DEFAULT_RASTER_UI_MAX_ZOOM);
  const [busy, setBusy] = useState(false);
  /** Off by default — preview「割裂」更多见缺字库；外扩会显著增加 Overpass 格数. */
  const [expandEnabled, setExpandEnabled] = useState(false);
  const [expandDeg, setExpandDeg] = useState(Number(DEFAULT_BBOX_EXPAND_DEG.toFixed(4)));
  const [taskName, setTaskName] = useState('');
  const [probes, setProbes] = useState<Record<string, RasterProbeResult>>({});
  const [probing, setProbing] = useState(false);
  const probesRef = useRef(probes);
  probesRef.current = probes;

  // Reset editable name to current region default each time the drawer opens.
  useEffect(() => {
    if (open && region) setTaskName(region.name);
  }, [open, region?.name]);

  // When raster tab is active, probe mid-zoom preview tiles for all sources.
  useEffect(() => {
    if (!open || !region || kind !== 'raster') return;
    let cancelled = false;
    setProbing(true);
    setProbes((prev) => {
      const loading: Record<string, RasterProbeResult> = {};
      for (const s of RASTER_DOWNLOAD_SOURCES) {
        if (prev[s.id]?.previewUrl) URL.revokeObjectURL(prev[s.id]!.previewUrl!);
        loading[s.id] = { id: s.id, status: 'loading', latencyMs: -1 };
      }
      return loading;
    });

    (async () => {
      const next = await probeAllRasterSources(
        RASTER_DOWNLOAD_SOURCES,
        region.bbox,
        (r) => {
          if (cancelled) {
            if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
            return;
          }
          setProbes((prev) => {
            const old = prev[r.id];
            if (old?.previewUrl && old.previewUrl !== r.previewUrl) {
              URL.revokeObjectURL(old.previewUrl);
            }
            return { ...prev, [r.id]: r };
          });
        }
      );
      if (cancelled) {
        for (const r of Object.values(next)) {
          if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        }
        return;
      }
      setProbing(false);
      setSourceId((curId) => {
        const cur = next[curId];
        if (cur?.status === 'ok') return curId;
        const preferred =
          RASTER_DOWNLOAD_SOURCES.find((s) => s.bulkOk && next[s.id]?.status === 'ok') ??
          RASTER_DOWNLOAD_SOURCES.find((s) => next[s.id]?.status === 'ok');
        if (preferred) {
          setMaxZoom(
            Math.min(preferred.suggestMaxZoom, preferred.maxzoom, DEFAULT_RASTER_UI_MAX_ZOOM)
          );
          setMinZoom(0);
          return preferred.id;
        }
        return curId;
      });
    })();

    return () => {
      cancelled = true;
      for (const r of Object.values(probesRef.current)) {
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
      }
    };
  }, [open, region?.name, kind, region ? region.bbox.join(',') : '']);

  const source: RasterTileSource | undefined = useMemo(
    () => RASTER_DOWNLOAD_SOURCES.find((s) => s.id === sourceId),
    [sourceId]
  );

  const tileEstimate = useMemo(() => {
    if (!region || !source) return 0;
    const z1 = Math.max(0, Math.min(minZoom, source.maxzoom));
    const z2 = Math.max(z1, Math.min(maxZoom, source.maxzoom));
    return estimateRasterTileCount(region.bbox, z1, z2);
  }, [region, source, minZoom, maxZoom]);

  const effectiveExpand = expandEnabled ? Math.max(0, expandDeg) : 0;
  const downloadBboxPreview = useMemo(() => {
    if (!region) return null;
    return effectiveExpand > 0 ? expandBbox(region.bbox, effectiveExpand) : region.bbox;
  }, [region, effectiveExpand]);

  if (!open || !region) return null;

  const resolvedTaskName = taskName.trim() || region.name;
  const regionForTask = { ...region, name: resolvedTaskName };
  const selectedProbe = probes[sourceId];

  const onSourceChange = (id: string) => {
    setSourceId(id);
    const s = RASTER_DOWNLOAD_SOURCES.find((x) => x.id === id);
    if (s) {
      setMaxZoom(Math.min(s.suggestMaxZoom, s.maxzoom, DEFAULT_RASTER_UI_MAX_ZOOM));
      setMinZoom(0);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (kind === 'vector') {
        const r = await window.api.submitTask({
          kind: 'pbf-download-osm-api',
          region: regionForTask,
          options: {
            pbf_source: 'osm-api',
            download_expand_deg: effectiveExpand,
          },
        });
        if (!r.ok) {
          alert(`矢量下载提交失败: ${r.error}`);
          return;
        }
      } else {
        if (!source) {
          alert('请选择栅格底图源');
          return;
        }
        if (selectedProbe?.status === 'fail') {
          const ok = confirm(
            `当前源预览失败（${selectedProbe.error ?? 'unknown'}），继续下载很可能得到空图或 Access blocked。仍要提交？`
          );
          if (!ok) return;
        } else if (source.bulkOk === false) {
          const ok = confirm(
            `「${source.label}」不适合大规模离线下载（政策 / 易被拦截）。建议改用 Carto 或 Esri。仍要继续？`
          );
          if (!ok) return;
        }
        if (tileEstimate > 80_000) {
          const ok = confirm(
            `预计约 ${tileEstimate.toLocaleString()} 张瓦片，体积与耗时可能很大，且可能违反图源使用政策。仍要继续？`
          );
          if (!ok) return;
        }
        const r = await window.api.submitTask({
          kind: 'raster-download-xyz',
          region: regionForTask,
          options: {
            raster_source: {
              source_id: source.id,
              url_template: source.urlTemplate,
              subdomains: source.subdomains,
              attribution: source.attribution,
              min_zoom: minZoom,
              max_zoom: Math.min(maxZoom, source.maxzoom),
              format: source.format === 'jpeg' ? 'jpeg' : source.format,
              // Always download as directory; pack MBTiles/PMTiles from the task card later.
              container: 'directory',
            },
          },
        });
        if (!r.ok) {
          alert(`栅格下载提交失败: ${r.error}`);
          return;
        }
      }
      const list = await window.api.listTasks();
      if (list.ok && list.data) useAppStore.setState({ tasks: list.data });
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3">
      <div className="bg-white w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-lg shadow-xl thin-scroll">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold">选择下载类型</h2>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{region.name}</p>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800" onClick={close}>
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="download-task-name">
              任务名称
            </label>
            <input
              id="download-task-name"
              type="text"
              className="w-full border rounded px-2.5 py-1.5 text-sm"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder={region.name}
              maxLength={120}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              默认与选区名称相同，可改写；用于任务队列与输出文件命名。
            </p>
          </section>

          <section>
            <div className="text-xs text-slate-500 mb-2">确认要下载的是：</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKind('vector')}
                className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 ${
                  kind === 'vector' ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200'
                }`}
              >
                <div className="font-semibold">矢量（OSM）</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Overpass 下载 OSM，再可生成 PMTiles/MBTiles 矢量瓦片
                </div>
              </button>
              <button
                type="button"
                onClick={() => setKind('raster')}
                className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 ${
                  kind === 'raster' ? 'border-sky-600 bg-sky-50' : 'border-slate-200'
                }`}
              >
                <div className="font-semibold">栅格瓦片</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  按 XYZ 下载 PNG/JPEG 底图，可打包目录 / MBTiles
                </div>
              </button>
            </div>
          </section>

          {kind === 'vector' && (
            <section className="rounded border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 space-y-2.5 leading-snug">
              <p className="font-medium text-slate-800">将创建 Overpass 任务</p>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={expandEnabled}
                  onChange={(e) => setExpandEnabled(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">外扩下载范围</span>
                  <span className="block text-slate-500 mt-0.5">
                    勾选后相对选区四边外扩，减轻 Planetiler 边缘瓦片缺少 OSM 细部的情况。预览里的「割裂」更常见于字库不全，不必默认外扩。
                  </span>
                </span>
              </label>

              {expandEnabled && (
                <label className="block pl-6">
                  <span className="text-slate-600">外扩度数（每边，°）</span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.001}
                      className="w-28 border rounded px-2 py-1 font-mono text-[12px]"
                      value={expandDeg}
                      onChange={(e) => setExpandDeg(Number(e.target.value) || 0)}
                    />
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 border rounded hover:bg-white text-slate-600"
                      title={`推荐值 ≈ z14×1.5 = ${DEFAULT_BBOX_EXPAND_DEG.toFixed(4)}°`}
                      onClick={() => setExpandDeg(Number(DEFAULT_BBOX_EXPAND_DEG.toFixed(4)))}
                    >
                      用推荐值
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    推荐约 {DEFAULT_BBOX_EXPAND_DEG.toFixed(4)}°（≈ 1.5×z14 墨卡托瓦片）
                  </p>
                </label>
              )}

              <div className="font-mono text-[10px] text-slate-500 break-all space-y-0.5 border-t border-slate-200 pt-2">
                <p>选区：{region.bbox.map((v) => v.toFixed(5)).join(', ')}</p>
                {downloadBboxPreview && (
                  <p>
                    实际下载：{downloadBboxPreview.map((v) => v.toFixed(5)).join(', ')}
                    {effectiveExpand > 0 ? ` · ±${effectiveExpand.toFixed(4)}°` : ' · 无外扩'}
                  </p>
                )}
              </div>
              <p className="text-slate-500">完成后在任务队列点「矢量数据切片打包」可生成 PMTiles 或 MBTiles。</p>
            </section>
          )}

          {kind === 'raster' && source && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  <span className="text-slate-500">min zoom</span>
                  <input
                    type="number"
                    min={0}
                    max={source.maxzoom}
                    className="mt-0.5 w-full border rounded px-2 py-1"
                    value={minZoom}
                    onChange={(e) => setMinZoom(Number(e.target.value) || 0)}
                  />
                </label>
                <label className="text-xs">
                  <span className="text-slate-500">
                    max zoom（默认 {DEFAULT_RASTER_UI_MAX_ZOOM}，本源 ≤{source.maxzoom}）
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={source.maxzoom}
                    className="mt-0.5 w-full border rounded px-2 py-1"
                    value={maxZoom}
                    onChange={(e) => setMaxZoom(Number(e.target.value) || 0)}
                  />
                </label>
              </div>

              <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                预计约 <strong>{tileEstimate.toLocaleString()}</strong> 张瓦片。请遵守图源 ToS /
                速率限制；完成后在任务卡片点「栅格数据打包」选择 MBTiles 或 PMTiles。
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-600">开源 / 公开栅格源</label>
                <span className="text-[10px] text-slate-400">
                  {probing ? '正在请求预览…' : '选区中心 · z10 实测'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[280px] overflow-y-auto thin-scroll pr-0.5">
                {RASTER_DOWNLOAD_SOURCES.map((s) => {
                  const p = probes[s.id];
                  const selected = sourceId === s.id;
                  const fail = p?.status === 'fail';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSourceChange(s.id)}
                      className={`text-left rounded-lg border-2 overflow-hidden transition-colors ${
                        selected
                          ? 'border-sky-600 ring-1 ring-sky-200'
                          : fail
                            ? 'border-rose-200 opacity-80'
                            : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="relative h-[72px] bg-slate-100">
                        {p?.status === 'ok' && p.previewUrl ? (
                          <img
                            src={p.previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        ) : p?.status === 'loading' || !p ? (
                          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400">
                            加载预览…
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center px-1 text-center text-[10px] text-rose-700 bg-rose-50">
                            <span className="font-medium">不可用</span>
                            <span className="truncate max-w-full">{p.error}</span>
                          </div>
                        )}
                        {!s.bulkOk && (
                          <span className="absolute top-1 left-1 text-[9px] px-1 py-0.5 rounded bg-amber-500/90 text-white">
                            不推荐批量
                          </span>
                        )}
                        {p?.status === 'ok' && p.latencyMs >= 0 && (
                          <span className="absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/55 text-white">
                            {p.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <div className="px-1.5 py-1.5">
                        <div className="text-[11px] font-medium leading-tight line-clamp-2">{s.label}</div>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {KIND_LABEL[s.kind]} · ≤z{s.maxzoom}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-400 leading-snug">
                {source.attribution}
                {source.notes ? ` · ${source.notes}` : ''}
              </p>
            </section>
          )}
        </div>

        <div className="p-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="default" disabled={busy} onClick={submit}>
            {busy ? (
              '提交中…'
            ) : (
              <>
                <Download className="w-3.5 h-3.5" aria-hidden />
                {kind === 'vector' ? '下载 OSM' : '下载栅格瓦片'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

