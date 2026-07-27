/**
 * Pack an already-downloaded raster XYZ directory → MBTiles or PMTiles.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { HandlerFn } from './_types';
import { resolveOutputDir } from '../../paths';
import { packDirectoryToMbtiles } from './pack-mbtiles';
import { packDirectoryToPmtiles } from './pack-pmtiles';
import { slugifyRegionName } from '../../../shared/slugify';

export const execRasterPackArchive: HandlerFn = async (task, _abort, pushLog, pushProgress) => {
  const pack = task.options.raster_pack;
  if (!pack?.tile_dir) {
    throw new Error('raster_pack.tile_dir is required');
  }
  const tileDir = pack.tile_dir;
  if (!existsSync(tileDir)) {
    throw new Error(`Tile directory not found: ${tileDir}`);
  }

  const archive = pack.archive === 'pmtiles' ? 'pmtiles' : 'mbtiles';
  const format = (pack.format ?? 'png') as 'png' | 'jpeg' | 'webp';
  const minZoom = pack.min_zoom ?? 0;
  const maxZoom = pack.max_zoom ?? 20;
  const attribution = pack.attribution ?? '';
  const sourceId = pack.source_id ?? 'raster';
  const bounds = pack.bbox ?? task.region.bbox;

  const outputDir = resolveOutputDir();
  const slug = slugifyRegionName(task.region.name, {
    bbox: task.region.bbox,
    fallbackId: task.id,
  });
  const ext = archive === 'pmtiles' ? 'pmtiles' : 'mbtiles';
  const outFile = resolve(outputDir, `${slug}-${sourceId}.${ext}`);

  pushLog('out', `[raster-pack] ${archive} ← ${tileDir}`);
  pushLog('out', `[raster-pack] → ${outFile}`);
  pushProgress?.({ ratio: 0.1, phase: `pack-${archive}` });

  const fmtForPack = format === 'jpeg' ? 'jpg' : format;

  if (archive === 'mbtiles') {
    const { tiles } = packDirectoryToMbtiles({
      tileDir,
      outputPath: outFile,
      name: `${task.region.name} (${sourceId})`,
      format: fmtForPack,
      attribution,
      minZoom,
      maxZoom,
      bounds,
    });
    pushLog('out', `[raster-pack] packed ${tiles} tiles → MBTiles`);
    pushProgress?.({ ratio: 1, phase: 'done' });
    return {
      output_path: outFile,
      metadata: {
        container: 'mbtiles',
        format,
        tile_dir: tileDir,
        tiles,
        source_id: sourceId,
        min_zoom: minZoom,
        max_zoom: maxZoom,
        attribution,
      },
    };
  }

  const { tiles } = await packDirectoryToPmtiles({
    tileDir,
    outputPath: outFile,
    format: fmtForPack,
    attribution,
    name: `${task.region.name} (${sourceId})`,
    bounds,
    minZoom,
    maxZoom,
  });
  pushLog('out', `[raster-pack] packed ${tiles} tiles → PMTiles`);
  pushProgress?.({ ratio: 1, phase: 'done' });
  return {
    output_path: outFile,
    metadata: {
      container: 'pmtiles',
      format,
      tile_dir: tileDir,
      tiles,
      source_id: sourceId,
      min_zoom: minZoom,
      max_zoom: maxZoom,
      attribution,
    },
  };
};
