// Pure zoom/pan helpers for the office scene. No framework or browser APIs.
import type { Point } from "./layout.js";

// Low enough that the whole isometric building fits a phone-width frame (about 0.23).
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

export interface View {
  scale: number;
  pan: Point;
}

export interface Size {
  w: number;
  h: number;
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

export function stepZoom(scale: number, dir: 1 | -1): number {
  return clampZoom(dir === 1 ? scale * ZOOM_STEP : scale / ZOOM_STEP);
}

// Zoom around an anchor point (viewport coordinates); the world point under it stays fixed.
export function zoomAt(view: View, anchor: Point, nextScale: number): View {
  const next = clampZoom(nextScale);
  const cur = clampZoom(view.scale);
  const worldX = (anchor.x - view.pan.x) / cur;
  const worldY = (anchor.y - view.pan.y) / cur;
  return {
    scale: next,
    pan: { x: anchor.x - worldX * next, y: anchor.y - worldY * next },
  };
}

function clampAxis(pan: number, scaled: number, viewport: number): number {
  if (scaled <= viewport) return (viewport - scaled) / 2;
  return Math.min(0, Math.max(viewport - scaled, pan));
}

export function clampPan(pan: Point, scale: number, content: Size, viewport: Size): Point {
  return {
    x: clampAxis(pan.x, content.w * scale, viewport.w),
    y: clampAxis(pan.y, content.h * scale, viewport.h),
  };
}

export function fitScale(content: Size, viewport: Size): number {
  const sizes = [content.w, content.h, viewport.w, viewport.h];
  if (sizes.some((n) => !Number.isFinite(n) || n <= 0)) return 1;
  return clampZoom(Math.min(viewport.w / content.w, viewport.h / content.h));
}
