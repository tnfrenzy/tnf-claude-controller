import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { REPO_ROOT } from "../app/config.js";
import { PANO_FILE } from "./panorama.js";

/**
 * "Trang trình bày": one folder `<session>/outputs/trinh-bay/` that opens by double-clicking `index.html` (no server, no network):
 * title and specs from brief.json / REPORT.md, the Blender images (renders/hq) then the quick previews, and a 3D viewer
 * with the viewing GLB (model-view.glb, plus the door-open twin when it exists). The GLB is embedded as base64 in
 * data/model.js because Chrome blocks fetch() of local files from a file:// page. Pure file work: no agent, no Blender.
 */

export const PRESENTATION_DIR = "outputs/trinh-bay";
const MAX_GLB_BYTES = 40 * 1024 * 1024;
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface PresentationResult {
  dir: string;
  index: string;
  images: number;
  hasModel: boolean;
  modelFile: string | null;
  doorOpen: boolean;
  pano: boolean;
  warnings: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function listImages(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && IMG_EXT.has(path.extname(e.name).toLowerCase()) && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** "noi_guong_hau" -> "Noi guong hau" (the Vietnamese caption is the file's own name; the agents name views in ASCII). */
function captionOf(file: string): string {
  const base = path.basename(file, path.extname(file)).replace(/[_-]+/g, " ").trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : file;
}

/** Minimal markdown: `## heading`, `- item`, paragraphs, **bold**. Enough for the REPORT.md the presenter writes. */
export function miniMarkdown(md: string): string {
  const out: string[] = [];
  let list = false;
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const close = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      close();
      out.push(`<h3>${inline(h[2]!)}</h3>`);
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(li[1]!)}</li>`);
      continue;
    }
    close();
    out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join("\n");
}

function findViewerLib(): string | null {
  const names = ["model-viewer-umd.min.js"];
  const roots: string[] = [];
  try {
    const req = createRequire(import.meta.url);
    roots.push(path.dirname(req.resolve("@google/model-viewer/package.json")));
  } catch {
    // not resolvable from here: fall through to the app-relative guesses
  }
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (const up of ["../../..", "../../../.."]) roots.push(path.resolve(here, up, "node_modules", "@google", "model-viewer"));
  for (const r of roots) for (const n of names) {
    const f = path.join(r, "dist", n);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function buildHtml(o: { title: string; subtitle: string; specsHtml: string; reportHtml: string; hq: Array<{ file: string; cap: string }>; quick: Array<{ file: string; cap: string }>; model: boolean; door: boolean; pano: boolean; beautiful: boolean; score: string; note: string }): string {
  const fig = (x: { file: string; cap: string }) => `<figure data-src="anh/${esc(x.file)}" data-cap="${esc(x.cap)}"><img loading="lazy" src="anh/${esc(x.file)}" alt="${esc(x.cap)}"><figcaption><b>${esc(x.cap)}</b></figcaption></figure>`;
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
${o.pano ? '<link rel="stylesheet" href="lib/pannellum.css">' : ""}
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#1d2430;--muted:#5b6575;--line:#dde1e7;--accent:#123c8c;--warn:#8a5a00;--warnbg:#fff6e0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14171c;--card:#1d2128;--ink:#e8ebf0;--muted:#a2abb8;--line:#323843;--accent:#8fb0ff;--warn:#ffd27a;--warnbg:#2e2614}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Segoe UI",system-ui,sans-serif}
header,section,footer{max-width:1200px;margin:0 auto;padding:0 16px}header{padding-top:28px}
h1{font-size:clamp(24px,4vw,34px);margin:0 0 4px;color:var(--accent)}h2{font-size:21px;margin:34px 0 12px}h3{font-size:16px;margin:14px 0 4px}
.sub{color:var(--muted);margin:0 0 14px}.note{background:var(--warnbg);color:var(--warn);border-radius:10px;padding:10px 14px;font-size:14.5px}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.gal figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;cursor:zoom-in}
.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}.gal figcaption{padding:8px 12px 10px;font-size:14px}
#pano{width:100%;height:min(70vh,620px);border-radius:12px;border:1px solid var(--line);background:#20242b}
model-viewer{width:100%;height:min(70vh,620px);border-radius:12px;border:1px solid var(--line);background:#e9ecf1}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}.bar button{font:inherit;font-size:14px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 16px 12px}
#lb{position:fixed;inset:0;background:rgba(8,10,14,.92);display:none;align-items:center;justify-content:center;z-index:50}#lb.on{display:flex}
#lb img{max-width:96vw;max-height:84vh;border-radius:6px}#lb .cap{position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#eef;padding:0 60px}
#lb button{position:absolute;top:12px;right:12px;width:44px;height:44px;border:0;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font-size:22px;cursor:pointer}
footer{margin-top:36px;margin-bottom:28px;font-size:13.5px;color:var(--muted)}
</style></head><body>
<header><h1>${esc(o.title)}</h1><p class="sub">${esc(o.subtitle)}</p>
<p class="note">Đây là bản dựng do máy tự làm, màu và vật liệu mang tính minh họa, chưa phải ảnh chụp sản phẩm thật.${o.note ? " " + esc(o.note) : ""}</p></header>
${o.hq.length ? `<section><h2>Ảnh render chất lượng cao (Blender)</h2><div class="gal">${o.hq.map(fig).join("")}</div></section>` : ""}
${o.pano ? `<section><h2>Xem 360</h2><div id="pano"></div><p class="sub">Kéo để nhìn quanh, cuộn để phóng to. Ảnh render bằng Blender từ giữa không gian.</p></section>` : ""}
${o.model ? `<section><h2>${o.beautiful ? "Xem 3D (bản hiển thị đẹp)" : "Xem 3D"}</h2><div class="bar">${o.door ? '<button id="b-close" type="button">Cửa đóng</button><button id="b-open" type="button">Cửa mở</button>' : ""}</div><model-viewer id="mv" camera-controls touch-action="pan-y" shadow-intensity="0.6" exposure="1" alt="Mô hình 3D"></model-viewer><p class="sub">Kéo để xoay, cuộn hoặc chụm hai ngón để phóng to.</p></section>` : ""}
${o.quick.length ? `<section><h2>Ảnh xem nhanh</h2><div class="gal">${o.quick.map(fig).join("")}</div></section>` : ""}
${o.specsHtml ? `<section><h2>Thông số và bộ phận</h2><div class="card">${o.specsHtml}</div></section>` : ""}
${o.reportHtml ? `<section><h2>Đánh giá</h2><div class="card">${o.reportHtml}</div></section>` : ""}
<footer>Tạo tự động bởi TNF CLI. Trang chạy offline, mở trực tiếp index.html. Bộ xem 3D: model-viewer (Apache-2.0).</footer>
<div id="lb"><img alt=""><div class="cap"></div><button type="button" aria-label="Đóng">✕</button></div>
${o.model ? '<script src="lib/model-viewer-umd.min.js"></script><script src="data/model.js"></script>' : ""}
${o.pano ? '<script src="lib/pannellum.js"></script><script src="data/pano.js"></script><script>if(window.pannellum&&window.TNF_PANO)pannellum.viewer("pano",{type:"equirectangular",panorama:window.TNF_PANO,autoLoad:true,showControls:true,hfov:100,yaw:0});</script>' : ""}
<script>
(function(){var lb=document.getElementById("lb"),im=lb.querySelector("img"),cp=lb.querySelector(".cap");
document.querySelectorAll(".gal figure").forEach(function(f){f.addEventListener("click",function(){im.src=f.dataset.src;cp.textContent=f.dataset.cap;lb.classList.add("on")})});
lb.addEventListener("click",function(){lb.classList.remove("on")});
var mv=document.getElementById("mv");
function set(k){if(mv&&window.TNF_MODELS&&window.TNF_MODELS[k])mv.src=window.TNF_MODELS[k]}
set("closed");var c=document.getElementById("b-close"),o=document.getElementById("b-open");
if(c)c.onclick=function(){set("closed")};if(o)o.onclick=function(){set("open")};
})();
</script></body></html>`;
}

export function buildPresentation(sessionDir: string): PresentationResult {
  const warnings: string[] = [];
  const dir = path.join(sessionDir, ...PRESENTATION_DIR.split("/"));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "anh"), { recursive: true });

  let brief: { title?: string; object?: string } = {};
  try {
    brief = JSON.parse(readText(path.join(sessionDir, "brief.json")) || "{}") as typeof brief;
  } catch {
    // no brief: the title falls back below
  }
  const title = (brief.title ?? "").trim() || "Mô hình 3D";
  const report = readText(path.join(sessionDir, "REPORT.md"));
  const specs = /(?:^|\n)##\s+Thông số[\s\S]*?(?=\n##\s|$)/.exec(report);
  const specsHtml = specs ? miniMarkdown(specs[0]) : "";
  const rest = specs ? report.replace(specs[0], "") : report;
  const reportHtml = miniMarkdown(rest.replace(/^\s*##\s+Thông số.*$/m, ""));

  let state: { bestScore?: number; finalScores?: unknown; note?: string; state?: string } = {};
  try {
    state = JSON.parse(readText(path.join(sessionDir, "state.json")) || "{}") as typeof state;
  } catch {
    // ignore
  }

  const copy = (srcDir: string, names: string[], prefix: string) => {
    const done: Array<{ file: string; cap: string }> = [];
    for (const n of names) {
      const out = `${prefix}${n}`;
      try {
        fs.copyFileSync(path.join(srcDir, n), path.join(dir, "anh", out));
        done.push({ file: out, cap: captionOf(n) });
      } catch {
        warnings.push(`Không chép được ảnh ${n}.`);
      }
    }
    return done;
  };
  const hq = copy(path.join(sessionDir, "renders", "hq"), listImages(path.join(sessionDir, "renders", "hq")), "hq_");
  const quick = copy(path.join(sessionDir, "renders"), listImages(path.join(sessionDir, "renders")), "xn_");

  // 3D viewer: model-view.glb (baked / material-tuned) is the nice one; model.glb only when nothing better exists and it is small enough.
  const outs = path.join(sessionDir, "outputs");
  const pick = (names: string[]) => names.map((n) => path.join(outs, n)).find((f) => fs.existsSync(f) && fs.statSync(f).size <= MAX_GLB_BYTES) ?? null;
  // The baked viewing version is retired (the 360 panorama replaces it): original GLBs first, no door-open twin.
  const closed = pick(["model-blender.glb", "model.glb", "model-view.glb"]);
  const open: string | null = null;
  const modelFileName = closed ? path.basename(closed) : null;
  const lib = closed ? findViewerLib() : null;
  let hasModel = false;
  if (closed && lib) {
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.copyFileSync(lib, path.join(dir, "lib", "model-viewer-umd.min.js"));
    const b64 = (f: string) => `data:model/gltf-binary;base64,${fs.readFileSync(f).toString("base64")}`;
    fs.writeFileSync(path.join(dir, "data", "model.js"), `window.TNF_MODELS={closed:${JSON.stringify(b64(closed))}${open ? `,open:${JSON.stringify(b64(open))}` : ""}};\n`);
    hasModel = true;
  } else if (closed && !lib) warnings.push("Không tìm thấy thư viện xem 3D (model-viewer): trang chỉ có ảnh.");
  else warnings.push("Chưa có tệp GLB đủ nhỏ để nhúng vào trang (giới hạn 40 MB).");

  // 360-degree panorama (renders/pano/pano.jpg) shown with Pannellum (MIT), embedded as a data URL like the GLB.
  let pano = false;
  const panoSrc = path.join(sessionDir, PANO_FILE);
  const panoLib = path.join(REPO_ROOT, "tools", "workshop3d", "vendor", "pannellum");
  if (fs.existsSync(panoSrc) && fs.existsSync(path.join(panoLib, "pannellum.js"))) {
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    for (const f of ["pannellum.js", "pannellum.css", "LICENSE-pannellum.txt"]) fs.copyFileSync(path.join(panoLib, f), path.join(dir, "lib", f));
    fs.writeFileSync(path.join(dir, "data", "pano.js"), `window.TNF_PANO=${JSON.stringify(`data:image/jpeg;base64,${fs.readFileSync(panoSrc).toString("base64")}`)};\n`);
    pano = true;
  }
  const html = buildHtml({
    title,
    subtitle: (brief.object ?? "").split(/[.\n]/)[0]!.slice(0, 160),
    specsHtml,
    reportHtml: "", // the error / review section is no longer part of the presentation
    hq,
    quick,
    model: hasModel,
    door: hasModel && !!open,
    pano,
    beautiful: modelFileName === "model-view.glb",
    score: "",
    note: warnings.length ? "" : "",
  });
  const index = path.join(dir, "index.html");
  fs.writeFileSync(index, html);
  return { dir, index, images: hq.length + quick.length, hasModel, modelFile: closed ? path.basename(closed) : null, doorOpen: !!open, pano, warnings };
}
