/** Shared bbox helpers used by IPC handlers. */

import type { BBox } from '../../shared/types';

/** Bbox area in km^2 (rough — uses middle-latitude approximation). */
export function estimateAreaKm2(bbox: BBox): number {
  const [, south, , north] = bbox;
  const dLat = north - south;
  const midLat = (north + south) / 2;
  const dLon = bbox[2] - bbox[0];
  const kmLat = dLat * 111;
  const kmLon = dLon * 111 * Math.cos((midLat * Math.PI) / 180);
  return Math.abs(kmLat * kmLon);
}
