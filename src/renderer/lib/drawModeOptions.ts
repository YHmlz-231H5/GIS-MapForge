/**
 * Terra Draw mode options: larger vertices for draw + select/edit.
 */
import {
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw';

const NODE = {
  color: '#0ea5e9',
  outline: '#ffffff',
  width: 7,
  outlineWidth: 2,
} as const;

const POLY_STYLE = {
  fillColor: '#38bdf8',
  fillOpacity: 0.22,
  outlineColor: '#0284c7',
  outlineWidth: 2,
} as const;

export function buildDrawModeOptions() {
  return {
    polygon: new TerraDrawPolygonMode({
      editable: true,
      styles: {
        ...POLY_STYLE,
        closingPointColor: NODE.color,
        closingPointWidth: NODE.width,
        closingPointOutlineColor: NODE.outline,
        closingPointOutlineWidth: NODE.outlineWidth,
      },
    }),
    rectangle: new TerraDrawRectangleMode({
      styles: { ...POLY_STYLE },
    }),
    select: new TerraDrawSelectMode({
      styles: {
        selectedPolygonColor: POLY_STYLE.fillColor,
        selectedPolygonFillOpacity: 0.28,
        selectedPolygonOutlineColor: POLY_STYLE.outlineColor,
        selectedPolygonOutlineWidth: 2.5,
        selectionPointColor: NODE.color,
        selectionPointWidth: NODE.width,
        selectionPointOutlineColor: NODE.outline,
        selectionPointOutlineWidth: NODE.outlineWidth,
        midPointColor: '#f59e0b',
        midPointWidth: 6,
        midPointOutlineColor: '#ffffff',
        midPointOutlineWidth: 2,
      },
      flags: {
        polygon: {
          feature: {
            draggable: true,
            coordinates: {
              midpoints: true,
              draggable: true,
              deletable: true,
            },
          },
        },
        rectangle: {
          feature: {
            draggable: true,
            coordinates: {
              midpoints: true,
              draggable: true,
              resizable: 'opposite',
              deletable: false,
            },
          },
        },
      },
    }),
  };
}
