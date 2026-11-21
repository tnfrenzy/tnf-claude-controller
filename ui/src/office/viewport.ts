// Pure viewport transitions for the office scene, built on zoom.ts. No DOM.
import type { Point } from "./layout.js";
import { clampPan, clampZoom, fitScale, stepZoom, zoomAt } from "./zoom.js";
import type { Size, View } from "./zoom.js";

function settle(view: View, content: Size, viewport: Size): View {
  const scale = clampZoom(view.scale);
  return { scale, pan: clampPan(view.pan, scale, content, viewport) };
}

export function fitView(content: Size, viewport: Size): View {
  const scale = fitScale(content, viewport);
  return settle({ scale, pan: { x: 0, y: 0 } }, content, viewport);
}

// Button zoom: around the viewport center.
export function zoomCenter(view: View, dir: 1 | -1, content: Size, viewport: Size): View {
  const center: Point = { x: viewport.w / 2, y: viewport.h / 2 };
  return settle(zoomAt(view, center, stepZoom(view.scale, dir)), content, viewport);
}

export function panBy(view: View, dx: number, dy: number, content: Size, viewport: Size): View {
  return settle({ scale: view.scale, pan: { x: view.pan.x + dx, y: view.pan.y + dy } }, content, viewport);
}

// Pinch: `view` is the view at gesture start; scale follows the distance ratio.
// `startCenter` is the finger midpoint at start, `center` the current midpoint; pan follows the midpoint.
export function pinchView(
  view: View,
  startDist: number,
  curDist: number,
  center: Point,
  content: Size,
  viewport: Size,
  startCenter: Point = center,
): View {
  if (!(startDist > 0) || !Number.isFinite(curDist) || curDist <= 0) return settle(view, content, viewport);
  const zoomed = zoomAt(view, startCenter, view.scale * (curDist / startDist));
  const moved: View = {
    scale: zoomed.scale,
    pan: { x: zoomed.pan.x + (center.x - startCenter.x), y: zoomed.pan.y + (center.y - startCenter.y) },
  };
  return settle(moved, content, viewport);
}

// Ctrl+wheel: negative deltaY zooms in, anchored at the pointer.
export function wheelView(view: View, deltaY: number, anchor: Point, content: Size, viewport: Size): View {
  const factor = Math.exp(-deltaY * 0.0015);
  return settle(zoomAt(view, anchor, view.scale * factor), content, viewport);
}
