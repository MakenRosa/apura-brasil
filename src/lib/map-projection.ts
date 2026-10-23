import { MAP_WIDTH, MAP_HEIGHT, type MapFrame } from './map-camera.ts';

export type MapPosition = [number, number];
export type MapProjection = { x: number; y: number; scale: number; offsetX: number; offsetY: number };
const mercator = ([longitude, latitude]: MapPosition): MapPosition => [longitude, -Math.log(Math.tan(Math.PI / 4 + Math.max(-80, Math.min(80, latitude)) * Math.PI / 360)) * 180 / Math.PI];

export function createMapProjection(positions: Iterable<MapPosition>): MapProjection | null {
 let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
 for (const position of positions) {
  const [x, y] = mercator(position);
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
 }
 if (!Number.isFinite(left) || right <= left || bottom <= top) return null;
 const scale = Math.min((MAP_WIDTH - 130) / (right - left), (MAP_HEIGHT - 110) / (bottom - top));
 return { x: left, y: top, scale, offsetX: (MAP_WIDTH - (right - left) * scale) / 2, offsetY: (MAP_HEIGHT - (bottom - top) * scale) / 2 };
}

export function projectMapPoint(position: MapPosition, projection: MapProjection): MapPosition {
 const [x, y] = mercator(position);
 return [(x - projection.x) * projection.scale + projection.offsetX, (y - projection.y) * projection.scale + projection.offsetY];
}

/** Preserve every visible geographic point when switching from a UF to the national projection. */
export function rebaseMapFrame(frame: MapFrame, from: MapProjection, to: MapProjection): MapFrame {
 const ratio = to.scale / from.scale;
 return {
  x: (frame.x - from.offsetX) * ratio + (from.x - to.x) * to.scale + to.offsetX,
  y: (frame.y - from.offsetY) * ratio + (from.y - to.y) * to.scale + to.offsetY,
  w: frame.w * ratio,
  h: frame.h * ratio,
 };
}
