import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import type { Region } from '../../shared/types';
import { useAppStore } from '../store';
import { bboxAreaKm2, estimatePbfSize, formatBytes } from '../lib/utils';
import { squareBbox, bboxToPolygonFeature } from '../lib/regionFromDraw';
import { activateDrawMode, clearAllDrawings } from '../lib/drawControl';

/** Pull just the local name out of "龙华区, 深圳市, 广东省, 中国". */
function shortName(displayName: string): string {
  return displayName.split(',')[0]?.trim() ?? displayName;
}

export function RegionPanel() {
  const region = useAppStore((s) => s.region);
  const setRegion = useAppStore((s) => s.setRegion);
  const drawPreferSquare = useAppStore((s) => s.drawPreferSquare);
  const setDrawPreferSquare = useAppStore((s) => s.setDrawPreferSquare);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Region[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boundaryLoading, setBoundaryLoading] = useState(false);

  /** After region set, try to find Chinese admin boundary via Photon → DataV heuristic. */
  const enhanceRegionWithBoundary = useCallback(async (r: Region): Promise<Region> => {
    if (r.source !== 'photon' && r.source !== 'nominatim') return r;
    // Only attempt when in China (Photon sets countrycode 'CN')
    if (!r.name.includes('中国') && !r.name.includes('CN')) {
      // Heuristic: if name looks like an administrative unit, try anyway
      // (Photon displayname includes country always for CN results)
    }
    setBoundaryLoading(true);
    try {
      const adcodeRes = await window.api.guessRegionAdcode({ name: shortName(r.name), bbox: r.bbox });
      if (adcodeRes.ok && adcodeRes.data && adcodeRes.data.adcode) {
        return {
          ...r,
          adcode: adcodeRes.data.adcode,
          boundary_geojson: adcodeRes.data.boundary,
        };
      }
    } catch (err) {
      // silent — user still has the bbox, just no overlay
    } finally {
      setBoundaryLoading(false);
    }
    return r;
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    const r = await window.api.searchRegion(searchQuery);
    setSearching(false);
    if (!r.ok) {
      setError(r.error ?? 'unknown');
      setSearchResults([]);
      return;
    }
    setSearchResults(r.data ?? []);
    // Auto-pick first, then enrich with boundary
    if (r.data && r.data[0]) {
      const enriched = await enhanceRegionWithBoundary(r.data[0]);
      setRegion(enriched);
    }
  }, [searchQuery, setRegion, enhanceRegionWithBoundary]);

  const handleJsonImport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (e) {
        setError(`JSON parse error: ${(e as Error).message}`);
        return;
      }
      const r = await window.api.resolveRegionFromGeoJson(json);
      if (!r.ok) {
        setError(r.error ?? 'unknown');
        return;
      }
      setRegion(r.data!);
      setError(null);
    };
    input.click();
  }, [setRegion]);

  const handleManualEdit = (i: number, v: number) => {
    if (!region) return;
    const next: [number, number, number, number] = [...region.bbox];
    next[i] = v;
    const area = bboxAreaKm2(next);
    setRegion({
      ...region,
      bbox: next,
      area_km2: area,
      estimated_nodes: Math.round(area * 1000),
      source: 'manual',
    });
  };

  const sizes = region ? estimatePbfSize(region.area_km2) : null;

  return (
    <div className="p-3 space-y-3 text-sm">
      <div>
        <h2 className="font-semibold text-base flex items-center gap-2">
          📍 选择区域
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          搜索地名 / 地图绘制 / 导入 GeoJSON / 手动编辑 bbox
        </p>
      </div>

      <div className="rounded border border-sky-100 bg-sky-50/80 px-2.5 py-2 space-y-1.5">
        <div className="text-xs font-medium text-sky-900">地图绘制</div>
        <p className="text-[11px] text-sky-800/90 leading-snug">
          点下方按钮后在地图上绘制。画完后自动进入选择模式，可拖动蓝色节点改形状；清除会去掉绘制与选区图层。
        </p>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="px-2 py-1 text-[11px] bg-white hover:bg-sky-100 rounded border border-sky-200"
            onClick={() => {
              const r = activateDrawMode('rectangle');
              if (!r.ok) window.alert(r.reason);
            }}
          >
            矩形拉框
          </button>
          <button
            type="button"
            className="px-2 py-1 text-[11px] bg-white hover:bg-sky-100 rounded border border-sky-200"
            onClick={() => {
              const r = activateDrawMode('polygon');
              if (!r.ok) window.alert(r.reason);
            }}
          >
            多边形
          </button>
          <button
            type="button"
            className="px-2 py-1 text-[11px] bg-white hover:bg-sky-100 rounded border border-sky-200"
            onClick={() => {
              const r = activateDrawMode('select');
              if (!r.ok) window.alert(r.reason);
            }}
          >
            选择编辑
          </button>
          <button
            type="button"
            className="px-2 py-1 text-[11px] bg-white hover:bg-rose-50 rounded border border-rose-200 text-rose-700"
            onClick={() => {
              const r = clearAllDrawings();
              setRegion(null);
              if (!r.ok) window.alert(r.reason);
            }}
          >
            清除绘制
          </button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-sky-900 cursor-pointer">
          <input
            type="checkbox"
            checked={drawPreferSquare}
            onChange={(e) => setDrawPreferSquare(e.target.checked)}
          />
          矩形完成后收成正方形（等距）
        </label>
        {region && (
          <button
            type="button"
            className="w-full px-2 py-1 text-[11px] bg-white hover:bg-sky-100 rounded border border-sky-200"
            onClick={() => {
              const sq = squareBbox(region.bbox);
              const area = bboxAreaKm2(sq);
              setRegion({
                ...region,
                name: region.source === 'map-draw' ? region.name : `${region.name}（正方形）`,
                bbox: sq,
                area_km2: area,
                estimated_nodes: Math.round(area * 1000),
                source: 'map-draw',
                boundary_geojson: bboxToPolygonFeature(sq, { square: true }),
              });
            }}
          >
            将当前选区收成正方形
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex gap-1">
          <input
            className="flex-1 text-sm border border-slate-300 rounded px-2 py-1 bg-white"
            placeholder="搜索地名 (深圳龙华)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded border"
            disabled={searching}
            onClick={handleSearch}
          >
            {searching ? '搜索中…' : '🔍'}
          </button>
        </div>

        <button
          className="w-full px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded border"
          onClick={handleJsonImport}
        >
          📁 拖入 / 选择 GeoJSON 文件
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          ❌ {error}
        </div>
      )}

      {searchResults.length > 1 && (
        <div className="text-xs space-y-1">
          <div className="text-slate-500">多个结果，挑选一个：</div>
          {searchResults.map((r, i) => (
            <button
              key={i}
              className="block w-full text-left truncate bg-slate-50 hover:bg-slate-100 px-2 py-1 rounded text-xs border"
              onClick={async () => {
                const enriched = await enhanceRegionWithBoundary(r);
                setRegion(enriched);
              }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {region && (
        <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs space-y-2">
          <div>
            <div className="font-medium text-sm">{region.name}</div>
            <div className="text-slate-500 text-[10px]">
              {region.area_km2.toFixed(1)} km² · {region.source}
              {region.adcode && <> · adcode <span className="font-mono">{region.adcode}</span></>}
              {boundaryLoading && <> · 🛰 加载边界…</>}
              {Boolean(region.boundary_geojson) && !boundaryLoading && <> · 🛰 行政边界已加载</>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1">
            {(['west', 'south', 'east', 'north'] as const).map((label, i) => (
              <label key={label} className="flex items-center gap-1">
                <span className="text-slate-500 w-4 text-right">{label[0].toUpperCase()}</span>
                <input
                  type="number"
                  step="0.001"
                  className="flex-1 px-1 py-0.5 text-[10px] border rounded font-mono"
                  value={region.bbox[i].toFixed(4)}
                  onChange={(e) => handleManualEdit(i, parseFloat(e.target.value) || region.bbox[i])}
                />
              </label>
            ))}
          </div>

          {sizes && (
            <div className="text-[10px] text-slate-600 space-y-0.5 border-t pt-2">
              <div>PBF ≈ {formatBytes(sizes.pbfMB * 1024 * 1024)}</div>
              <div>PMTiles ≈ {formatBytes(sizes.pmtilesMB * 1024 * 1024)}</div>
              <div>OSM API tiles ≈ {sizes.tiles88}</div>
            </div>
          )}

          <button
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium inline-flex items-center justify-center gap-1.5"
            onClick={() => useAppStore.getState().openDownloadDrawer()}
          >
            <Download className="w-4 h-4" aria-hidden />
            下载数据
          </button>
        </div>
      )}
    </div>
  );
}
