import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { OUTPUT_FORMATS, buildDxf, buildHtml, drawingSvg, dxfText, outputsPromptPart, parseOutputs, validateDrawing, validateSolids } from "../../src/core/skill-workshop/output-formats.js";
import { buildSamplePrompt, parseSampleResult } from "../../src/core/skill-workshop/sample-steps.js";
import { renderPdf, renderStep } from "../../src/core/skill-workshop/sample-render.js";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import { OUTPUT_CHOICES } from "../../ui/src/skills/skillOutputs.js";
import { createSkillsGen } from "../../src/server/skills-gen.js";

const DRAWING = { entities: [
  { type: "line", x1: 0, y1: 0, x2: 100, y2: 0, layer: "KHUNG" },
  { type: "circle", cx: 50, cy: 30, r: 10, layer: "LO" },
  { type: "arc", cx: 0, cy: 0, r: 20, start: 0, end: 90 },
  { type: "polyline", points: [[0, 0], [100, 0], [100, 60]], closed: true, layer: "KHUNG" },
  { type: "text", x: 5, y: 65, height: 5, text: "Ghi chú: ống", layer: "CHU" },
] };

describe("output formats", () => {
  it("parses a valid list in catalogue order and rejects the rest", () => {
    expect(parseOutputs(["pdf", "docx", "pdf"])).toEqual(["docx", "pdf"]);
    expect(parseOutputs([])).toBeNull();
    expect(parseOutputs(["docx", "exe"])).toBeNull();
    expect(parseOutputs("docx")).toBeNull();
    expect(OUTPUT_FORMATS.map((f) => f.id)).toEqual(["docx", "xlsx", "pdf", "html", "dxf", "step"]);
  });

  it("validates drawings and solids", () => {
    const ok = validateDrawing(DRAWING);
    expect(ok.ok).toBe(true);
    expect(validateDrawing({ entities: [] }).ok).toBe(false);
    expect(validateDrawing({ entities: [{ type: "circle", cx: 0, cy: 0, r: -1 }] }).ok).toBe(false);
    expect(validateDrawing({ entities: [{ type: "line", x1: "a" }] }).ok).toBe(false);
    expect(validateDrawing({ entities: [{ type: "hatch" }] }).ok).toBe(false);
    expect(validateSolids([{ type: "box", x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }, { type: "cylinder", x: 0, y: 0, z: 0, r: 2, h: 3 }]).ok).toBe(true);
    expect(validateSolids([{ type: "box", x: 0, y: 0, z: 0, w: 0, d: 1, h: 1 }]).ok).toBe(false);
    expect(validateSolids([]).ok).toBe(false);
  });

  it("writes a well-formed R12 DXF with every entity and layer", () => {
    const v = validateDrawing(DRAWING);
    if (!v.ok) throw new Error(v.error);
    const dxf = buildDxf(v.value);
    const codes = dxf.split("\r\n");
    expect(codes.slice(0, 6)).toEqual(["0", "SECTION", "2", "HEADER", "9", "$ACADVER"]);
    expect(dxf).toContain("AC1009");
    for (const kind of ["LINE", "CIRCLE", "ARC", "POLYLINE", "VERTEX", "SEQEND", "TEXT"]) expect(codes).toContain(kind);
    expect(codes.filter((c) => c === "VERTEX")).toHaveLength(3);
    for (const layer of ["0", "KHUNG", "LO", "CHU"]) expect(codes).toContain(layer);
    expect(codes.slice(-3)).toEqual(["0", "EOF", ""]);
    // group codes and values alternate: an even number of lines, code lines are integers
    const body = codes.slice(0, -1);
    expect(body.length % 2).toBe(0);
    for (let i = 0; i < body.length; i += 2) expect(body[i]).toMatch(/^\d+$/);
  });

  it("escapes non-ASCII text for DXF", () => {
    expect(dxfText("Ghi chú")).toBe("Ghi ch\\U+00FA");
  });

  it("draws an SVG and an HTML page that escapes content", () => {
    const v = validateDrawing(DRAWING);
    if (!v.ok) throw new Error(v.error);
    const svg = drawingSvg(v.value);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<line");
    expect(svg).toContain("<circle");
    expect(svg).toContain("<polygon");
    const html = buildHtml({ title: "A <b>", inputSummary: "", sections: [{ heading: "H", paragraphs: ["x & y"] }], tables: [] }, v.value);
    expect(html).toContain("A &lt;b&gt;");
    expect(html).toContain("x &amp; y");
    expect(html).toContain("<svg");
  });

  it("asks the agent for drawing / solids only when those formats are wanted", () => {
    expect(outputsPromptPart(["dxf"])).toContain('"drawing"');
    expect(outputsPromptPart(["step"])).toContain('"solids"');
    expect(outputsPromptPart(["docx"])).not.toContain('"drawing"');
    expect(buildSamplePrompt({ brief: "b", agents: [], round: 1, feedbackHistory: [], outputs: ["pdf", "dxf"] })).toContain("AutoCAD");
  });

  it("requires the drawing for DXF and the solids for STEP", () => {
    const base = { title: "T", inputSummary: "", sections: [{ heading: "H", paragraphs: ["p"] }], summary: "s" };
    const wrap = (o: object) => "```json\n" + JSON.stringify(o) + "\n```";
    expect(parseSampleResult(wrap(base), ["dxf"]).ok).toBe(false);
    expect(parseSampleResult(wrap({ ...base, drawing: DRAWING }), ["dxf"]).ok).toBe(true);
    expect(parseSampleResult(wrap(base), ["step"]).ok).toBe(false);
    expect(parseSampleResult(wrap({ ...base, solids: [{ type: "box", x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }] }), ["step"]).ok).toBe(true);
    expect(parseSampleResult(wrap({ ...base, drawing: { entities: [] } }), ["pdf"]).ok).toBe(false);
    expect(parseSampleResult(wrap(base)).ok).toBe(true);
  });
});

describe("ui catalogue", () => {
  it("matches the server catalogue (ids, labels, in-browser flag)", () => {
    expect(OUTPUT_CHOICES.map((c) => [c.id, c.label, c.viewInBrowser])).toEqual(OUTPUT_FORMATS.map((f) => [f.id, f.label, f.viewInBrowser]));
  });
});

describe("render helpers", () => {
  it("renderPdf reports a missing browser and a missing output", async () => {
    const out = path.join(os.tmpdir(), "tnf-x.pdf");
    expect((await renderPdf("<p>x</p>", out, { browser: null })).ok).toBe(false);
    const r = await renderPdf("<p>x</p>", out, { browser: { path: "fake" }, run: async () => ({ code: 0, timedOut: false }) });
    expect(r.ok).toBe(false);
  });
  it("renderPdf succeeds when the browser writes the file, and passes --print-to-pdf", async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tnf-r-")), "s.pdf");
    let args: string[] = [];
    const r = await renderPdf("<p>x</p>", out, { browser: { path: "fake" }, run: async (_e, a) => { args = a; fs.writeFileSync(out, "%PDF-1.4"); return { code: 0, timedOut: false }; } });
    expect(r.ok).toBe(true);
    expect(args.some((a) => a.startsWith("--print-to-pdf="))).toBe(true);
    expect(args).toContain("--headless");
  });
  it("renderStep needs the CAD python, runs the fixed script, and checks the file", async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tnf-s-")), "s.step");
    const solids = [{ type: "box" as const, x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }];
    expect((await renderStep(solids, out, { python: null })).ok).toBe(false);
    let ran: string[] = [];
    const ok = await renderStep(solids, out, { python: "py", run: async (_p, a) => { ran = a; fs.writeFileSync(out, "ISO-10303-21;"); return { code: 0, stdout: "", stderr: "", timedOut: false }; } });
    expect(ok.ok).toBe(true);
    expect(ran[0]).toBe("-I");
    const bad = await renderStep(solids, out + "2", { python: "py", run: async () => ({ code: 1, stdout: "", stderr: "ImportError: cadquery", timedOut: false }) });
    expect(bad.ok).toBe(false);
  });
});

describe("generate-sample with chosen outputs", () => {
  const req = {} as IncomingMessage;
  const base = ["api", "skills-gen", "sessions"];
  const answer = "```json\n" + JSON.stringify({ title: "Bản vẽ mẫu", inputSummary: "đầu vào", sections: [{ heading: "Mô tả", paragraphs: ["p"] }], drawing: DRAWING, summary: "xong" }) + "\n```";

  it("stores the choice, builds html + dxf, and reports each format", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-out-"));
    const store = createSkillStore(dir);
    const prompts: string[] = [];
    const gen = createSkillsGen({
      store,
      dataDir: dir,
      readBody: async () => ({ slug: "o1", brief: "Vẽ bản vẽ", formats: ["html", "dxf"] }),
      listRoles: () => [],
      finder: async () => ({ ok: false, text: "" }),
      runStep: async (_role, prompt) => { prompts.push(prompt); return { runId: "r", costUsd: 0.1, text: answer, ok: true }; },
    });
    await store.create({ slug: "o1", title: "T", goal: "g", files: { "SKILL.md": "# S" } });
    await gen.handle(req, base, "POST");
    const put = await gen.handle(req, [...base, "o1", "outputs"], "PUT");
    expect(put?.status).toBe(200);
    await gen.handle(req, [...base, "o1", "steps", "generate-sample"], "POST");
    for (let i = 0; i < 100 && (await gen.readGen("o1")).sample.status === "running"; i++) await new Promise((r) => setTimeout(r, 30));
    const session = await gen.sessions.get("o1");
    expect(session?.rounds[0]?.sample?.files.map((f) => f.format)).toEqual(["html", "dxf"]);
    expect(prompts[0]).toContain("AutoCAD");
    const dxf = await gen.handle(req, [...base, "o1", "rounds", "1", "sample", "dxf"], "GET");
    expect(dxf?.file?.contentType).toBe("application/dxf");
    expect(dxf?.file?.data.toString("utf8")).toContain("AC1009");
    const html = await gen.handle(req, [...base, "o1", "rounds", "1", "sample", "html"], "GET");
    expect(html?.file?.data.toString("utf8")).toContain("<svg");
    const bad = await gen.handle(req, [...base, "o1", "outputs"], "PUT").catch((e) => e);
    expect(bad).toBeDefined();
  });
});
