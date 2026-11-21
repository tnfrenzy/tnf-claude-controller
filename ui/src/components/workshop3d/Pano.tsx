import { useEffect, useRef, useState } from "react";
import type { W3DApi } from "./types";

export const PANO_PATH = "renders/pano/pano.jpg";

interface PannellumViewer { destroy(): void }
interface PannellumApi { viewer(el: HTMLElement, cfg: Record<string, unknown>): PannellumViewer }

let loading: Promise<PannellumApi> | null = null;
/** Pannellum (MIT, shipped in ui/public/vendor/pannellum) is loaded on first use only. */
function loadPannellum(): Promise<PannellumApi> {
  const w = window as unknown as { pannellum?: PannellumApi };
  if (w.pannellum) return Promise.resolve(w.pannellum);
  if (loading) return loading;
  loading = new Promise<PannellumApi>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/pannellum/pannellum.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "vendor/pannellum/pannellum.js";
    s.onload = () => (w.pannellum ? resolve(w.pannellum) : reject(new Error("pannellum")));
    s.onerror = () => { loading = null; reject(new Error("pannellum")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** 360° view from the middle of the cabin (equirectangular Blender render, renders/pano/pano.jpg). */
export default function Workshop3DPano(props: { api: W3DApi; rev: number; failText: string; waitText: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let dead = false;
    let url: string | null = null;
    let viewer: PannellumViewer | null = null;
    setState("loading");
    Promise.all([props.api.file(PANO_PATH), loadPannellum()]).then(([blob, pn]) => {
      if (dead || !host.current) return;
      url = URL.createObjectURL(blob);
      viewer = pn.viewer(host.current, { type: "equirectangular", panorama: url, autoLoad: true, showControls: true, hfov: 100, yaw: 0 });
      setState("ready");
    }).catch(() => { if (!dead) setState("error"); });
    return () => { dead = true; try { viewer?.destroy(); } catch { /* already gone */ } if (url) URL.revokeObjectURL(url); };
  }, [props.api, props.rev]);
  return (
    <div className="w3v-pano-wrap">
      <div ref={host} className="w3v-pano" data-w3v="pano" />
      {state === "loading" ? <div className="fine">{props.waitText}</div> : null}
      {state === "error" ? <div className="w3v-err">{props.failText}</div> : null}
    </div>
  );
}
