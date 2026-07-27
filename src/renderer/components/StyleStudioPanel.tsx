/**
 * Style Studio — visual + JSON bidirectional MapLibre style editor
 * against a local OpenMapTiles PMTiles archive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import {
  PREVIEW_STYLE_OPTIONS,
  adaptBundledStyleForPmtiles,
  bindStyleToLocalPmtiles,
  createEmptyStyle,
  type PreviewStyleId,
} from '../lib/previewStyles';
import { attachLocalPmtiles } from '../lib/pmtilesLocal';
import { buildStyleExportReadme, prepareExportStyle } from '../lib/styleExportGuide';
import { MapZoomHud } from './MapZoomHud';

type PmtilesEntry = { name: string; path: string; size: number; mtimeMs: number };

type StudioTab = 'visual' | 'json';

function cloneStyle(s: StyleSpecification): StyleSpecification {
  return JSON.parse(JSON.stringify(s)) as StyleSpecification;
}

function prettyJson(s: StyleSpecification): string {
  return JSON.stringify(s, null, 2);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function colorFromPaint(v: unknown): string | null {
  if (typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
    return v.length === 4
      ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
      : v.slice(0, 7);
  }
  return null;
}

function numberFromPaint(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const TEMPLATE_OPTIONS = PREVIEW_STYLE_OPTIONS.filter((o) => o.id !== 'diagnostic') as Array<{
  id: Exclude<PreviewStyleId, 'diagnostic'>;
  label: string;
}>;

export function StyleStudioPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const sourceKeyRef = useRef<string>('');
  const styleRef = useRef<StyleSpecification | null>(null);
  const applyingJsonRef = useRef(false);

  const [outputDir, setOutputDir] = useState('');
  const [browseDir, setBrowseDir] = useState('');
  const [pmtilesList, setPmtilesList] = useState<PmtilesEntry[]>([]);
  const [pmtilesPath, setPmtilesPath] = useState<string | null>(null);
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [tab, setTab] = useState<StudioTab>('visual');
  const [status, setStatus] = useState('选择 PMTiles 开始配图');
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<Exclude<PreviewStyleId, 'diagnostic'>>('blue-tech');
  const [styleName, setStyleName] = useState('Untitled');

  const layers = style?.layers ?? [];
  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedLayerId) ?? null,
    [layers, selectedLayerId]
  );

  const refreshPmtilesList = useCallback(async (dir: string) => {
    if (!dir) {
      setPmtilesList([]);
      return;
    }
    const r = await window.api.listPmtiles(dir);
    if (r.ok && r.data) setPmtilesList(r.data);
    else {
      setPmtilesList([]);
      setError(r.error ?? '无法列出 PMTiles');
    }
  }, []);

  // Load default output dir when opening
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const r = await window.api.resolveOutputDir();
      if (cancelled) return;
      if (r.ok && r.data) {
        setOutputDir(r.data);
        setBrowseDir(r.data);
        await refreshPmtilesList(r.data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshPmtilesList]);

  const destroyMap = () => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    setMapInstance(null);
  };

  const pushStyle = useCallback((next: StyleSpecification, opts?: { skipJson?: boolean }) => {
    const cloned = cloneStyle(next);
    styleRef.current = cloned;
    setStyle(cloned);
    if (!opts?.skipJson) {
      setJsonText(prettyJson(cloned));
      setJsonError(null);
    }
    if (cloned.name) setStyleName(String(cloned.name));
  }, []);

  const fitArchiveInterior = (map: maplibregl.Map, header: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    maxZoom: number;
  }) => {
    // Inset ~8% so the first view is not the coarse OSM-buffer / Natural-Earth rim.
    const w = header.minLon;
    const s = header.minLat;
    const e = header.maxLon;
    const n = header.maxLat;
    const padLon = (e - w) * 0.08;
    const padLat = (n - s) * 0.08;
    try {
      map.fitBounds(
        [
          [w + padLon, s + padLat],
          [e - padLon, n - padLat],
        ],
        { padding: 28, maxZoom: Math.min(header.maxZoom, 13), duration: 0 }
      );
    } catch {
      /* ignore */
    }
  };

  const applyStyleToMap = useCallback((next: StyleSpecification) => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(cloneStyle(next), { diff: false });
    map.once('idle', () => {
      map.resize();
    });
  }, []);

  const loadPmtilesWithStyle = useCallback(
    async (filePath: string, buildStyle: (sourceKey: string) => StyleSpecification) => {
      if (!mapDivRef.current) return;
      setError(null);
      setStatus('加载瓦片…');
      destroyMap();

      try {
        const { pm, sourceKey } = attachLocalPmtiles(filePath);
        sourceKeyRef.current = sourceKey;
        const header = await pm.getHeader();
        // Same binding as PmtilesPreviewPanel (adaptBundled / createEmpty / bind import).
        const nextStyle = buildStyle(sourceKey);
        pushStyle(nextStyle);

        const map = new maplibregl.Map({
          container: mapDivRef.current,
          style: nextStyle,
          center: [
            header.centerLon || (header.minLon + header.maxLon) / 2,
            header.centerLat || (header.minLat + header.maxLat) / 2,
          ],
          zoom: header.centerZoom || Math.max(header.minZoom, 10),
          attributionControl: false,
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }),
          'bottom-right'
        );
        mapRef.current = map;
        setMapInstance(map);

        let fitted = false;
        const afterLayout = () => {
          map.resize();
          if (!fitted) {
            fitted = true;
            fitArchiveInterior(map, header);
          }
          requestAnimationFrame(() => map.resize());
        };

        map.once('load', () => {
          afterLayout();
          setStatus(`配图就绪 · ${filePath.replace(/\\/g, '/').split('/').pop()}`);
        });
        map.once('idle', afterLayout);
        map.on('error', (e) => console.warn('[StyleStudio]', e.error));

        const firstEditable =
          nextStyle.layers?.find((l) => l.id !== 'background')?.id ?? nextStyle.layers?.[0]?.id;
        setSelectedLayerId(firstEditable ?? null);
      } catch (e) {
        setError((e as Error).message);
        setStatus('加载失败');
      }
    },
    [pushStyle]
  );

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      destroyMap();
      setPmtilesPath(null);
      setStyle(null);
      setJsonText('');
      setSelectedLayerId(null);
      setError(null);
      setStatus('选择 PMTiles 开始配图');
    }
    return () => destroyMap();
  }, [open]);

  const onSelectPmtiles = async (path: string) => {
    setPmtilesPath(path);
    await loadPmtilesWithStyle(path, (sourceKey) =>
      adaptBundledStyleForPmtiles(templateId, sourceKey)
    );
  };

  const onPickCustomPmtiles = async () => {
    const r = await window.api.pickOpenFile({
      title: '选择 PMTiles',
      filters: [{ name: 'PMTiles', extensions: ['pmtiles'] }],
      defaultPath: browseDir || outputDir || undefined,
    });
    if (!r.ok) {
      setError(r.error ?? '选择失败');
      return;
    }
    if (!r.data) return;
    const dir = r.data.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || browseDir;
    if (dir) {
      setBrowseDir(dir.replace(/\//g, '\\'));
      await refreshPmtilesList(dir.replace(/\//g, '\\'));
    }
    await onSelectPmtiles(r.data);
  };

  const onPickBrowseDir = async () => {
    const r = await window.api.pickDirectory();
    if (!r.ok) {
      setError(r.error ?? '选择目录失败');
      return;
    }
    if (!r.data) return;
    setBrowseDir(r.data);
    await refreshPmtilesList(r.data);
  };

  const onApplyTemplate = async () => {
    if (!pmtilesPath || !sourceKeyRef.current) {
      setError('请先选择 PMTiles');
      return;
    }
    const next = adaptBundledStyleForPmtiles(templateId, sourceKeyRef.current);
    pushStyle(next);
    applyStyleToMap(next);
    const first =
      next.layers?.find((l) => l.id !== 'background')?.id ?? next.layers?.[0]?.id ?? null;
    setSelectedLayerId(first);
    setStatus(`已套用模板：${TEMPLATE_OPTIONS.find((t) => t.id === templateId)?.label}`);
  };

  const onNewEmpty = async () => {
    if (!pmtilesPath || !sourceKeyRef.current) {
      setError('请先选择 PMTiles');
      return;
    }
    const next = createEmptyStyle(sourceKeyRef.current, 'Untitled');
    pushStyle(next);
    applyStyleToMap(next);
    setSelectedLayerId('background');
    setStatus('已新建空样式（仅背景）');
  };

  const onImportJson = async () => {
    if (!pmtilesPath || !sourceKeyRef.current) {
      setError('请先选择 PMTiles，再导入样式');
      return;
    }
    const r = await window.api.pickOpenFile({
      title: '导入 Style JSON',
      filters: [{ name: 'MapLibre Style', extensions: ['json'] }],
      defaultPath: browseDir || outputDir || undefined,
    });
    if (!r.ok || !r.data) {
      if (r.error) setError(r.error);
      return;
    }
    const text = await window.api.readTextFile(r.data);
    if (!text.ok || text.data == null) {
      setError(text.error ?? '读取失败');
      return;
    }
    try {
      const parsed = JSON.parse(text.data) as StyleSpecification;
      if (parsed.version !== 8) throw new Error('仅支持 style version 8');
      const bound = bindStyleToLocalPmtiles(parsed, sourceKeyRef.current);
      pushStyle(bound);
      applyStyleToMap(bound);
      setSelectedLayerId(bound.layers?.[0]?.id ?? null);
      setStatus(`已导入：${r.data.replace(/\\/g, '/').split('/').pop()}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onExport = async () => {
    if (!style) {
      setError('没有可导出的样式');
      return;
    }
    const dirPick = await window.api.pickDirectory();
    if (!dirPick.ok) {
      setError(dirPick.error ?? '选择导出目录失败');
      return;
    }
    if (!dirPick.data) return;

    const safeName = (styleName || 'style').replace(/[<>:"/\\|?*]/g, '_').trim() || 'style';
    const styleFileName = `${safeName}.json`;
    const pmtilesHint = pmtilesPath ?? '(未选择)';
    const exportStyle = prepareExportStyle(style, {
      name: styleName,
      pmtilesFileName: './tiles.pmtiles',
    });
    const readme = buildStyleExportReadme({
      styleFileName,
      pmtilesHint,
    });

    const w = await window.api.writeTextFiles(dirPick.data, [
      { relativePath: styleFileName, contents: prettyJson(exportStyle) },
      { relativePath: 'README-开发指南.md', contents: readme },
    ]);
    if (!w.ok) {
      setError(w.error ?? '导出失败');
      return;
    }
    setStatus(`已导出到 ${dirPick.data}`);
    await window.api.openFolder(dirPick.data);
  };

  const onApplyJson = () => {
    if (!sourceKeyRef.current) {
      setError('请先选择 PMTiles');
      return;
    }
    try {
      applyingJsonRef.current = true;
      const parsed = JSON.parse(jsonText) as StyleSpecification;
      if (parsed.version !== 8) throw new Error('仅支持 style version 8');
      const bound = bindStyleToLocalPmtiles(parsed, sourceKeyRef.current);
      pushStyle(bound);
      applyStyleToMap(bound);
      setJsonError(null);
      setStatus('已应用 JSON');
      if (selectedLayerId && !bound.layers?.some((l) => l.id === selectedLayerId)) {
        setSelectedLayerId(bound.layers?.[0]?.id ?? null);
      }
    } catch (e) {
      setJsonError((e as Error).message);
    } finally {
      applyingJsonRef.current = false;
    }
  };

  const patchSelectedLayer = (mutator: (layer: LayerSpecification) => void) => {
    if (!style || !selectedLayerId) return;
    const next = cloneStyle(style);
    const layer = next.layers?.find((l) => l.id === selectedLayerId);
    if (!layer) return;
    mutator(layer);
    pushStyle(next);
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      try {
        const paint = layer.paint as Record<string, unknown> | undefined;
        const layout = layer.layout as Record<string, unknown> | undefined;
        if (paint) {
          for (const [k, v] of Object.entries(paint)) {
            if (map.getLayer(selectedLayerId)) map.setPaintProperty(selectedLayerId, k, v);
          }
        }
        if (layout) {
          for (const [k, v] of Object.entries(layout)) {
            if (k === 'visibility') {
              if (map.getLayer(selectedLayerId)) map.setLayoutProperty(selectedLayerId, 'visibility', v as string);
            } else if (map.getLayer(selectedLayerId)) {
              map.setLayoutProperty(selectedLayerId, k, v);
            }
          }
        }
        if (typeof layer.minzoom === 'number') {
          /* MapLibre has no setMinzoom — full setStyle safer for zoom range */
        }
      } catch {
        applyStyleToMap(next);
      }
    } else {
      applyStyleToMap(next);
    }
  };

  const setLayerVisibility = (layerId: string, visible: boolean) => {
    if (!style) return;
    const next = cloneStyle(style);
    const layer = next.layers?.find((l) => l.id === layerId);
    if (!layer) return;
    layer.layout = { ...(layer.layout as object), visibility: visible ? 'visible' : 'none' };
    pushStyle(next);
    const map = mapRef.current;
    if (map?.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  };

  if (!open) return null;

  const paint = (selectedLayer?.paint ?? {}) as Record<string, unknown>;
  const layout = (selectedLayer?.layout ?? {}) as Record<string, unknown>;
  const fillColor = colorFromPaint(paint['fill-color']);
  const lineColor = colorFromPaint(paint['line-color']);
  const textColor = colorFromPaint(paint['text-color']);
  const bgColor = colorFromPaint(paint['background-color']);
  const fillOpacity = numberFromPaint(paint['fill-opacity']);
  const lineOpacity = numberFromPaint(paint['line-opacity']);
  const lineWidth = numberFromPaint(paint['line-width']);
  const visibility = layout.visibility !== 'none';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex flex-col" role="dialog" aria-label="配图">
      <div className="flex-1 m-2 md:m-3 bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden min-h-0">
        {/* Top bar */}
        <div className="px-3 py-2 border-b flex flex-wrap items-center gap-2 shrink-0">
          <h2 className="text-sm font-semibold mr-1">配图</h2>
          <span className="text-[11px] text-slate-500 truncate max-w-[220px]" title={status}>
            {status}
          </span>
          <div className="flex-1" />
          <label className="text-[11px] text-slate-600 flex items-center gap-1">
            名称
            <input
              className="border rounded px-1.5 py-0.5 text-xs w-28"
              value={styleName}
              onChange={(e) => {
                setStyleName(e.target.value);
                if (style) {
                  const next = cloneStyle(style);
                  next.name = e.target.value;
                  pushStyle(next);
                }
              }}
            />
          </label>
          <select
            className="border rounded px-1.5 py-1 text-xs"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as typeof templateId)}
            title="模板（套用前请先选 PMTiles）"
          >
            {TEMPLATE_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="button" className="text-xs px-2 py-1 border rounded hover:bg-slate-50" onClick={onApplyTemplate}>
            套用模板
          </button>
          <button type="button" className="text-xs px-2 py-1 border rounded hover:bg-slate-50" onClick={onNewEmpty}>
            新建空样式
          </button>
          <button type="button" className="text-xs px-2 py-1 border rounded hover:bg-slate-50" onClick={onImportJson}>
            导入 JSON
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700"
            onClick={onExport}
          >
            导出
          </button>
          <button type="button" className="text-slate-500 hover:text-slate-800 px-2" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* PMTiles picker row */}
        <div className="px-3 py-2 border-b bg-slate-50 flex flex-wrap gap-2 items-center text-[11px] shrink-0">
          <span className="text-slate-600">瓦片目录</span>
          <code className="font-mono text-slate-700 max-w-[280px] truncate" title={browseDir || outputDir}>
            {browseDir || outputDir || '…'}
          </code>
          <button type="button" className="px-2 py-0.5 border rounded bg-white hover:bg-slate-100" onClick={onPickBrowseDir}>
            换目录
          </button>
          <button
            type="button"
            className="px-2 py-0.5 border rounded bg-white hover:bg-slate-100"
            onClick={() => refreshPmtilesList(browseDir || outputDir)}
          >
            刷新
          </button>
          <button type="button" className="px-2 py-0.5 border rounded bg-white hover:bg-slate-100" onClick={onPickCustomPmtiles}>
            自选文件…
          </button>
          <select
            className="border rounded px-1.5 py-1 text-xs min-w-[200px] max-w-[360px] bg-white"
            value={pmtilesPath ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v) void onSelectPmtiles(v);
            }}
          >
            <option value="">选择已生成的 .pmtiles…</option>
            {pmtilesList.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name} ({formatBytes(f.size)})
              </option>
            ))}
          </select>
          {pmtilesList.length === 0 && (
            <span className="text-amber-700">当前目录没有 .pmtiles，可换目录或自选文件</span>
          )}
          <span className="text-slate-400">
            提示：档案外缘可能偏粗（OSM 缓冲/低细节）；White Positron 更易看出。预览同文件同样式可作对照。
          </span>
        </div>

        {error && (
          <div className="px-3 py-1.5 bg-rose-50 text-rose-700 text-xs border-b shrink-0">{error}</div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          {/* Layer list */}
          <aside className="w-56 shrink-0 border-r overflow-y-auto thin-scroll bg-white">
            <div className="px-2 py-1.5 text-[11px] font-medium text-slate-700 sticky top-0 bg-white border-b">
              图层 ({layers.length})
            </div>
            <ul className="text-[11px]">
              {layers.map((layer) => {
                const vis = (layer.layout as { visibility?: string } | undefined)?.visibility !== 'none';
                const active = layer.id === selectedLayerId;
                return (
                  <li key={layer.id}>
                    <div
                      className={`flex items-center gap-1 px-2 py-1 border-b border-slate-50 cursor-pointer ${
                        active ? 'bg-sky-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedLayerId(layer.id)}
                    >
                      <input
                        type="checkbox"
                        checked={vis}
                        onChange={(e) => {
                          e.stopPropagation();
                          setLayerVisibility(layer.id, e.target.checked);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        title="显隐"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono truncate text-slate-800">{layer.id}</div>
                        <div className="text-slate-400 truncate">
                          {layer.type}
                          {'source-layer' in layer && layer['source-layer']
                            ? ` · ${layer['source-layer']}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
              {layers.length === 0 && (
                <li className="px-2 py-3 text-slate-400">加载样式后显示图层</li>
              )}
            </ul>
          </aside>

          {/* Map */}
          <div className="relative flex-1 min-w-0 bg-slate-200">
            <div ref={mapDivRef} className="absolute inset-0" />
            <MapZoomHud map={mapInstance} />
            {!pmtilesPath && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600 bg-slate-100/80">
                请选择输出目录中的 PMTiles，或自选文件
              </div>
            )}
          </div>

          {/* Inspector */}
          <aside className="w-80 shrink-0 border-l flex flex-col min-h-0 bg-white">
            <div className="flex border-b text-xs shrink-0">
              <button
                type="button"
                className={`flex-1 py-2 ${tab === 'visual' ? 'bg-white font-medium border-b-2 border-sky-500' : 'bg-slate-50 text-slate-500'}`}
                onClick={() => setTab('visual')}
              >
                可视化
              </button>
              <button
                type="button"
                className={`flex-1 py-2 ${tab === 'json' ? 'bg-white font-medium border-b-2 border-sky-500' : 'bg-slate-50 text-slate-500'}`}
                onClick={() => setTab('json')}
              >
                高阶 JSON
              </button>
            </div>

            {tab === 'visual' ? (
              <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-3 text-[11px]">
                {!selectedLayer ? (
                  <p className="text-slate-400">选择左侧图层进行编辑</p>
                ) : (
                  <>
                    <div>
                      <div className="font-mono text-slate-800 text-xs">{selectedLayer.id}</div>
                      <div className="text-slate-500">
                        type={selectedLayer.type}
                        {'source-layer' in selectedLayer && selectedLayer['source-layer']
                          ? ` · ${selectedLayer['source-layer']}`
                          : ''}
                      </div>
                    </div>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={visibility}
                        onChange={(e) => setLayerVisibility(selectedLayer.id, e.target.checked)}
                      />
                      可见
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
                        <span className="text-slate-500">minzoom</span>
                        <input
                          type="number"
                          className="w-full border rounded px-1.5 py-1"
                          value={selectedLayer.minzoom ?? ''}
                          placeholder="—"
                          onChange={(e) => {
                            const v = e.target.value;
                            patchSelectedLayer((layer) => {
                              if (v === '') delete layer.minzoom;
                              else layer.minzoom = Number(v);
                            });
                            if (styleRef.current) applyStyleToMap(styleRef.current);
                          }}
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-slate-500">maxzoom</span>
                        <input
                          type="number"
                          className="w-full border rounded px-1.5 py-1"
                          value={selectedLayer.maxzoom ?? ''}
                          placeholder="—"
                          onChange={(e) => {
                            const v = e.target.value;
                            patchSelectedLayer((layer) => {
                              if (v === '') delete layer.maxzoom;
                              else layer.maxzoom = Number(v);
                            });
                            if (styleRef.current) applyStyleToMap(styleRef.current);
                          }}
                        />
                      </label>
                    </div>

                    {bgColor != null && (
                      <ColorField
                        label="background-color"
                        value={bgColor}
                        onChange={(c) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'background-color': c };
                          })
                        }
                      />
                    )}
                    {(fillColor != null || selectedLayer.type === 'fill') && (
                      <ColorField
                        label="fill-color"
                        value={fillColor ?? '#cccccc'}
                        onChange={(c) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'fill-color': c };
                          })
                        }
                      />
                    )}
                    {(lineColor != null || selectedLayer.type === 'line') && (
                      <ColorField
                        label="line-color"
                        value={lineColor ?? '#333333'}
                        onChange={(c) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'line-color': c };
                          })
                        }
                      />
                    )}
                    {(textColor != null || selectedLayer.type === 'symbol') && (
                      <ColorField
                        label="text-color"
                        value={textColor ?? '#333333'}
                        onChange={(c) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'text-color': c };
                          })
                        }
                      />
                    )}

                    {(fillOpacity != null || selectedLayer.type === 'fill') && (
                      <NumberField
                        label="fill-opacity"
                        value={fillOpacity ?? 1}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(n) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'fill-opacity': n };
                          })
                        }
                      />
                    )}
                    {(lineOpacity != null || selectedLayer.type === 'line') && (
                      <NumberField
                        label="line-opacity"
                        value={lineOpacity ?? 1}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(n) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'line-opacity': n };
                          })
                        }
                      />
                    )}
                    {(lineWidth != null || selectedLayer.type === 'line') && (
                      <NumberField
                        label="line-width"
                        value={lineWidth ?? 1}
                        min={0}
                        max={32}
                        step={0.5}
                        onChange={(n) =>
                          patchSelectedLayer((layer) => {
                            layer.paint = { ...(layer.paint as object), 'line-width': n };
                          })
                        }
                      />
                    )}

                    <p className="text-slate-400 leading-snug pt-2 border-t">
                      颜色/线宽仅在 paint 为常量时可滑条编辑。表达式请到「高阶 JSON」修改，改完点「应用
                      JSON」。
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col p-2 gap-2">
                <textarea
                  className="flex-1 min-h-0 font-mono text-[10px] border rounded p-2 resize-none leading-snug"
                  spellCheck={false}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                />
                {jsonError && <div className="text-rose-600 text-[11px]">{jsonError}</div>}
                <button
                  type="button"
                  className="text-xs px-2 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 shrink-0"
                  onClick={onApplyJson}
                >
                  应用 JSON
                </button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-slate-500 font-mono">{label}</span>
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block space-y-0.5">
      <div className="flex justify-between text-slate-500">
        <span className="font-mono">{label}</span>
        <span>{value}</span>
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
