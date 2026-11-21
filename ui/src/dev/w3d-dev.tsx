/** Dev-only page (vite dev server, /w3d-dev.html): Workshop3DViewer against a mock of the part-1 API. */
import React from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { I18nContext, dicts, type Lang } from "../i18n";
import Workshop3DViewer from "../components/workshop3d/Workshop3DViewer";
import { VariantsPanel } from "../components/workshop3d/VariantsPanel";
import { makeMockVariantsApi, mockMaterialsApi } from "./variants-mock";
import type { W3DApi, W3DDetail, W3DParams } from "../components/workshop3d/types";
import glbUrl from "../../../fixtures/workshop3d-viewer/model.glb?url";
import floorUrl from "../../../fixtures/workshop3d-viewer/part-floor.stl?url";
import ceilingUrl from "../../../fixtures/workshop3d-viewer/part-ceiling.stl?url";

const q = new URLSearchParams(location.search);
const lang: Lang = q.get("lang") === "en" ? "en" : "vi";
const platform = (q.get("platform") as "ios" | "android" | "desktop" | null) ?? undefined;
const noModel = q.has("nomodel");

const FILES = [
  "outputs/model.glb", "outputs/model-mobile.glb", "outputs/model.usdz", "outputs/model.step",
  "outputs/parts/floor.stl", "outputs/parts/ceiling.stl",
];
const RENDERS = ["renders/front.png", "renders/back.png", "renders/left.png", "renders/iso.png", "renders/pano/pano.jpg"];

function renderPng(label: string): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 480;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, "#dfe6ee"); grad.addColorStop(1, "#9fb0c4");
  g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
  g.fillStyle = "#6b7a8c"; g.fillRect(170, 90, 300, 300);
  g.fillStyle = "#e8edf3"; g.fillRect(190, 110, 260, 260);
  g.fillStyle = "#223"; g.font = "28px sans-serif"; g.fillText(`mock ${label}`, 230, 250);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

/** Mock equirectangular image (2:1) with a grid, so dragging in the 360° view is visible. */
function renderPano(): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 2048; c.height = 1024;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, "#c8d2de"); grad.addColorStop(0.5, "#8a98a8"); grad.addColorStop(1, "#3c4450");
  g.fillStyle = grad; g.fillRect(0, 0, 2048, 1024);
  g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 3;
  for (let x = 0; x <= 2048; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
  for (let y = 0; y <= 1024; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(2048, y); g.stroke(); }
  g.fillStyle = "#112"; g.font = "64px sans-serif";
  ["TRƯỚC", "PHẢI", "SAU", "TRÁI"].forEach((t, i) => g.fillText(t, 256 + i * 512, 540));
  return new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.9));
}

let state: W3DDetail["snapshot"]["state"] = "done";
let round = 1;
let params: W3DParams = { width_mm: 1400, depth_mm: 1600, height_mm: 2300, wall_material: "inox 304 xước" };
let timer: number | undefined;

const mock: W3DApi = {
  async detail() {
    return {
      brief: { title: "Cabin thang khách 630 kg", object: "cabin thang máy", params },
      snapshot: { state, round, fixRounds: 0, costUsd: 0.41, note: state === "building" ? "chạy lại bước dựng" : null, error: null, questions: [], issues: [] },
      files: noModel ? [] : FILES,
      renders: noModel ? [] : RENDERS,
      report: null,
    };
  },
  async file(path) {
    if (path.endsWith(".glb")) return fetch(glbUrl).then((r) => r.blob());
    if (path.endsWith("floor.stl")) return fetch(floorUrl).then((r) => r.blob());
    if (path.endsWith("ceiling.stl")) return fetch(ceilingUrl).then((r) => r.blob());
    if (path.endsWith("pano.jpg")) return renderPano();
    if (path.endsWith(".png")) return renderPng(path.split("/").pop()!.replace(".png", ""));
    return new Blob([new Uint8Array(8)]);
  },
  async rebuild(p) {
    params = { ...params, ...(p ?? {}) };
    state = "building";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { state = "done"; round += 1; }, 5000);
  },
};

const variantsView = q.get("view") === "variants";
const variantsApi = variantsView ? makeMockVariantsApi(() => fetch(glbUrl).then((r) => r.blob()), q.get("slots") !== "none") : null;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nContext.Provider value={{ lang, t: dicts[lang], setLang: () => undefined }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: 16 }}>
        {variantsApi ? <VariantsPanel slug="mock-cabin" api={variantsApi} matApi={mockMaterialsApi} /> : <Workshop3DViewer slug="mock-cabin" api={mock} {...(platform ? { platform } : {})} />}
      </div>
    </I18nContext.Provider>
  </React.StrictMode>,
);
