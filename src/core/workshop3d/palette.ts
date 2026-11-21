// src/core/workshop3d/palette.ts — colours measured by code (tools/workshop3d/w3d_palette.py, CAD python, no tokens):
// reference-palette.json from the user's reference images (input of material-artist) and color-delta.json from the
// renders (input of visual-reviewer). Never fails a session: no reference image, no python or a script error = skipped.
import fs from "node:fs";
import path from "node:path";
import { defaultCadRunner, type CadRunner } from "../design3d/cad-tools.js";
import { W3D_TOOLS_DIR } from "./script-check.js";
import type { W3DStore } from "./store.js";

export const REFERENCE_PALETTE = "reference-palette.json";
export const COLOR_DELTA = "color-delta.json";
const TIMEOUT_MS = 120_000;
const HEX_RE = /^#[0-9a-f]{6}$/;
const REGION_IDS = ["tran", "vach", "san", "toan_anh"] as const;
const REGION_LABEL: Record<(typeof REGION_IDS)[number], string> = { tran: "trần/nửa trên", vach: "vách/giữa", san: "sàn/dưới", toan_anh: "toàn ảnh" };
const LEVEL_LABEL: Record<string, string> = { ok: "gần", lech_vua: "lệch vừa", lech_nhieu: "LỆCH NHIỀU" };

/** What the runner needs (index.ts wires createColorDeps; tests inject fakes; absent = no colour measurement). */
export interface W3DColorDeps {
  /** Write reference-palette.json when missing or older than an image. Returns a warning, or null. */
  palette(slug: string, references: string[]): Promise<string | null>;
  /** Write color-delta.json for these renders (absolute paths). Needs reference-palette.json; returns a warning, or null. */
  delta(slug: string, renders: string[], mode: "fast" | "hq"): Promise<string | null>;
}

const mtime = (f: string): number => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};

/** False for a reference-palette.json written before the contrast field (so the floor/detail check has data): rewritten once. */
function paletteHasDetail(file: string): boolean {
  try {
    return fs.readFileSync(file, "utf8").includes('"contrast"');
  } catch {
    return false;
  }
}

export function createColorDeps(opts: { store: W3DStore; python: () => string | null; run?: CadRunner }): W3DColorDeps {
  const run = opts.run ?? defaultCadRunner;
  const script = path.join(W3D_TOOLS_DIR, "w3d_palette.py");
  const exec = async (args: string[], out: string): Promise<string | null> => {
    const py = opts.python();
    if (!py) return "Không có Python CAD: bỏ qua đo màu ảnh.";
    try {
      const r = await run(py, [script, ...args, "--out", out], TIMEOUT_MS);
      if (r.timedOut) return "Đo màu ảnh quá thời gian: bỏ qua.";
      if (r.code !== 0) {
        const last = r.stdout.trim().split("\n").pop() ?? "";
        let why = last;
        try {
          why = String((JSON.parse(last) as { error?: unknown }).error ?? last);
        } catch {
          /* raw line */
        }
        return `Đo màu ảnh lỗi: ${why.slice(0, 200)}`;
      }
      return null;
    } catch (e) {
      return `Đo màu ảnh lỗi: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
    }
  };
  return {
    async palette(slug, references) {
      if (references.length === 0) return null;
      const out = path.join(opts.store.dir(slug), REFERENCE_PALETTE);
      const t = mtime(out);
      if (t > 0 && references.every((r) => mtime(r) <= t) && paletteHasDetail(out)) return null;
      return exec(["palette", ...references], out);
    },
    async delta(slug, renders, mode) {
      const dir = opts.store.dir(slug);
      const pal = path.join(dir, REFERENCE_PALETTE);
      if (!fs.existsSync(pal) || renders.length === 0) return null;
      fs.rmSync(path.join(dir, COLOR_DELTA), { force: true });
      return exec(["delta", pal, ...renders, "--mode", mode], path.join(dir, COLOR_DELTA));
    },
  };
}

// ---------------------------------------------------------------- prompt text (pure; only validated numbers and hex)

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const hex = (v: unknown): string | null => (typeof v === "string" && HEX_RE.test(v) ? v : null);
const safeName = (v: unknown): string => (typeof v === "string" ? v.replace(/[^\w.-]/g, "_").slice(0, 60) : "?");
const pct = (v: number): string => `${Math.round(v * 100)} %`;

type Region = { mean_hex?: unknown; brightness?: unknown; dominant?: { hex?: unknown; share?: unknown; brightness?: unknown }[] };

/** reference-palette.json as short lines for material-artist; null when the file has nothing usable. */
export function paletteText(pal: unknown): string | null {
  const imgs = (pal as { images?: { image?: unknown; regions?: Record<string, Region> }[] } | null)?.images;
  if (!Array.isArray(imgs)) return null;
  const lines: string[] = [];
  for (const im of imgs.slice(0, 5)) {
    const rows: string[] = [];
    for (const id of REGION_IDS) {
      const r = im.regions?.[id];
      const m = hex(r?.mean_hex);
      const b = num(r?.brightness);
      if (!r || !m || b === null) continue;
      const dom = (Array.isArray(r.dominant) ? r.dominant : [])
        .slice(0, 4)
        .map((d) => (hex(d.hex) && num(d.share) !== null ? `${hex(d.hex)} ${pct(num(d.share)!)}` : null))
        .filter((x): x is string => !!x);
      rows.push(`- ${REGION_LABEL[id]}: trung bình ${m}, độ sáng ${b.toFixed(2)}; màu chủ đạo ${dom.join(", ") || "(không có)"}`);
    }
    if (rows.length) lines.push(`Ảnh ${safeName(im.image)}:`, ...rows);
  }
  return lines.length ? lines.join("\n") : null;
}

type DeltaRegion = { render_hex?: unknown; ref_hex?: unknown; dE?: unknown; dL?: unknown; level?: unknown; dom_dE?: unknown; render_dom_hex?: unknown; ref_dom_hex?: unknown; contrast_ratio?: unknown };

/** Floor / detail hint of one region: dominant (stone) colour distance and vein contrast; "" when there is nothing to say. */
function detailCell(r: DeltaRegion): string {
  const dom = num(r.dom_dE);
  const cr = num(r.contrast_ratio);
  const parts: string[] = [];
  if (dom !== null && dom >= 12 && hex(r.render_dom_hex) && hex(r.ref_dom_hex)) parts.push(`màu chủ đạo ${hex(r.render_dom_hex)} so ${hex(r.ref_dom_hex)} (dE ${dom.toFixed(1)})`);
  if (cr !== null && cr < 0.5) parts.push(`vân/chi tiết phẳng hơn ảnh mẫu (độ tương phản x${cr.toFixed(2)})`);
  else if (cr !== null && cr > 2) parts.push(`vân/chi tiết gắt hơn ảnh mẫu (độ tương phản x${cr.toFixed(2)})`);
  return parts.join(", ");
}

/** color-delta.json as a short table for visual-reviewer; null when the file has nothing usable. */
export function deltaText(delta: unknown): string | null {
  const d = delta as { mode?: unknown; views?: { view?: unknown; regions?: Record<string, DeltaRegion> }[]; thresholds?: { warn_dE?: unknown; bad_dE?: unknown } } | null;
  if (!d || !Array.isArray(d.views)) return null;
  const rows: string[] = [];
  for (const v of d.views.slice(0, 12)) {
    const cells: string[] = [];
    for (const id of REGION_IDS) {
      const r = v.regions?.[id];
      const de = num(r?.dE);
      const dl = num(r?.dL);
      if (!r || de === null || dl === null || !hex(r.render_hex) || !hex(r.ref_hex)) continue;
      const lv = typeof r.level === "string" ? (LEVEL_LABEL[r.level] ?? "") : "";
      cells.push(`${REGION_LABEL[id]} ${hex(r.render_hex)} so ${hex(r.ref_hex)}: dE ${de.toFixed(1)}, dL ${dl > 0 ? "+" : ""}${dl.toFixed(1)} (${lv})`);
    }
    for (const id of ["san", "vach"] as const) {
      const r = v.regions?.[id];
      const d = r ? detailCell(r) : "";
      if (d) cells.push(`${REGION_LABEL[id]}: ${d}`);
    }
    if (cells.length) rows.push(`- ${safeName(v.view)}: ${cells.join("; ")}`);
  }
  if (!rows.length) return null;
  const warn = num(d.thresholds?.warn_dE) ?? 12;
  const bad = num(d.thresholds?.bad_dE) ?? 25;
  return [`Ảnh ${d.mode === "hq" ? "Blender" : "render nhanh"}; ngưỡng: dE < ${warn} gần, ${warn}–${bad} lệch vừa, ≥ ${bad} lệch nhiều; dL < 0 = ảnh render tối hơn ảnh mẫu.`, ...rows].join("\n");
}

/** Read a session JSON file and turn it into prompt text; null when missing or unusable. */
export function readColorText(dir: string, file: typeof REFERENCE_PALETTE | typeof COLOR_DELTA): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as unknown;
    return file === REFERENCE_PALETTE ? paletteText(j) : deltaText(j);
  } catch {
    return null;
  }
}
