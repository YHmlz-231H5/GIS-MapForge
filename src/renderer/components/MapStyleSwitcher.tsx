import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import {
  VECTOR_BASEMAPS,
  RASTER_BASEMAPS,
  findBasemap,
  type RasterBasemap,
} from '../data/basemaps';
import {
  probeAllBasemaps,
  probeBasemapById,
  persistHealthy,
  upsertProbeResult,
} from '../lib/basemapHealth';
import { SignalBars, formatProbeLatency, type BasemapProbeStatus } from './BasemapSignal';

type BasemapTab = 'vector' | 'raster';

/** Fixed column widths so every row aligns: signal | name | latency | ✓ | tag */
const ROW_GRID =
  'grid grid-cols-[14px_minmax(0,1fr)_3.25rem_1rem_2.25rem] items-center gap-x-2';

function tabForBasemapId(id: string): BasemapTab {
  const b = findBasemap(id);
  if (!b) return 'vector';
  return b.group === 'vector' ? 'vector' : 'raster';
}

function rasterSubtypeLabel(b: RasterBasemap): string {
  return b.subtype === 'imagery' ? '卫星' : '街道';
}

export function MapStyleSwitcher({ leftOffset = 12 }: { leftOffset?: number }) {
  const basemapId = useAppStore((s) => s.basemapId);
  const setBasemapId = useAppStore((s) => s.setBasemapId);
  const ranked = useAppStore((s) => s.basemapRanked);
  const setRanked = useAppStore((s) => s.setBasemapRanked);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BasemapTab>(() => tabForBasemapId(basemapId));
  const [probing, setProbing] = useState(false);
  const probingRef = useRef(false);

  const current = findBasemap(basemapId);
  const selectedNeedsKey = !!current?.id.startsWith('maptiler-');
  const statusOf = (id: string): BasemapProbeStatus | undefined =>
    ranked.find((r) => r.id === id) as BasemapProbeStatus | undefined;
  const currentTab = current ? tabForBasemapId(current.id) : tab;
  const currentStatus = statusOf(basemapId);

  const handleSelect = (id: string) => {
    setBasemapId(id);
    setTab(tabForBasemapId(id));
    try {
      localStorage.setItem('mapdownloader.basemap.preferred', id);
    } catch {}
    setOpen(false);
  };

  const handleReprobe = useCallback(async () => {
    if (probingRef.current) return;
    probingRef.current = true;
    setProbing(true);
    try {
      const next = await probeAllBasemaps();
      persistHealthy(next);
      setRanked(next);
    } finally {
      probingRef.current = false;
      setProbing(false);
    }
  }, [setRanked]);

  const openPanel = () => {
    setTab(tabForBasemapId(basemapId));
    setOpen((v) => !v);
  };

  // Persistent header: probe current source every 5s.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled || probingRef.current) return;
      const one = await probeBasemapById(basemapId);
      if (cancelled) return;
      const prev = useAppStore.getState().basemapRanked;
      const next = upsertProbeResult(prev, one);
      persistHealthy(next);
      setRanked(next);
    };
    run();
    const timer = window.setInterval(run, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [basemapId, setRanked]);

  // When panel opens, auto trigger one full re-probe.
  useEffect(() => {
    if (!open) return;
    handleReprobe();
  }, [open, handleReprobe]);

  return (
    <div
      className="absolute z-10 w-[22rem] max-w-[calc(100%-1.5rem)] select-none ui-motion-x"
      style={{ top: 'var(--ui-space)', transform: `translate3d(${leftOffset}px, 0, 0)` }}
    >
      <button
        onClick={openPanel}
        className="w-full bg-white/95 backdrop-blur shadow-md border border-slate-300 rounded-lg pl-2.5 pr-2.5 py-2 text-xs flex items-center gap-2 hover:bg-white"
        data-testid="basemap-button"
        aria-label="切换底图"
        aria-expanded={open}
        title={`当前底图: ${current?.label ?? '未知'}`}
      >
        <SignalBars status={currentStatus} />
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-semibold text-slate-800 truncate">{current?.label ?? '未选择'}</span>
            <span className="text-[10px] text-slate-400 font-mono tabular-nums shrink-0 ml-1">
              {formatProbeLatency(currentStatus)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 block truncate text-left">
            {currentTab === 'vector' ? '矢量地图' : '栅格地图'}
            {current && current.group === 'raster' && <> · {rasterSubtypeLabel(current)}</>}
          </span>
        </div>
        <ChevronDown open={open} />
      </button>

      <div
        className={`w-full mt-1 origin-top ui-motion-dropdown ${
          open ? 'ui-dropdown-open' : 'ui-dropdown-closed'
        }`}
        aria-hidden={!open}
      >
        <div className="bg-white shadow-xl border border-slate-200 rounded overflow-hidden">
          <div className="flex border-b border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setTab('vector')}
              className={tabButtonClass(tab === 'vector')}
            >
              🛣 矢量地图 ({VECTOR_BASEMAPS.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('raster')}
              className={tabButtonClass(tab === 'raster')}
            >
              🛰 栅格地图 ({RASTER_BASEMAPS.length})
            </button>
          </div>

          {selectedNeedsKey && (
            <div className="px-3 py-2 text-[10px] text-amber-700 bg-amber-50 border-b border-amber-200">
              选中的底图需要 MapTiler key. 请在 ⚙ 设置 中填入后重新选择.
            </div>
          )}

          <div className={`${ROW_GRID} px-3 py-1.5 border-b bg-slate-50 text-[10px] text-slate-400`}>
            <span />
            <span>底图</span>
            <span className="text-right">延迟</span>
            <span />
            <span className="text-center">类型</span>
          </div>

          <div className="max-h-80 overflow-y-auto thin-scroll">
            {tab === 'vector'
              ? VECTOR_BASEMAPS.map((b) => (
                  <BasemapRow
                    key={b.id}
                    label={b.label}
                    tag="矢量"
                    isCurrent={b.id === basemapId}
                    status={statusOf(b.id)}
                    onSelect={() => handleSelect(b.id)}
                  />
                ))
              : RASTER_BASEMAPS.map((b) => (
                  <BasemapRow
                    key={b.id}
                    label={b.label}
                    tag={rasterSubtypeLabel(b)}
                    isCurrent={b.id === basemapId}
                    status={statusOf(b.id)}
                    onSelect={() => handleSelect(b.id)}
                  />
                ))}
          </div>

          <div className="border-t px-3 py-2 bg-slate-50 text-[10px] text-slate-500 flex items-center justify-between">
            <span>
              {probing
                ? '测速中…'
                : ranked.length === 0
                  ? '尚未测速'
                  : `${ranked.filter((r) => r.ok).length}/${ranked.length} 可连通`}
            </span>
            <button
              type="button"
              disabled={probing}
              onClick={handleReprobe}
              className="text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline"
            >
              {probing ? '测速中…' : '重新测速'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-md text-slate-500 bg-slate-100/80 ui-motion-transform ${
        open ? 'rotate-180' : 'rotate-0'
      }`}
      aria-hidden
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="block">
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function tabButtonClass(active: boolean): string {
  // Always reserve border-b-2 so active state does not shift text vertically.
  return [
    'flex-1 px-3 py-2 text-xs border-b-2 -mb-px',
    active
      ? 'border-blue-500 font-medium text-blue-700 bg-white'
      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-800',
  ].join(' ');
}

function BasemapRow({
  label,
  tag,
  isCurrent,
  status,
  onSelect,
}: {
  label: string;
  tag?: string;
  isCurrent: boolean;
  status?: BasemapProbeStatus;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 text-xs border-b last:border-b-0 transition-colors ${
        isCurrent ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-800'
      }`}
    >
      <div className={ROW_GRID}>
        <SignalBars status={status} />
        <span className={`truncate ${isCurrent ? 'font-medium' : ''}`}>{label}</span>
        <span className="text-[10px] text-slate-400 font-mono tabular-nums text-right">
          {formatProbeLatency(status)}
        </span>
        <span className="text-blue-600 text-center text-sm leading-none">{isCurrent ? '✓' : ''}</span>
        <span className="text-[9px] text-slate-500 text-center truncate">
          {tag ?? ''}
        </span>
      </div>
    </button>
  );
}
