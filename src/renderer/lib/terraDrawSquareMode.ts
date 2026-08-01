/**
 * Square draw mode: same click/drag UX as rectangle, but the live preview
 * and finished geometry stay geographic-square (equal metres) while dragging.
 */
import {
  TerraDrawRectangleMode,
  type TerraDrawMouseEvent,
  type TerraDrawKeyboardEvent,
} from 'terra-draw';

/** Constrain `end` so the bbox from `origin` is square in metres. */
export function squareEndFromOrigin(
  origin: [number, number],
  endLng: number,
  endLat: number
): { lng: number; lat: number } {
  const [ox, oy] = origin;
  const cos = Math.max(0.2, Math.cos((oy * Math.PI) / 180));
  const dLon = endLng - ox;
  const dLat = endLat - oy;
  const absLonM = Math.abs(dLon) * cos;
  const absLatM = Math.abs(dLat);
  const side = Math.max(absLonM, absLatM, 1e-9);
  const signLon = dLon === 0 ? 1 : Math.sign(dLon);
  const signLat = dLat === 0 ? 1 : Math.sign(dLat);
  return {
    lng: ox + signLon * (side / cos),
    lat: oy + signLat * side,
  };
}

export class TerraDrawSquareMode extends TerraDrawRectangleMode {
  override mode = 'square';

  private squareOrigin: [number, number] | null = null;

  private constrain(event: TerraDrawMouseEvent): TerraDrawMouseEvent {
    if (!this.squareOrigin) return event;
    const sq = squareEndFromOrigin(this.squareOrigin, event.lng, event.lat);
    return { ...event, lng: sq.lng, lat: sq.lat };
  }

  override onClick(event: TerraDrawMouseEvent): void {
    if (!this.squareOrigin) {
      this.squareOrigin = [event.lng, event.lat];
      super.onClick(event);
      return;
    }
    super.onClick(this.constrain(event));
    this.squareOrigin = null;
  }

  override onMouseMove(event: TerraDrawMouseEvent): void {
    super.onMouseMove(this.constrain(event));
  }

  override onDragStart(
    event: TerraDrawMouseEvent,
    setMapDraggability: (enabled: boolean) => void
  ): void {
    this.squareOrigin = [event.lng, event.lat];
    super.onDragStart(event, setMapDraggability);
  }

  override onDrag(
    event: TerraDrawMouseEvent,
    setMapDraggability: (enabled: boolean) => void
  ): void {
    super.onDrag(this.constrain(event), setMapDraggability);
  }

  override onDragEnd(
    event: TerraDrawMouseEvent,
    setMapDraggability: (enabled: boolean) => void
  ): void {
    super.onDragEnd(this.constrain(event), setMapDraggability);
    this.squareOrigin = null;
  }

  override onKeyUp(event: TerraDrawKeyboardEvent): void {
    super.onKeyUp(event);
    // Escape / Enter finish or cancel via parent; drop origin either way.
    if (event.key === 'Escape' || event.key === 'Enter') this.squareOrigin = null;
  }

  override cleanUp(): void {
    this.squareOrigin = null;
    super.cleanUp();
  }
}
