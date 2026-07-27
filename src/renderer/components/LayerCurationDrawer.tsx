/**
 * LayerCurationDrawer — configure Planetiler when generating vector tiles
 * (PMTiles or MBTiles archive).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  OPENMAPTILES_LAYERS,
  createDefaultPlanetilerForm,
  expandBbox,
  DEFAULT_BBOX_EXPAND_DEG,
  normalizeConvertMode,
  normalizeArchiveFormat,
  type PlanetilerConvertForm,
  type TempStorage,
  type NodemapType,
  type TileCompression,
  type TileFormat,
  type ConvertMode,
  type ArchiveFormat,
} from '../../shared/planetiler-options';
import { slugifyRegionName } from '../../shared/slugify';
import { useAppStore } from '../store';
import { Button } from './ui/Button';

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-slate-600 text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-400 leading-snug">{hint}</span>}
    </label>
  );
}

function BoolCheck({
  label,
  checked,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label
      className={`flex items-start gap-2 px-2 py-1.5 border rounded text-xs ${
        disabled ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'
      }`}
      title={hint}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[10px] text-slate-400 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

const inputCls =
  'w-full px-2 py-1.5 border rounded text-sm disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed';
const selectCls = inputCls;

export function LayerCurationDrawer() {
  const open = useAppStore((s) => s.layerDrawerOpen);
  const openPmtilesCuration = useAppStore((s) => s.openPmtilesCuration);
  const pendingConvertTask = useAppStore((s) => s.pendingConvertTask);

  const [form, setForm] = useState<PlanetilerConvertForm | null>(null);
  const [bboxText, setBboxText] = useState('');
  const [outputName, setOutputName] = useState('');
  const [busy, setBusy] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!pendingConvertTask) {
      setForm(null);
      return;
    }
    const bbox = pendingConvertTask.region.bbox;
    const defaults = createDefaultPlanetilerForm(bbox);
    const prev = pendingConvertTask.options?.planetiler_form;
    const next = prev
      ? {
          ...defaults,
          ...prev,
          mode: normalizeConvertMode(prev.mode),
          archive_format: normalizeArchiveFormat(prev.archive_format),
          // Prefer saved clip; otherwise default = download bbox + expand
          bbox_clip: prev.bbox_clip ?? defaults.bbox_clip,
        }
      : defaults;
    setForm(next);
    setBboxText(next.bbox_clip.join(','));
    const savedName = pendingConvertTask.options?.planetiler?.output_filename;
    const stem = (savedName || '')
      .replace(/\.(pmtiles|mbtiles)$/i, '')
      .trim();
    setOutputName(
      stem ||
        slugifyRegionName(pendingConvertTask.region.name, {
          bbox: pendingConvertTask.region.bbox,
          fallbackId: pendingConvertTask.id,
        })
    );
  }, [pendingConvertTask]);

  const locked = form?.mode === 'standard';
  const enabledLayerCount = useMemo(() => {
    if (!form) return 0;
    return OPENMAPTILES_LAYERS.filter((l) => form.layers[l.id]).length;
  }, [form]);

  if (!open || !pendingConvertTask || !form) return null;

  const close = () => openPmtilesCuration(null);

  const patch = (partial: Partial<PlanetilerConvertForm>) => {
    setForm((f) => (f ? { ...f, ...partial } : f));
  };

  const setMode = (mode: ConvertMode) => {
    if (!pendingConvertTask) return;
    if (mode === 'standard') {
      const archive_format = form?.archive_format ?? 'pmtiles';
      const next = createDefaultPlanetilerForm(pendingConvertTask.region.bbox, {
        mode: 'standard',
        archive_format,
      });
      setForm(next);
      setBboxText(next.bbox_clip.join(','));
    } else {
      setForm((f) => (f ? { ...f, mode: 'custom' } : f));
    }
  };

  const setLayer = (id: string, on: boolean) => {
    setForm((f) =>
      f ? { ...f, layers: { ...f.layers, [id]: on } } : f
    );
  };

  const setAllLayers = (on: boolean) => {
    setForm((f) => {
      if (!f) return f;
      const layers = Object.fromEntries(OPENMAPTILES_LAYERS.map((l) => [l.id, on]));
      return { ...f, layers };
    });
  };

  const parseBbox = (raw: string): [number, number, number, number] | null => {
    const arr = raw.split(',').map((s) => Number(s.trim()));
    if (arr.length === 4 && arr.every((n) => Number.isFinite(n))) {
      return arr as [number, number, number, number];
    }
    return null;
  };

  const submit = async () => {
    if (!pendingConvertTask.output_path) {
      alert('该任务没有输出文件，无法转换');
      return;
    }
    const parsedBbox = parseBbox(bboxText);
    if (!parsedBbox) {
      alert('bbox 格式无效，请使用 west,south,east,north');
      return;
    }

    const nameStem = slugifyRegionName(outputName || pendingConvertTask.region.name, {
      bbox: pendingConvertTask.region.bbox,
      fallbackId: pendingConvertTask.id,
    });

    const submitForm =
      form.mode === 'standard'
        ? createDefaultPlanetilerForm(pendingConvertTask.region.bbox, {
            mode: 'standard',
            bbox_clip: parsedBbox,
            archive_format: form.archive_format,
          })
        : { ...form, bbox_clip: parsedBbox };

    if (submitForm.mode === 'custom') {
      const anyLayer = OPENMAPTILES_LAYERS.some((l) => submitForm.layers[l.id]);
      if (!anyLayer) {
        alert('自定义模式下请至少勾选一个图层');
        return;
      }
    }

    setBusy(true);
    try {
      const r = await window.api.submitTask({
        kind: 'planetiler-convert',
        region: pendingConvertTask.region,
        options: {
          ...pendingConvertTask.options,
          osm_path: pendingConvertTask.output_path,
          planetiler_form: submitForm,
          planetiler: {
            ...pendingConvertTask.options?.planetiler,
            zoom_min: submitForm.minzoom,
            zoom_max: submitForm.maxzoom,
            bbox_clip: submitForm.bbox_clip,
            java_heap: submitForm.java_heap,
            download_aux: submitForm.download_aux,
            output_filename: nameStem,
            languages: submitForm.languages
              ? submitForm.languages.split(',').map((s) => s.trim()).filter(Boolean)
              : undefined,
          },
        },
      });
      if (!r.ok) {
        alert(`Planetiler 任务提交失败: ${r.error}`);
        return;
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
      <div className="bg-white w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-lg shadow-xl thin-scroll">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold shrink-0">矢量数据切片打包</h2>
            <button
              type="button"
              className="w-6 h-6 shrink-0 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm font-semibold"
              onClick={() => setShowIntro((v) => !v)}
              title="说明"
              aria-label="说明"
            >
              ?
            </button>
            <span className="text-xs text-slate-500 truncate">{pendingConvertTask.region.name}</span>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800" onClick={close}>
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5 text-sm">
          {showIntro && (
            <section className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-slate-700 space-y-2">
              <div className="font-medium text-slate-900">输出格式 · 标准 / 自定义</div>
              <ul className="list-disc pl-4 space-y-1 text-slate-600">
                <li>
                  <strong>PMTiles / MBTiles</strong>：同一套切片，不同档案容器；PMTiles 可应用内预览，MBTiles
                  更常见于传统离线工具。
                </li>
                <li>
                  <strong>标准</strong>：Planetiler / OpenMapTiles 社区默认（maxzoom=14、全图层）；参数只读。
                </li>
                <li>
                  <strong>自定义</strong>：可改图层与官方 CLI 参数（例如 maxzoom 最高 16）。
                </li>
                <li>
                  <strong>bbox 默认外扩</strong>：相对下载范围各边 +{DEFAULT_BBOX_EXPAND_DEG}°，减轻边缘瓦片过缩放导致的精细度隔断。
                </li>
                <li>输入：{pendingConvertTask.output_path}</li>
              </ul>
            </section>
          )}

          {/* Archive format — always editable */}
          <section>
            <h3 className="font-medium text-base mb-2">输出格式</h3>
            <div className="flex gap-2">
              {(
                [
                  {
                    id: 'pmtiles' as const,
                    title: 'PMTiles',
                    desc: '单文件 · 支持 Range · 可预览',
                  },
                  {
                    id: 'mbtiles' as const,
                    title: 'MBTiles',
                    desc: 'SQLite · 传统离线工具常用',
                  },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => patch({ archive_format: f.id as ArchiveFormat })}
                  className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 transition ${
                    form.archive_format === f.id
                      ? 'border-sky-600 bg-sky-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="font-semibold text-sm">{f.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{f.desc}</div>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <FieldRow
                label="输出文件名"
                hint="默认保留中文地名；勿使用 Windows 非法文件名字符"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    className={`${inputCls} font-mono text-xs flex-1`}
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    placeholder="例如：深圳大学城"
                  />
                  <span className="text-xs text-slate-500 shrink-0">
                    .{form.archive_format === 'mbtiles' ? 'mbtiles' : 'pmtiles'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 px-2 py-1.5 text-[11px] border rounded hover:bg-slate-50"
                    title="按区域名重新生成"
                    onClick={() =>
                      setOutputName(
                        slugifyRegionName(pendingConvertTask.region.name, {
                          bbox: pendingConvertTask.region.bbox,
                          fallbackId: pendingConvertTask.id,
                        })
                      )
                    }
                  >
                    用区域名
                  </button>
                </div>
              </FieldRow>
            </div>
          </section>

          {/* Mode */}
          <section>
            <h3 className="font-medium text-base mb-2">参数模式</h3>
            <div className="flex gap-2">
              {(
                [
                  {
                    id: 'standard' as const,
                    title: '标准',
                    desc: '社区默认 · maxzoom 14 · 全图层 · 只读',
                  },
                  {
                    id: 'custom' as const,
                    title: '自定义',
                    desc: '可改图层与参数 · maxzoom 最高 16',
                  },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 transition ${
                    form.mode === m.id
                      ? 'border-emerald-600 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="font-semibold text-sm">{m.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
            {locked && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                当前为标准模式：切片参数按社区默认只读。输出格式仍可切换。需要 z15/z16 或减图层时请切到「自定义」。
              </p>
            )}
          </section>

          {/* Layers */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-base">
                OpenMapTiles 图层
                <span className="text-xs font-normal text-slate-500 ml-2">
                  {enabledLayerCount}/{OPENMAPTILES_LAYERS.length}
                </span>
              </h3>
              {!locked && (
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-sky-700 hover:underline" onClick={() => setAllLayers(true)}>
                    全选
                  </button>
                  <button type="button" className="text-sky-700 hover:underline" onClick={() => setAllLayers(false)}>
                    全不选
                  </button>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              对应官方 <code className="bg-slate-100 px-1 rounded">--exclude-layers</code>
              （取消勾选的图层会被排除）。标准模式不传该参数。
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {OPENMAPTILES_LAYERS.map((l) => (
                <BoolCheck
                  key={l.id}
                  label={l.label}
                  checked={!!form.layers[l.id]}
                  disabled={locked}
                  onChange={(v) => setLayer(l.id, v)}
                />
              ))}
            </div>
          </section>

          {/* Bounds / zoom / heap */}
          <section className="space-y-3">
            <h3 className="font-medium text-base">范围 · 缩放 · 内存</h3>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950 leading-snug space-y-1">
              <div className="font-medium">
                默认已相对下载任务区域外扩 ±{DEFAULT_BBOX_EXPAND_DEG.toFixed(4)}°（写入下方 bbox / --bbox）
              </div>
              <div className="font-mono text-[10px] text-amber-900/90 break-all">
                区域：{pendingConvertTask.region.bbox.map((v) => v.toFixed(5)).join(', ')}
              </div>
              <div className="font-mono text-[10px] text-amber-900/90 break-all">
                外扩后：
                {expandBbox(pendingConvertTask.region.bbox)
                  .map((v) => v.toFixed(5))
                  .join(', ')}
              </div>
              <div className="text-amber-800/90">
                注意：边缘精细度主要取决于 OSM 是否已带缓冲下载。若仍有隔断，请用新版「下载数据」重下（已默认外扩），再转换。自定义模式可改 bbox；「恢复默认外扩」可还原。
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="minzoom" hint="--minzoom">
                <input
                  type="number"
                  min={0}
                  max={16}
                  className={inputCls}
                  disabled={locked}
                  value={form.minzoom}
                  onChange={(e) => patch({ minzoom: Number(e.target.value) || 0 })}
                />
              </FieldRow>
              <FieldRow label="maxzoom" hint="标准默认 14；自定义最高 16（--maxzoom）">
                <input
                  type="number"
                  min={0}
                  max={16}
                  className={inputCls}
                  disabled={locked}
                  value={form.maxzoom}
                  onChange={(e) => {
                    const n = Number(e.target.value) || 0;
                    patch({ maxzoom: Math.min(16, Math.max(0, n)) });
                  }}
                />
              </FieldRow>
              <FieldRow label="render_maxzoom" hint="标准默认 14；自定义最高 16">
                <input
                  type="number"
                  min={0}
                  max={16}
                  className={inputCls}
                  disabled={locked}
                  value={form.render_maxzoom}
                  onChange={(e) => {
                    const n = Number(e.target.value) || 0;
                    patch({ render_maxzoom: Math.min(16, Math.max(0, n)) });
                  }}
                />
              </FieldRow>
              <FieldRow label="Java 堆内存" hint="-Xmx（如 6g）">
                <input
                  className={inputCls}
                  disabled={locked}
                  value={form.java_heap}
                  onChange={(e) => patch({ java_heap: e.target.value })}
                />
              </FieldRow>
              <div className="col-span-2">
                <FieldRow
                  label="bbox（Planetiler 裁切）"
                  hint={`--bbox west,south,east,north · 默认=下载范围各边+${DEFAULT_BBOX_EXPAND_DEG}°`}
                >
                  <div className="flex gap-2 items-stretch">
                    <input
                      className={`${inputCls} font-mono text-xs flex-1`}
                      disabled={locked}
                      value={bboxText}
                      onChange={(e) => {
                        setBboxText(e.target.value);
                        const parsed = parseBbox(e.target.value);
                        if (parsed) patch({ bbox_clip: parsed });
                      }}
                    />
                    {!locked && (
                      <button
                        type="button"
                        className="shrink-0 px-2 text-[11px] border rounded hover:bg-slate-50 text-slate-700"
                        title="恢复为下载范围 + 默认外扩"
                        onClick={() => {
                          const expanded = expandBbox(pendingConvertTask.region.bbox);
                          setBboxText(expanded.join(','));
                          patch({ bbox_clip: expanded });
                        }}
                      >
                        恢复默认外扩
                      </button>
                    )}
                  </div>
                </FieldRow>
              </div>
            </div>
          </section>

          {/* Profile */}
          <section className="space-y-2">
            <h3 className="font-medium text-base">OpenMapTiles Profile</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <BoolCheck
                label="building_merge_z13"
                hint="z13 合并邻近建筑（默认开，耗 CPU）"
                checked={form.building_merge_z13}
                disabled={locked}
                onChange={(v) => patch({ building_merge_z13: v })}
              />
              <BoolCheck
                label="transportation_z13_paths"
                hint="z13 显示全部小路"
                checked={form.transportation_z13_paths}
                disabled={locked}
                onChange={(v) => patch({ transportation_z13_paths: v })}
              />
              <BoolCheck
                label="transportation_name_brunnel"
                hint="路名保留 brunnel 属性"
                checked={form.transportation_name_brunnel}
                disabled={locked}
                onChange={(v) => patch({ transportation_name_brunnel: v })}
              />
              <BoolCheck
                label="transportation_name_size_for_shield"
                hint="短路段也出路名（盾牌）"
                checked={form.transportation_name_size_for_shield}
                disabled={locked}
                onChange={(v) => patch({ transportation_name_size_for_shield: v })}
              />
              <BoolCheck
                label="transportation_name_limit_merge"
                hint="限制路名线合并"
                checked={form.transportation_name_limit_merge}
                disabled={locked}
                onChange={(v) => patch({ transportation_name_limit_merge: v })}
              />
              <BoolCheck
                label="transportation_name_minor_refs"
                hint="次要路网 name/ref"
                checked={form.transportation_name_minor_refs}
                disabled={locked}
                onChange={(v) => patch({ transportation_name_minor_refs: v })}
              />
              <BoolCheck
                label="boundary_country_names"
                hint="边界左右国别码"
                checked={form.boundary_country_names}
                disabled={locked}
                onChange={(v) => patch({ boundary_country_names: v })}
              />
              <BoolCheck
                label="boundary_osm_only"
                hint="边界只用 OSM（含低级别）"
                checked={form.boundary_osm_only}
                disabled={locked}
                onChange={(v) => patch({ boundary_osm_only: v })}
              />
              <BoolCheck
                label="transliterate"
                hint="拉丁转写 name:latin"
                checked={form.transliterate}
                disabled={locked}
                onChange={(v) => patch({ transliterate: v })}
              />
              <BoolCheck
                label="use_wikidata"
                hint="使用 Wikidata 译名"
                checked={form.use_wikidata}
                disabled={locked}
                onChange={(v) => patch({ use_wikidata: v })}
              />
              <BoolCheck
                label="fetch_wikidata"
                hint="先下载 Wikidata 译名再继续"
                checked={form.fetch_wikidata}
                disabled={locked}
                onChange={(v) => patch({ fetch_wikidata: v })}
              />
            </div>
            <FieldRow label="languages" hint="--languages 逗号分隔；留空=官方默认列表">
              <input
                className={inputCls}
                disabled={locked}
                placeholder="例如 zh,en,ja"
                value={form.languages}
                onChange={(e) => patch({ languages: e.target.value })}
              />
            </FieldRow>
          </section>

          {/* Quality */}
          <section className="space-y-3">
            <h3 className="font-medium text-base">瓦片质量</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="simplify_tolerance">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  disabled={locked}
                  value={form.simplify_tolerance}
                  onChange={(e) => patch({ simplify_tolerance: Number(e.target.value) })}
                />
              </FieldRow>
              <FieldRow label="simplify_tolerance_at_max_zoom">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  disabled={locked}
                  value={form.simplify_tolerance_at_max_zoom}
                  onChange={(e) => patch({ simplify_tolerance_at_max_zoom: Number(e.target.value) })}
                />
              </FieldRow>
              <FieldRow label="min_feature_size">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  disabled={locked}
                  value={form.min_feature_size}
                  onChange={(e) => patch({ min_feature_size: Number(e.target.value) })}
                />
              </FieldRow>
              <FieldRow label="min_feature_size_at_max_zoom">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  disabled={locked}
                  value={form.min_feature_size_at_max_zoom}
                  onChange={(e) => patch({ min_feature_size_at_max_zoom: Number(e.target.value) })}
                />
              </FieldRow>
              <FieldRow label="tile_compression">
                <select
                  className={selectCls}
                  disabled={locked}
                  value={form.tile_compression}
                  onChange={(e) => patch({ tile_compression: e.target.value as TileCompression })}
                >
                  <option value="gzip">gzip</option>
                  <option value="none">none</option>
                </select>
              </FieldRow>
              <FieldRow label="tile_format">
                <select
                  className={selectCls}
                  disabled={locked}
                  value={form.tile_format}
                  onChange={(e) => patch({ tile_format: e.target.value as TileFormat })}
                >
                  <option value="mvt">mvt</option>
                  <option value="mlt">mlt</option>
                </select>
              </FieldRow>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <BoolCheck
                label="skip_filled_tiles"
                hint="跳过纯填充瓦片"
                checked={form.skip_filled_tiles}
                disabled={locked}
                onChange={(v) => patch({ skip_filled_tiles: v })}
              />
              <BoolCheck
                label="exclude_ids"
                hint="不写入 feature ID"
                checked={form.exclude_ids}
                disabled={locked}
                onChange={(v) => patch({ exclude_ids: v })}
              />
            </div>
          </section>

          {/* Performance */}
          <section className="space-y-3">
            <h3 className="font-medium text-base">性能 · 临时存储</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="threads" hint="留空=Planetiler 默认（全部核心）">
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  disabled={locked}
                  placeholder="自动"
                  value={form.threads ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    patch({ threads: v === '' ? null : Number(v) || null });
                  }}
                />
              </FieldRow>
              <FieldRow label="storage" hint="临时数据存储">
                <select
                  className={selectCls}
                  disabled={locked}
                  value={form.storage}
                  onChange={(e) => patch({ storage: e.target.value as TempStorage })}
                >
                  <option value="mmap">mmap</option>
                  <option value="ram">ram</option>
                  <option value="direct">direct</option>
                </select>
              </FieldRow>
              <FieldRow label="nodemap_type">
                <select
                  className={selectCls}
                  disabled={locked}
                  value={form.nodemap_type}
                  onChange={(e) => patch({ nodemap_type: e.target.value as NodemapType })}
                >
                  <option value="sparsearray">sparsearray</option>
                  <option value="sortedtable">sortedtable</option>
                  <option value="array">array</option>
                  <option value="noop">noop</option>
                </select>
              </FieldRow>
              <FieldRow label="nodemap_storage">
                <select
                  className={selectCls}
                  disabled={locked}
                  value={form.nodemap_storage}
                  onChange={(e) => patch({ nodemap_storage: e.target.value as TempStorage })}
                >
                  <option value="mmap">mmap</option>
                  <option value="ram">ram</option>
                  <option value="direct">direct</option>
                </select>
              </FieldRow>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <BoolCheck
                label="compress_temp"
                hint="压缩临时 feature 存储"
                checked={form.compress_temp}
                disabled={locked}
                onChange={(v) => patch({ compress_temp: v })}
              />
              <BoolCheck
                label="download_aux"
                hint="预下载 natural_earth / water / lake（应用侧）"
                checked={form.download_aux}
                disabled={locked}
                onChange={(v) => patch({ download_aux: v })}
              />
              <BoolCheck
                label="free_osm_after_read"
                checked={form.free_osm_after_read}
                disabled={locked}
                onChange={(v) => patch({ free_osm_after_read: v })}
              />
              <BoolCheck
                label="free_natural_earth_after_read"
                checked={form.free_natural_earth_after_read}
                disabled={locked}
                onChange={(v) => patch({ free_natural_earth_after_read: v })}
              />
              <BoolCheck
                label="free_water_polygons_after_read"
                checked={form.free_water_polygons_after_read}
                disabled={locked}
                onChange={(v) => patch({ free_water_polygons_after_read: v })}
              />
              <BoolCheck
                label="free_lake_centerlines_after_read"
                checked={form.free_lake_centerlines_after_read}
                disabled={locked}
                onChange={(v) => patch({ free_lake_centerlines_after_read: v })}
              />
            </div>
          </section>
        </div>

        <div className="p-4 border-t flex justify-end gap-2 bg-white sticky bottom-0">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="default" disabled={busy} onClick={submit}>
            {busy ? '提交中…' : '▶ 开始切片打包'}
          </Button>
        </div>
      </div>
    </div>
  );
}
