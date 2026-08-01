/**
 * DownloadTypeDrawer — choose vector OSM vs raster XYZ after region is ready.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

export function DownloadTypeDrawer() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.downloadDrawerOpen);
  const close = useAppStore((s) => s.closeDownloadDrawer);
  const region = useAppStore((s) => s.region);

  const KIND_LABEL: Record<RasterTileSource['kind'], string> = {
    streets: t('download.kindStreets'),
    imagery: t('download.kindImagery'),
    topo: t('download.kindTopo'),
    overlay: t('download.kindOverlay'),
  };

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
          alert(t('download.vectorSubmitFailed', { error: r.error }));
          return;
        }
      } else {
        if (!source) {
          alert(t('download.pickSource'));
          return;
        }
        if (selectedProbe?.status === 'fail') {
          const ok = confirm(
            t('download.probeFailContinue', { error: selectedProbe.error ?? 'unknown' })
          );
          if (!ok) return;
        } else if (source.bulkOk === false) {
          const ok = confirm(t('download.sourceBlocked', { label: source.label }));
          if (!ok) return;
        }
        if (tileEstimate > 80_000) {
          const ok = confirm(t('download.largeEstimateContinue', { tiles: tileEstimate.toLocaleString() }));
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
              container: 'directory',
            },
          },
        });
        if (!r.ok) {
          alert(t('download.rasterSubmitFailed', { error: r.error }));
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
            <h2 className="text-base font-semibold">{t('download.title')}</h2>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{region.name}</p>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800" onClick={close}>
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="download-task-name">
              {t('download.taskName')}
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
            <p className="text-[10px] text-slate-400 mt-1">{t('download.taskNameHint')}</p>
          </section>

          <section>
            <div className="text-xs text-slate-500 mb-2">{t('download.confirmKind')}</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKind('vector')}
                className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 ${
                  kind === 'vector' ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200'
                }`}
              >
                <div className="font-semibold">{t('download.vectorTitle')}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{t('download.vectorHint')}</div>
              </button>
              <button
                type="button"
                onClick={() => setKind('raster')}
                className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 ${
                  kind === 'raster' ? 'border-sky-600 bg-sky-50' : 'border-slate-200'
                }`}
              >
                <div className="font-semibold">{t('download.rasterTitle')}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{t('download.rasterHint')}</div>
              </button>
            </div>
          </section>

          {kind === 'vector' && (
            <section className="rounded border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 space-y-2.5 leading-snug">
              <p className="font-medium text-slate-800">{t('download.willSubmitOverpass')}</p>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={expandEnabled}
                  onChange={(e) => setExpandEnabled(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">{t('download.expandTitle')}</span>
                  <span className="block text-slate-500 mt-0.5">{t('download.expandHint')}</span>
                </span>
              </label>

              {expandEnabled && (
                <label className="block pl-6">
                  <span className="text-slate-600">{t('download.expandDeg')}</span>
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
                      onClick={() => setExpandDeg(Number(DEFAULT_BBOX_EXPAND_DEG.toFixed(4)))}
                    >
                      {t('download.useRecommended')}
                    </button>
                  </div>
                </label>
              )}

              <p className="text-slate-500">{t('download.afterVectorHint')}</p>
            </section>
          )}

          {kind === 'raster' && source && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  <span className="text-slate-500">{t('download.minZoom')}</span>
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
                    {t('download.maxZoom', {
                      default: DEFAULT_RASTER_UI_MAX_ZOOM,
                      sourceMax: source.maxzoom,
                    })}
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
                {t('download.tileEstimateWarn', { tiles: tileEstimate.toLocaleString() })}
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-600">{t('download.sourcesLabel')}</label>
                <span className="text-[10px] text-slate-400">
                  {probing ? t('download.probing') : t('download.probeHint')}
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
                            {t('download.loadingPreview')}
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center px-1 text-center text-[10px] text-rose-700 bg-rose-50">
                            <span className="font-medium">{t('download.unavailable')}</span>
                            <span className="truncate max-w-full">{p.error}</span>
                          </div>
                        )}
                        {!s.bulkOk && (
                          <span className="absolute top-1 left-1 text-[9px] px-1 py-0.5 rounded bg-amber-500/90 text-white">
                            {t('download.notRecommendedBulk')}
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
            {t('tasks.cancel')}
          </Button>
          <Button variant="default" disabled={busy} onClick={submit}>
            {busy ? (
              t('download.submitting')
            ) : (
              <>
                <Download className="w-3.5 h-3.5" aria-hidden />
                {kind === 'vector' ? t('download.submitOsm') : t('download.submitRaster')}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

