import { useEffect, useRef } from "react";
import "@google/model-viewer";
import * as THREE from "three";
import { distanceMm, type Vec3 } from "./logic";

export type Lighting = "studio" | "outdoor";

export interface MeasureResult { a: Vec3; b: Vec3; mm: number }

interface Props {
  /** Object URL of the GLB. */
  src: string;
  /** Object URL of the USDZ (Quick Look on iOS). */
  iosSrc?: string | undefined;
  arModes: string;
  arLabel: string;
  lighting: Lighting;
  grid: boolean;
  autoRotate: boolean;
  /** Bump to put the camera back to its starting view. */
  resetKey: number;
  measuring: boolean;
  /** Keep the camera when `src` changes (same object in another state); false = frame the new model. */
  keepCamera?: boolean;
  /** Names of nodes (parts) to hide. */
  hidden: ReadonlySet<string>;
  /** Size multipliers (x length, y height, z width); null = original size. Also used by WebXR and the generated USDZ. */
  scale?: Vec3 | null;
  /** Reports whether this device can start AR (model-viewer's `canActivateAR`), after load and on `ar-status`. */
  onArSupport?: (canActivate: boolean) => void;
  onLoad: (size: Vec3) => void;
  onMeasure: (r: MeasureResult | null, pointCount: number) => void;
  onError: () => void;
}

/** model-viewer's element exposes a few internals only through symbols; look them up by description. */
function findSymbol(obj: object, name: string): symbol | undefined {
  for (let o: object | null = obj; o; o = Object.getPrototypeOf(o) as object | null) {
    const s = Object.getOwnPropertySymbols(o).find((x) => x.description === name);
    if (s) return s;
  }
  return undefined;
}

type AnyEl = HTMLElement & Record<string | symbol, unknown> & {
  getDimensions(): { x: number; y: number; z: number };
  getCameraOrbit(): { toString(): string };
  getCameraTarget(): { toString(): string };
  getFieldOfView(): number;
  positionAndNormalFromPoint(x: number, y: number): { position: { x: number; y: number; z: number } } | null;
  jumpCameraToGoal(): void;
};

function sceneOf(el: AnyEl): THREE.Object3D | null {
  const s = findSymbol(el, "scene");
  const sc = s ? (el[s] as THREE.Object3D | undefined) : undefined;
  return sc && (sc as THREE.Object3D).isObject3D ? sc : null;
}

function needsRender(el: AnyEl): void {
  const s = findSymbol(el, "needsRender");
  const fn = s ? el[s] : undefined;
  if (typeof fn === "function") (fn as () => void).call(el);
}

export default function ModelStage(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<AnyEl | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const sizeRef = useRef<Vec3 | null>(null);
  const pointsRef = useRef<Vec3[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** Camera to put back after a model swap of the same object (doors open / closed, original / viewing version). */
  const keepCam = useRef<{ orbit: string; target: string; fov: number } | null>(null);

  // Create the element once per AR setup; a new model only swaps `src` (below), so the old model stays on screen
  // until the new one is loaded and the camera can be kept.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = document.createElement("model-viewer") as unknown as AnyEl;
    el.setAttribute("src", propsRef.current.src);
    if (propsRef.current.iosSrc) el.setAttribute("ios-src", propsRef.current.iosSrc);
    el.setAttribute("alt", "3D");
    el.setAttribute("camera-controls", "");
    el.setAttribute("touch-action", "pan-y");
    el.setAttribute("shadow-intensity", "1");
    el.setAttribute("interaction-prompt", "none");
    if (props.arModes) {
      el.setAttribute("ar", "");
      el.setAttribute("ar-modes", props.arModes);
      el.setAttribute("ar-scale", "fixed");
      const btn = document.createElement("button");
      btn.slot = "ar-button";
      btn.type = "button";
      btn.className = "w3v-ar-btn";
      btn.textContent = props.arLabel;
      el.appendChild(btn);
    }
    el.className = "w3v-mv";
    host.appendChild(el);
    elRef.current = el;
    pointsRef.current = [];
    gridRef.current = null;

    const onLoad = () => {
      const cam = keepCam.current;
      keepCam.current = null;
      if (cam) {
        el.setAttribute("camera-orbit", cam.orbit);
        el.setAttribute("camera-target", cam.target);
        el.setAttribute("field-of-view", `${cam.fov}deg`);
        el.jumpCameraToGoal();
      }
      const d = el.getDimensions();
      sizeRef.current = { x: d.x, y: d.y, z: d.z };
      propsRef.current.onLoad(sizeRef.current);
      applyGrid(el, propsRef.current.grid);
      applyHidden(el, propsRef.current.hidden);
      applyScale(el, propsRef.current.scale ?? null);
      reportAr();
    };
    const reportAr = () => propsRef.current.onArSupport?.((el as unknown as { canActivateAR?: boolean }).canActivateAR === true);
    const onErr = () => propsRef.current.onError();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const p = propsRef.current;
      if (!p.measuring || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const hit = el.positionAndNormalFromPoint(e.clientX, e.clientY);
      if (!hit) return;
      const pt = { x: hit.position.x, y: hit.position.y, z: hit.position.z };
      const pts = pointsRef.current.length >= 2 ? [] : pointsRef.current;
      pts.push(pt);
      pointsRef.current = pts;
      syncHotspots(el, pts);
      if (pts.length === 2) p.onMeasure({ a: pts[0]!, b: pts[1]!, mm: distanceMm(pts[0]!, pts[1]!) }, 2);
      else p.onMeasure(null, pts.length);
    };
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onErr);
    el.addEventListener("ar-status", reportAr);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onErr);
      el.removeEventListener("ar-status", reportAr);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.remove();
      elRef.current = null;
      gridRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.arModes]);

  // Quick Look file: the USDZ the engine made, only while the size is the original; a resized model has no matching
  // file, so the attribute goes away and model-viewer builds a USDZ from the live (scaled) scene.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (props.iosSrc) el.setAttribute("ios-src", props.iosSrc);
    else el.removeAttribute("ios-src");
  }, [props.iosSrc, props.arModes]);

  const sx = props.scale?.x ?? 1, sy = props.scale?.y ?? 1, sz = props.scale?.z ?? 1;
  useEffect(() => {
    const el = elRef.current;
    if (el) applyScale(el, props.scale ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sx, sy, sz, props.src]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || el.getAttribute("src") === props.src) return;
    try {
      keepCam.current = props.keepCamera ? { orbit: el.getCameraOrbit().toString(), target: el.getCameraTarget().toString(), fov: el.getFieldOfView() } : null;
    } catch {
      keepCam.current = null;
    }
    pointsRef.current = [];
    syncHotspots(el, []);
    el.setAttribute("src", props.src);
  }, [props.src, props.keepCamera]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (props.lighting === "studio") {
      el.setAttribute("environment-image", "neutral");
      el.setAttribute("exposure", "1");
      el.setAttribute("shadow-softness", "0.8");
    } else {
      el.setAttribute("environment-image", "legacy");
      el.setAttribute("exposure", "1.25");
      el.setAttribute("shadow-softness", "0.25");
    }
  }, [props.lighting, props.src]);

  useEffect(() => {
    const el = elRef.current;
    if (el) applyGrid(el, props.grid);
  }, [props.grid]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (props.autoRotate) el.setAttribute("auto-rotate", "");
    else el.removeAttribute("auto-rotate");
  }, [props.autoRotate, props.src]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || props.resetKey === 0) return;
    el.setAttribute("camera-orbit", "auto auto auto");
    el.setAttribute("camera-target", "auto auto auto");
    el.setAttribute("field-of-view", "auto");
    el.jumpCameraToGoal();
  }, [props.resetKey]);

  useEffect(() => {
    const el = elRef.current;
    if (el) applyHidden(el, props.hidden);
  }, [props.hidden]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || props.measuring) return;
    pointsRef.current = [];
    syncHotspots(el, []);
    props.onMeasure(null, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.measuring]);

  function applyGrid(el: AnyEl, on: boolean) {
    const scene = sceneOf(el);
    const size = sizeRef.current;
    if (!scene || !size) return;
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      gridRef.current = null;
    }
    if (on) {
      const maxMm = Math.max(size.x, size.z) * 1000;
      const cellMm = maxMm > 1000 ? 100 : 10; // 100 mm cells for big objects, 10 mm for small ones
      const sideMm = Math.max(cellMm * 10, Math.ceil((maxMm * 1.5) / cellMm / 10) * cellMm * 10);
      const g = new THREE.GridHelper(sideMm / 1000, sideMm / cellMm, 0x6b7a8c, 0x9aa7b8);
      const box = new THREE.Box3().setFromObject(scene);
      g.position.y = box.min.y;
      scene.add(g);
      gridRef.current = g;
    }
    needsRender(el);
  }

  function applyScale(el: AnyEl, sc: Vec3 | null) {
    el.setAttribute("scale", sc ? `${sc.x} ${sc.y} ${sc.z}` : "1 1 1");
    needsRender(el);
  }

  function applyHidden(el: AnyEl, hidden: ReadonlySet<string>) {
    const scene = sceneOf(el);
    if (!scene) return;
    scene.traverse((o) => {
      if (o.name && o !== scene && o !== gridRef.current) o.visible = !hidden.has(o.name);
    });
    needsRender(el);
  }

  return <div ref={hostRef} className="w3v-stage-host" />;
}

function syncHotspots(el: HTMLElement, pts: Vec3[]): void {
  el.querySelectorAll("[data-w3v-hotspot]").forEach((n) => n.remove());
  pts.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.slot = `hotspot-${i}`;
    b.className = "w3v-hotspot";
    b.dataset.w3vHotspot = "1";
    b.dataset.position = `${p.x}m ${p.y}m ${p.z}m`;
    b.dataset.normal = "0m 1m 0m";
    b.textContent = i === 0 ? "A" : "B";
    el.appendChild(b);
  });
}
