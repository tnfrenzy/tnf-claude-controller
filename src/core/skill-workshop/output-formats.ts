/**
 * Output formats of a "Tạo mới" training round: what the user wants to open to check and grade a result (Word, Excel,
 * PDF, HTML, AutoCAD, SolidWorks). The agent still answers with one JSON; the controller builds every requested file
 * from it. Drawings (2D) and solids (3D) are optional parts of that JSON. Pure module: no I/O.
 */
import type { SampleDoc } from "./sample-files.js";

export type OutputFormat = "docx" | "xlsx" | "pdf" | "html" | "dxf" | "step";

export interface OutputFormatInfo {
  id: OutputFormat;
  label: string;
  ext: string;
  contentType: string;
  /** Opens inside the browser (a new tab) instead of needing another program. */
  viewInBrowser: boolean;
}

export const OUTPUT_FORMATS: readonly OutputFormatInfo[] = [
  { id: "docx", label: "Word", ext: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", viewInBrowser: false },
  { id: "xlsx", label: "Excel", ext: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", viewInBrowser: false },
  { id: "pdf", label: "PDF", ext: "pdf", contentType: "application/pdf", viewInBrowser: true },
  { id: "html", label: "HTML", ext: "html", contentType: "text/html; charset=utf-8", viewInBrowser: true },
  { id: "dxf", label: "AutoCAD (DXF)", ext: "dxf", contentType: "application/dxf", viewInBrowser: false },
  { id: "step", label: "SolidWorks (STEP)", ext: "step", contentType: "application/step", viewInBrowser: false },
];

export const DEFAULT_OUTPUTS: readonly OutputFormat[] = ["docx", "xlsx"];

export function isOutputFormat(v: unknown): v is OutputFormat {
  return typeof v === "string" && OUTPUT_FORMATS.some((f) => f.id === v);
}

/** Validated, de-duplicated, in catalogue order. Anything unusable gives null (caller uses the default or answers 400). */
export function parseOutputs(raw: unknown): OutputFormat[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every(isOutputFormat)) return null;
  return OUTPUT_FORMATS.map((f) => f.id).filter((id) => raw.includes(id));
}

export function formatInfo(id: string): OutputFormatInfo | undefined {
  return OUTPUT_FORMATS.find((f) => f.id === id);
}

// ---- drawing (2D) and solids (3D) parts of the agent answer ----------------------------------------------------

export type DrawingEntity =
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; layer: string }
  | { type: "circle"; cx: number; cy: number; r: number; layer: string }
  | { type: "arc"; cx: number; cy: number; r: number; start: number; end: number; layer: string }
  | { type: "polyline"; points: [number, number][]; closed: boolean; layer: string }
  | { type: "text"; x: number; y: number; height: number; text: string; layer: string };

export interface Drawing {
  /** Always millimetres. */
  entities: DrawingEntity[];
}

export type Solid = { type: "box"; x: number; y: number; z: number; w: number; d: number; h: number } | { type: "cylinder"; x: number; y: number; z: number; r: number; h: number };

export const DRAWING_LIMITS = { entities: 500, points: 200, text: 200, coord: 1_000_000, solids: 50 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= DRAWING_LIMITS.coord ? v : null);
const LAYER_RE = /^[A-Za-z0-9_-]{1,31}$/;

export function validateDrawing(raw: unknown): { ok: true; value: Drawing } | { ok: false; error: string } {
  if (!isObj(raw) || !Array.isArray(raw["entities"])) return { ok: false, error: "drawing phải có mảng entities." };
  const list = raw["entities"] as unknown[];
  if (list.length === 0) return { ok: false, error: "drawing.entities đang trống." };
  if (list.length > DRAWING_LIMITS.entities) return { ok: false, error: `drawing quá ${DRAWING_LIMITS.entities} đối tượng.` };
  const out: DrawingEntity[] = [];
  for (const e of list) {
    if (!isObj(e)) return { ok: false, error: "Mỗi đối tượng của drawing phải là một object." };
    const layer = typeof e["layer"] === "string" && LAYER_RE.test(e["layer"]) ? e["layer"] : "0";
    const n = (k: string) => num(e[k]);
    switch (e["type"]) {
      case "line": {
        const v = [n("x1"), n("y1"), n("x2"), n("y2")];
        if (v.some((x) => x === null)) return { ok: false, error: "line cần x1,y1,x2,y2 là số." };
        out.push({ type: "line", x1: v[0]!, y1: v[1]!, x2: v[2]!, y2: v[3]!, layer });
        break;
      }
      case "circle": {
        const v = [n("cx"), n("cy"), n("r")];
        if (v.some((x) => x === null) || v[2]! <= 0) return { ok: false, error: "circle cần cx,cy là số và r > 0." };
        out.push({ type: "circle", cx: v[0]!, cy: v[1]!, r: v[2]!, layer });
        break;
      }
      case "arc": {
        const v = [n("cx"), n("cy"), n("r"), n("start"), n("end")];
        if (v.some((x) => x === null) || v[2]! <= 0) return { ok: false, error: "arc cần cx,cy,r>0,start,end (độ)." };
        out.push({ type: "arc", cx: v[0]!, cy: v[1]!, r: v[2]!, start: v[3]!, end: v[4]!, layer });
        break;
      }
      case "polyline": {
        const pts = e["points"];
        if (!Array.isArray(pts) || pts.length < 2 || pts.length > DRAWING_LIMITS.points) return { ok: false, error: `polyline cần 2 đến ${DRAWING_LIMITS.points} điểm.` };
        const points: [number, number][] = [];
        for (const p of pts) {
          const x = Array.isArray(p) ? num(p[0]) : null;
          const y = Array.isArray(p) ? num(p[1]) : null;
          if (x === null || y === null) return { ok: false, error: "Mỗi điểm của polyline phải là [x, y] số." };
          points.push([x, y]);
        }
        out.push({ type: "polyline", points, closed: e["closed"] === true, layer });
        break;
      }
      case "text": {
        const x = n("x");
        const y = n("y");
        const h = n("height");
        if (x === null || y === null || h === null || h <= 0 || typeof e["text"] !== "string" || !e["text"].trim()) return { ok: false, error: "text cần x,y,height>0 và text." };
        out.push({ type: "text", x, y, height: h, text: e["text"].slice(0, DRAWING_LIMITS.text), layer });
        break;
      }
      default:
        return { ok: false, error: "Loại đối tượng của drawing phải là line, circle, arc, polyline hoặc text." };
    }
  }
  return { ok: true, value: { entities: out } };
}

export function validateSolids(raw: unknown): { ok: true; value: Solid[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "solids phải là mảng không rỗng." };
  if (raw.length > DRAWING_LIMITS.solids) return { ok: false, error: `solids quá ${DRAWING_LIMITS.solids} khối.` };
  const out: Solid[] = [];
  for (const s of raw) {
    if (!isObj(s)) return { ok: false, error: "Mỗi khối phải là một object." };
    const n = (k: string) => num(s[k]);
    if (s["type"] === "box") {
      const v = [n("x"), n("y"), n("z"), n("w"), n("d"), n("h")];
      if (v.some((x) => x === null) || v[3]! <= 0 || v[4]! <= 0 || v[5]! <= 0) return { ok: false, error: "box cần x,y,z là số và w,d,h > 0 (mm)." };
      out.push({ type: "box", x: v[0]!, y: v[1]!, z: v[2]!, w: v[3]!, d: v[4]!, h: v[5]! });
    } else if (s["type"] === "cylinder") {
      const v = [n("x"), n("y"), n("z"), n("r"), n("h")];
      if (v.some((x) => x === null) || v[3]! <= 0 || v[4]! <= 0) return { ok: false, error: "cylinder cần x,y,z là số và r,h > 0 (mm)." };
      out.push({ type: "cylinder", x: v[0]!, y: v[1]!, z: v[2]!, r: v[3]!, h: v[4]! });
    } else return { ok: false, error: "Khối phải là box hoặc cylinder." };
  }
  return { ok: true, value: out };
}

// ---- prompt part -----------------------------------------------------------------------------------------------

/** Extra instructions for the sample prompt: which files the user wants, and the JSON parts needed for them. */
export function outputsPromptPart(outputs: readonly OutputFormat[]): string {
  const names = outputs.map((o) => formatInfo(o)?.label ?? o).join(", ");
  const lines = [`Người dùng sẽ mở kết quả để kiểm tra và chấm điểm bằng các định dạng: ${names}. Hệ thống tự dựng các tệp này từ câu trả lời JSON của bạn, vì vậy nội dung phải đủ để xem và chấm đúng ở từng định dạng.`];
  if (outputs.includes("dxf")) {
    lines.push(
      'Vì cần bản vẽ AutoCAD: thêm khóa "drawing" vào JSON, đơn vị mm, trục Y hướng lên: { "entities": [ {"type":"line","x1":0,"y1":0,"x2":100,"y2":0,"layer":"KHUNG"}, {"type":"circle","cx":50,"cy":50,"r":10,"layer":"LO"}, {"type":"arc","cx":0,"cy":0,"r":20,"start":0,"end":90,"layer":"0"}, {"type":"polyline","points":[[0,0],[100,0],[100,60],[0,60]],"closed":true,"layer":"KHUNG"}, {"type":"text","x":5,"y":65,"height":5,"text":"Ghi chú","layer":"CHU"} ] }. Layer chỉ gồm chữ không dấu, số, _ hoặc -. Tối đa 500 đối tượng. Vẽ đúng kích thước thật và có ghi chú kích thước bằng text.',
    );
  } else if (outputs.includes("pdf") || outputs.includes("html")) {
    lines.push('Nếu kết quả là bản vẽ hoặc sơ đồ 2D, có thể thêm khóa "drawing" (cùng dạng entities: line, circle, arc, polyline, text; đơn vị mm) để PDF/HTML hiển thị hình; nếu không thì bỏ khóa này.');
  }
  if (outputs.includes("step")) {
    lines.push('Vì cần mô hình SolidWorks: thêm khóa "solids" vào JSON, đơn vị mm: [ {"type":"box","x":0,"y":0,"z":0,"w":100,"d":50,"h":20}, {"type":"cylinder","x":50,"y":25,"z":20,"r":8,"h":30} ]. (box: góc gốc + w,d,h; cylinder: tâm đáy + r,h). Tối đa 50 khối.');
  }
  return lines.join("\n");
}

// ---- builders --------------------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** SVG of a drawing (Y up), fitted to its bounding box. */
export function drawingSvg(d: Drawing, widthPx = 900): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of d.entities) {
    if (e.type === "line") { xs.push(e.x1, e.x2); ys.push(e.y1, e.y2); }
    else if (e.type === "circle" || e.type === "arc") { xs.push(e.cx - e.r, e.cx + e.r); ys.push(e.cy - e.r, e.cy + e.r); }
    else if (e.type === "polyline") for (const [x, y] of e.points) { xs.push(x); ys.push(y); }
    else { xs.push(e.x, e.x + e.height * Math.max(1, e.text.length) * 0.6); ys.push(e.y, e.y + e.height); }
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  const pad = Math.max(w, h) * 0.05;
  const sw = (Math.max(w, h) / 600).toFixed(3);
  const fy = (y: number): number => maxY + minY - y; // flip: SVG Y goes down
  const f = (n: number): string => n.toFixed(3);
  const parts = d.entities.map((e) => {
    switch (e.type) {
      case "line": return `<line x1="${f(e.x1)}" y1="${f(fy(e.y1))}" x2="${f(e.x2)}" y2="${f(fy(e.y2))}"/>`;
      case "circle": return `<circle cx="${f(e.cx)}" cy="${f(fy(e.cy))}" r="${f(e.r)}"/>`;
      case "arc": {
        const a0 = (e.start * Math.PI) / 180, a1 = (e.end * Math.PI) / 180;
        const sweep = ((e.end - e.start) % 360 + 360) % 360;
        const x0 = e.cx + e.r * Math.cos(a0), y0 = e.cy + e.r * Math.sin(a0), x1 = e.cx + e.r * Math.cos(a1), y1 = e.cy + e.r * Math.sin(a1);
        return `<path d="M${f(x0)} ${f(fy(y0))} A${f(e.r)} ${f(e.r)} 0 ${sweep > 180 ? 1 : 0} 0 ${f(x1)} ${f(fy(y1))}"/>`;
      }
      case "polyline": return `<${e.closed ? "polygon" : "polyline"} points="${e.points.map(([x, y]) => `${f(x)},${f(fy(y))}`).join(" ")}"/>`;
      case "text": return `<text x="${f(e.x)}" y="${f(fy(e.y))}" font-size="${f(e.height)}" fill="#111" stroke="none" font-family="Arial,sans-serif">${esc(e.text)}</text>`;
    }
  });
  const vb = `${f(minX - pad)} ${f(minY - pad)} ${f(w + pad * 2)} ${f(h + pad * 2)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${widthPx}" style="max-width:100%;height:auto;background:#fff;border:1px solid #bbb" fill="none" stroke="#111" stroke-width="${sw}">${parts.join("")}</svg>`;
}

/** Self-contained HTML page of the sample (also the source of the PDF). */
export function buildHtml(doc: SampleDoc, drawing?: Drawing | null): string {
  const body: string[] = [`<h1>${esc(doc.title)}</h1>`];
  if (doc.inputSummary) body.push(`<p><i>${esc(doc.inputSummary)}</i></p>`);
  for (const s of doc.sections) {
    body.push(`<h2>${esc(s.heading)}</h2>`, ...s.paragraphs.map((p) => `<p>${esc(p)}</p>`));
  }
  if (drawing) body.push("<h2>Bản vẽ</h2>", drawingSvg(drawing));
  for (const t of doc.tables) {
    body.push(`<h2>${esc(t.name)}</h2><table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  }
  const css = "body{font-family:Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:22px}h2{font-size:17px;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #888;padding:4px 8px;text-align:left;vertical-align:top}th{background:#eee}@page{size:A4;margin:14mm}";
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.title)}</title><style>${css}</style></head><body>${body.join("")}</body></html>`;
}

const dxfNum = (n: number): string => String(Math.round(n * 1e6) / 1e6);
/** Text for DXF R12: non-ASCII characters become \U+XXXX escapes (AutoCAD shows them with its text font). */
export function dxfText(s: string): string {
  return Array.from(s.replace(/[\r\n]+/g, " ")).map((ch) => (ch.charCodeAt(0) > 126 ? `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}` : ch)).join("");
}

/** ASCII DXF (R12, opens in every AutoCAD version): LINE, CIRCLE, ARC, POLYLINE, TEXT on named layers. */
export function buildDxf(d: Drawing): string {
  const g: string[] = [];
  const add = (code: number, value: string | number) => g.push(String(code), String(value));
  const layers = [...new Set(["0", ...d.entities.map((e) => e.layer)])];
  add(0, "SECTION"); add(2, "HEADER"); add(9, "$ACADVER"); add(1, "AC1009"); add(9, "$INSUNITS"); add(70, 4); add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "TABLES"); add(0, "TABLE"); add(2, "LAYER"); add(70, layers.length);
  layers.forEach((l, i) => { add(0, "LAYER"); add(2, l); add(70, 0); add(62, l === "0" ? 7 : (i % 6) + 1); add(6, "CONTINUOUS"); });
  add(0, "ENDTAB"); add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "ENTITIES");
  for (const e of d.entities) {
    if (e.type === "line") { add(0, "LINE"); add(8, e.layer); add(10, dxfNum(e.x1)); add(20, dxfNum(e.y1)); add(30, 0); add(11, dxfNum(e.x2)); add(21, dxfNum(e.y2)); add(31, 0); }
    else if (e.type === "circle") { add(0, "CIRCLE"); add(8, e.layer); add(10, dxfNum(e.cx)); add(20, dxfNum(e.cy)); add(30, 0); add(40, dxfNum(e.r)); }
    else if (e.type === "arc") { add(0, "ARC"); add(8, e.layer); add(10, dxfNum(e.cx)); add(20, dxfNum(e.cy)); add(30, 0); add(40, dxfNum(e.r)); add(50, dxfNum(((e.start % 360) + 360) % 360)); add(51, dxfNum(((e.end % 360) + 360) % 360)); }
    else if (e.type === "polyline") {
      add(0, "POLYLINE"); add(8, e.layer); add(66, 1); add(70, e.closed ? 1 : 0);
      for (const [x, y] of e.points) { add(0, "VERTEX"); add(8, e.layer); add(10, dxfNum(x)); add(20, dxfNum(y)); add(30, 0); }
      add(0, "SEQEND"); add(8, e.layer);
    } else { add(0, "TEXT"); add(8, e.layer); add(10, dxfNum(e.x)); add(20, dxfNum(e.y)); add(30, 0); add(40, dxfNum(e.height)); add(1, dxfText(e.text)); }
  }
  add(0, "ENDSEC"); add(0, "EOF");
  return g.join("\r\n") + "\r\n";
}

/** Fixed python script (never agent code): reads the validated solids JSON and writes a STEP file with CadQuery. */
export const STEP_SCRIPT = [
  "import json, sys",
  "import cadquery as cq",
  "spec = json.load(open(sys.argv[1], encoding='utf-8'))",
  "result = None",
  "for s in spec['solids']:",
  "    if s['type'] == 'box':",
  "        o = cq.Workplane('XY').box(s['w'], s['d'], s['h'], centered=False).translate((s['x'], s['y'], s['z']))",
  "    else:",
  "        o = cq.Workplane('XY').circle(s['r']).extrude(s['h']).translate((s['x'], s['y'], s['z']))",
  "    result = o if result is None else result.union(o)",
  "cq.exporters.export(result, sys.argv[2])",
  "",
].join("\n");
