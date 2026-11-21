import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../../i18n";
import type { OfficeAgent } from "../../office/model";
import { loadOfficeZoom, saveOfficeZoom } from "../../lib/prefs";
import { fitView, panBy, pinchView, wheelView, zoomCenter } from "../../office/viewport";
import { clampPan, fitScale, zoomAt } from "../../office/zoom";
import type { Size, View } from "../../office/zoom";
import type { Point } from "../../office/layout";
import { useLayout } from "./OfficeScene";
import { OfficeScene25D } from "./OfficeScene25D";
import type { Employee } from "../../../../src/core/shared-types";
import { isoBounds } from "../../office/iso4";

/** A viewport width change beyond this fraction (vs. the last fitted width) resets to fit; smaller ones only re-clamp. */
const RESIZE_RESET_RATIO = 0.25;
/** Scale tolerance when deciding whether the scene is zoomed in beyond fit. */
const FIT_EPSILON = 0.01;

interface Pinch {
  startDist: number;
  startCenter: Point;
  startView: View;
}

export function OfficeViewport({ agents, running, employees }: { agents: OfficeAgent[]; running: boolean; employees?: readonly Employee[] }) {
  const { t } = useT();
  const L = useLayout();
  const content: Size = (() => { const b = isoBounds(L.scene); return { w: Math.round(b.w), h: Math.round(b.h) }; })();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>(() => ({ scale: loadOfficeZoom() ?? 1, pan: { x: 0, y: 0 } }));
  const viewRef = useRef(view);
  viewRef.current = view;
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const contentRef = useRef(content);
  contentRef.current = content;
  const fittedWidthRef = useRef(0);
  const savedScaleRef = useRef<number | null>(loadOfficeZoom());
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  const [dragging, setDragging] = useState(false);

  const commit = useCallback((next: View, persist: boolean) => {
    viewRef.current = next;
    setView(next);
    // Saved zoom is relative to the fit scale (1 = whole building in view), so it makes sense on any screen size.
    if (persist) {
      const f = fitScale(contentRef.current, vpRef.current);
      saveOfficeZoom(f > 0 ? next.scale / f : 1);
    }
  }, []);

  // Measure the frame.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const read = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout (WIDE <-> NARROW) change: content size differs, so go back to fit.
  const layoutKey = `${content.w}x${content.h}`;
  const layoutRef = useRef(layoutKey);
  useEffect(() => {
    if (layoutRef.current === layoutKey) return;
    layoutRef.current = layoutKey;
    if (vpRef.current.w > 0) {
      fittedWidthRef.current = vpRef.current.w;
      commit(fitView(content, vpRef.current), true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // Viewport measured/resized: first measure applies the saved zoom; a large change resets to fit; a small one re-clamps.
  useEffect(() => {
    if (viewport.w <= 0 || viewport.h <= 0) return;
    const c = contentRef.current;
    if (fittedWidthRef.current === 0) {
      fittedWidthRef.current = viewport.w;
      const fit = fitView(c, viewport);
      const saved = savedScaleRef.current;
      if (saved === null) commit(fit, false);
      else {
        const center = { x: viewport.w / 2, y: viewport.h / 2 };
        const rel = saved >= 1 ? saved : 1;
        const z = zoomAt(fit, center, fit.scale * rel);
        commit({ scale: z.scale, pan: clampPan(z.pan, z.scale, c, viewport) }, false);
      }
      return;
    }
    const change = Math.abs(viewport.w - fittedWidthRef.current) / fittedWidthRef.current;
    if (change > RESIZE_RESET_RATIO) {
      fittedWidthRef.current = viewport.w;
      commit(fitView(c, viewport), true);
    } else {
      const v = viewRef.current;
      commit({ scale: v.scale, pan: clampPan(v.pan, v.scale, c, viewport) }, false);
    }
  }, [viewport, commit]);

  // Ctrl+wheel zooms at the pointer; plain wheel scrolls the page as usual.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      commit(wheelView(viewRef.current, e.deltaY, anchor, contentRef.current, vpRef.current), true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commit]);

  const local = (e: ReactPointerEvent): Point => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startPinchIfTwo = () => {
    if (pointers.current.size !== 2) return;
    const [a, b] = [...pointers.current.values()] as [Point, Point];
    pinch.current = {
      startDist: Math.hypot(a.x - b.x, a.y - b.y),
      startCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startView: viewRef.current,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".office-zoom-bar")) return;
    pointers.current.set(e.pointerId, local(e));
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    setDragging(true);
    startPinchIfTwo();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const p = pinch.current;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      commit(pinchView(p.startView, p.startDist, dist, center, contentRef.current, vpRef.current, p.startCenter), false);
      return;
    }
    commit(panBy(viewRef.current, cur.x - prev.x, cur.y - prev.y, contentRef.current, vpRef.current), false);
  };
  const onPointerEnd = (e: ReactPointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const wasPinch = pinch.current !== null;
    pinch.current = null;
    if (pointers.current.size === 1) startPinchIfTwo();
    if (pointers.current.size === 0) setDragging(false);
    if (wasPinch) saveOfficeZoom(viewRef.current.scale);
  };

  const step = (dir: 1 | -1) => commit(zoomCenter(viewRef.current, dir, contentRef.current, vpRef.current), true);
  const reset = () => commit(fitView(contentRef.current, vpRef.current), true);

  // One-finger scroll must still scroll the page when nothing is zoomed in; once zoomed the scene owns the gesture.
  const zoomedIn = viewport.w > 0 && view.scale > fitScale(content, viewport) + FIT_EPSILON;
  const touchAction = zoomedIn ? "none" : "pan-y";

  return (
    <div
      ref={frameRef}
      className={`office-viewport${dragging ? " dragging" : ""}`}
      style={{ position: "relative", overflow: "hidden", touchAction, aspectRatio: `${content.w} / ${content.h}`, width: "100%" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className="office-viewport-content"
        style={{ width: content.w, height: content.h, transformOrigin: "0 0", transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.scale})` }}
      >
        <OfficeScene25D agents={agents} running={running} {...(employees ? { employees } : {})} />
      </div>
      <div className="office-zoom-bar" role="group">
        <button type="button" onClick={() => step(1)} aria-label={t.office_zoom_in} title={t.office_zoom_in}>+</button>
        <button type="button" onClick={() => step(-1)} aria-label={t.office_zoom_out} title={t.office_zoom_out}>−</button>
        <button type="button" onClick={reset} aria-label={t.office_zoom_reset} title={t.office_zoom_reset}>⤢</button>
      </div>
    </div>
  );
}
