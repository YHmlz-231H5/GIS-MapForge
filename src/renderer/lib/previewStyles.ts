/**
 * Adapt style/*.json for local PMTiles preview.
 *
 * Tiles + glyphs/sprites all local under vendor/map-assets when complete.
 * Run: npm run fetch:map-assets  (downloads full OpenFreeMap BMP glyph set)
 *
 * Missing glyph .pbf must never be served as HTML (see vite serve-vendor-static).
 */
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

import blueTech from '../../../style/blue-tech.json';
import desertCamo from '../../../style/desert-camo.json';
import whitePositron from '../../../style/white-positron.json';

export type PreviewStyleId = 'diagnostic' | 'blue-tech' | 'desert-camo' | 'white-positron';

export const PREVIEW_STYLE_OPTIONS: Array<{ id: PreviewStyleId; label: string }> = [
  { id: 'blue-tech', label: 'Blue Tech' },
  { id: 'desert-camo', label: 'Desert Camo' },
  { id: 'white-positron', label: 'White Positron' },
  { id: 'diagnostic', label: '简诊断' },
];

/** Resolve vendor/… to an absolute URL that works in Vite dev and Electron file://. */
export function localAssetUrl(relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, '');
  try {
    return new URL(`vendor/${cleaned}`, window.location.href).href;
  } catch {
    return `./vendor/${cleaned}`;
  }
}

const LOCAL_GLYPHS = () => `${localAssetUrl('map-assets/fonts')}/{fontstack}/{range}.pbf`;

const FONT_TO_LOCAL: Record<string, 'Noto Sans Regular' | 'Noto Sans Bold' | 'Noto Sans Italic'> = {
  'Metropolis Medium Italic': 'Noto Sans Italic',
  'Metropolis Light Italic': 'Noto Sans Italic',
  'Metropolis Regular': 'Noto Sans Regular',
  'Metropolis Light': 'Noto Sans Regular',
  'Metropolis Bold': 'Noto Sans Bold',
  'Metropolis Semi Bold': 'Noto Sans Bold',
  'Metropolis Medium': 'Noto Sans Regular',
  'Klokantech Noto Sans Regular': 'Noto Sans Regular',
  'Klokantech Noto Sans Bold': 'Noto Sans Bold',
  'Klokantech Noto Sans Italic': 'Noto Sans Italic',
  'Noto Sans Regular': 'Noto Sans Regular',
  'Noto Sans Bold': 'Noto Sans Bold',
  'Noto Sans Italic': 'Noto Sans Italic',
  'Noto Sans Medium': 'Noto Sans Regular',
  'Open Sans Regular': 'Noto Sans Regular',
  'Open Sans Bold': 'Noto Sans Bold',
  'Open Sans Italic': 'Noto Sans Italic',
};

function cloneStyle(raw: object): StyleSpecification {
  return JSON.parse(JSON.stringify(raw)) as StyleSpecification;
}

function normalizeTextFont(fonts: string[]): string[] {
  const mapped = fonts.map((f) => FONT_TO_LOCAL[f] ?? 'Noto Sans Regular');
  const unique: string[] = [];
  for (const f of mapped) {
    if (!unique.includes(f)) unique.push(f);
  }
  return unique.length ? unique : ['Noto Sans Regular'];
}

function remapFontsInLayers(layers: LayerSpecification[]) {
  for (const layer of layers) {
    const layout = layer.layout as Record<string, unknown> | undefined;
    if (!layout || !Array.isArray(layout['text-font'])) continue;
    layout['text-font'] = normalizeTextFont(layout['text-font'] as string[]);
  }
}

function spriteForStyle(styleId: Exclude<PreviewStyleId, 'diagnostic'>): string {
  const folder = styleId === 'desert-camo' ? 'dark-matter' : 'positron';
  return localAssetUrl(`map-assets/sprites/${folder}/sprite`);
}

export function adaptBundledStyleForPmtiles(
  styleId: Exclude<PreviewStyleId, 'diagnostic'>,
  sourceKey: string
): StyleSpecification {
  const raw =
    styleId === 'blue-tech' ? blueTech : styleId === 'desert-camo' ? desertCamo : whitePositron;
  const style = cloneStyle(raw);

  style.sources = {
    openmaptiles: {
      type: 'vector',
      url: `pmtiles://${sourceKey}`,
    },
  };

  style.glyphs = LOCAL_GLYPHS();
  style.sprite = spriteForStyle(styleId);
  if (style.layers) remapFontsInLayers(style.layers);

  delete (style as { metadata?: unknown }).metadata;

  return style;
}

export function localDiagnosticGlyphs(): string {
  return LOCAL_GLYPHS();
}

export function localPositronSprite(): string {
  return localAssetUrl('map-assets/sprites/positron/sprite');
}

export function createEmptyStyle(sourceKey: string, name = 'Untitled'): StyleSpecification {
  return {
    version: 8,
    name,
    glyphs: LOCAL_GLYPHS(),
    sprite: localPositronSprite(),
    sources: {
      openmaptiles: {
        type: 'vector',
        url: `pmtiles://${sourceKey}`,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#f2efe9' },
      },
    ],
  };
}

export function bindStyleToLocalPmtiles(
  raw: StyleSpecification,
  sourceKey: string,
  opts?: { spriteFolder?: 'positron' | 'dark-matter' }
): StyleSpecification {
  const style = cloneStyle(raw);
  const spriteFolder = opts?.spriteFolder ?? 'positron';

  style.sources = {
    openmaptiles: {
      type: 'vector',
      url: `pmtiles://${sourceKey}`,
    },
  };

  for (const layer of style.layers ?? []) {
    if ('source' in layer && layer.source && layer.source !== 'openmaptiles') {
      (layer as { source?: string }).source = 'openmaptiles';
    }
  }

  style.glyphs = LOCAL_GLYPHS();
  style.sprite = localAssetUrl(`map-assets/sprites/${spriteFolder}/sprite`);
  if (style.layers) remapFontsInLayers(style.layers);
  delete (style as { metadata?: unknown }).metadata;
  return style;
}

export function sourceLayersUsedByStyle(style: StyleSpecification): Set<string> {
  const set = new Set<string>();
  for (const layer of style.layers ?? []) {
    if ('source-layer' in layer && typeof layer['source-layer'] === 'string') {
      set.add(layer['source-layer']);
    }
  }
  return set;
}
