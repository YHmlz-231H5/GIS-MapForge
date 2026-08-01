import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export {
  bboxAreaKm2,
  estimateRasterDownload,
  estimateRasterTileCount,
} from '../../shared/geo';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Estimate OSM PBF size for a bbox using a simple density heuristic. */
export function estimatePbfSize(area_km2: number): { pbfMB: number; pmtilesMB: number; tiles88: number } {
  // Local densities: ~50 nodes/km² in dense cities, ~10 nodes/km² average world
  // We pick a middle estimate assuming medium urban density.
  const estimated_nodes = Math.round(area_km2 * 1000); // 1000 nodes/km² average
  const pbfKB = estimated_nodes * 0.4; // ~0.4 KB per node for OSM XML
  const pbfMB = Math.max(0.5, pbfKB / 1024);
  // PMTiles roughly 5–10% of PBF after Planetiler compression + generalization
  const pmtilesMB = pbfMB * 0.10;
  // OSM API tile count: 25 km² tiles (CELL=0.02°), grid covers bbox
  const tiles88 = Math.ceil((area_km2 / 25) * 1.05);
  return { pbfMB: Math.round(pbfMB * 10) / 10, pmtilesMB: Math.round(pmtilesMB * 10) / 10, tiles88 };
}
