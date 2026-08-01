import { useState, useCallback } from 'react';
import {
  Download,
  RectangleHorizontal,
  Square,
  Pentagon,
  Pencil,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Region } from '../../shared/types';
import { useAppStore } from '../store';
import { bboxAreaKm2, estimatePbfSize, estimateRasterDownload, formatBytes } from '../lib/utils';
import { activateDrawMode, type DrawToolMode } from '../lib/drawControl';
import { DEFAULT_RASTER_UI_MAX_ZOOM } from '../../shared/raster-sources';

/** Pull just the local name out of "龙华区, 深圳市, 广东省, 中国". */
function shortName(displayName: string): string {
  return displayName.split(',')[0]?.trim() ?? displayName;
}

const DRAW_TOOL_BTN =
  'inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-sky-200 bg-white text-sky-800 hover:bg-sky-100';

export function RegionPanel() {
  const { t } = useTranslation();
  const region = useAppStore((s) => s.region);
  const setRegion = useAppStore((s) => s.setRegion);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Region[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boundaryLoading, setBoundaryLoading] = useState(false);

  const enhanceRegionWithBoundary = useCallback(async (r: Region): Promise<Region> => {
    if (r.source !== 'photon' && r.source !== 'nominatim') return r;
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
    } catch {
      // silent
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

  const runDraw = (mode: DrawToolMode) => {
    const r = activateDrawMode(mode);
    if (!r.ok) window.alert(r.reason);
  };

  const sizes = region ? estimatePbfSize(region.area_km2) : null;
  const rasterEst = region
    ? estimateRasterDownload(region.bbox, 0, DEFAULT_RASTER_UI_MAX_ZOOM)
    : null;

  return (
    <div className="p-3 space-y-3 text-sm">
      <div>
        <h2 className="font-semibold text-base flex items-center gap-2">📍 {t('region.title')}</h2>
        <p className="text-xs text-slate-500 mt-1">{t('region.subtitle')}</p>
      </div>

      <div className="rounded border border-sky-100 bg-sky-50/80 px-2.5 py-2 space-y-1.5">
        <div className="text-xs font-medium text-sky-900">{t('region.drawTitle')}</div>
        <p className="text-[11px] text-sky-800/90 leading-snug">{t('region.drawHint')}</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={DRAW_TOOL_BTN}
            onClick={() => runDraw('rectangle')}
          >
            <RectangleHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('region.drawRect')}
          </button>
          <button
            type="button"
            className={DRAW_TOOL_BTN}
            onClick={() => runDraw('square')}
          >
            <Square className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('region.drawSquare')}
          </button>
          <button
            type="button"
            className={DRAW_TOOL_BTN}
            onClick={() => runDraw('polygon')}
          >
            <Pentagon className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('region.drawPolygon')}
          </button>
          <button
            type="button"
            className={DRAW_TOOL_BTN}
            onClick={() => runDraw('select')}
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('region.drawSelect')}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1">
          <input
            className="flex-1 text-sm border border-slate-300 rounded px-2 py-1 bg-white"
            placeholder={t('region.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded border"
            disabled={searching}
            onClick={handleSearch}
          >
            {searching ? t('region.searching') : '🔍'}
          </button>
        </div>

        <button
          className="w-full px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded border"
          onClick={handleJsonImport}
        >
          📁 {t('region.pickGeoJson')}
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          ❌ {error}
        </div>
      )}

      {searchResults.length > 1 && (
        <div className="text-xs space-y-1">
          <div className="text-slate-500">{t('region.multiResults')}</div>
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
              {region.adcode && (
                <>
                  {' '}
                  · adcode <span className="font-mono">{region.adcode}</span>
                </>
              )}
              {boundaryLoading && <> · 🛰 {t('region.boundaryLoading')}</>}
              {Boolean(region.boundary_geojson) && !boundaryLoading && (
                <> · 🛰 {t('region.boundaryLoaded')}</>
              )}
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

          {(sizes || rasterEst) && (
            <div className="text-[10px] text-slate-600 space-y-1.5 border-t pt-2">
              {sizes && (
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-700">{t('region.vectorEstimate')}</div>
                  <div>PBF ≈ {formatBytes(sizes.pbfMB * 1024 * 1024)}</div>
                  <div>PMTiles ≈ {formatBytes(sizes.pmtilesMB * 1024 * 1024)}</div>
                  <div>{t('region.osmTiles', { count: sizes.tiles88 })}</div>
                </div>
              )}
              {rasterEst && (
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-700">
                    {t('region.rasterEstimate', {
                      min: rasterEst.minZoom,
                      max: rasterEst.maxZoom,
                    })}
                  </div>
                  <div>
                    {t('region.rasterTiles', {
                      tiles: rasterEst.tiles.toLocaleString(),
                      bytes: formatBytes(rasterEst.bytes),
                    })}
                  </div>
                  <div className="text-slate-400">{t('region.rasterHint')}</div>
                </div>
              )}
            </div>
          )}

          <button
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium inline-flex items-center justify-center gap-1.5"
            onClick={() => useAppStore.getState().openDownloadDrawer()}
          >
            <Download className="w-4 h-4" aria-hidden />
            {t('region.download')}
          </button>
        </div>
      )}
    </div>
  );
}
