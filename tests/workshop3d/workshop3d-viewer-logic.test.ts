import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arIssue, arModes, baseName, resizeAxis, scaleFor, sizeToMm, canRebuild, changedParams, detectPlatform, distanceMm, formatBytes, formatDimsMm, formatMm,
  isBusy, parseParamInput, pickSources, renderLabel,
} from "../../ui/src/components/workshop3d/logic";
import { parseGlbInfo } from "../../ui/src/components/workshop3d/glb-info";

describe("measure + format", () => {
  it("distance metres → mm", () => {
    expect(distanceMm({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5000, 6);
    expect(distanceMm({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 })).toBe(0);
  });
  it("formatMm: 0,1 mm under 100, integer above, comma decimal", () => {
    expect(formatMm(12.34)).toBe("12,3 mm");
    expect(formatMm(1940.4)).toBe("1940 mm");
    expect(formatMm(NaN)).toBe("—");
  });
  it("formatDimsMm is W × D × H", () => {
    expect(formatDimsMm({ x: 1.4, y: 2.3, z: 1.6 })).toBe("1400 × 1600 × 2300 mm");
  });
  it("formatBytes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(66968)).toBe("65,4 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5,0 MB");
  });
});

describe("device source selection", () => {
  const files = ["outputs/model.glb", "outputs/model-mobile.glb", "outputs/model.usdz", "outputs/model.step", "outputs/parts/b.stl", "outputs/parts/a.stl", "renders/x.png"];
  it("detectPlatform", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("desktop");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
  });
  it("desktop uses full GLB, phones the mobile GLB", () => {
    expect(pickSources(files, "desktop").glb).toBe("outputs/model.glb");
    expect(pickSources(files, "android").glb).toBe("outputs/model-mobile.glb");
    expect(pickSources(files, "ios").usdz).toBe("outputs/model.usdz");
  });
  it("falls back when one GLB is missing; lists sorted STL parts", () => {
    expect(pickSources(["outputs/model.glb"], "ios").glb).toBe("outputs/model.glb");
    expect(pickSources(["outputs/model-mobile.glb"], "desktop").glb).toBe("outputs/model-mobile.glb");
    expect(pickSources([], "desktop")).toEqual({ glb: null, usdz: null, stl: [] });
    expect(pickSources(files, "desktop").stl).toEqual(["outputs/parts/a.stl", "outputs/parts/b.stl"]);
  });
  it("arModes", () => {
    expect(arModes("ios", true)).toBe("quick-look");
    expect(arModes("ios", false)).toBe("quick-look"); // model-viewer builds the USDZ itself
    expect(arModes("android", false).split(" ")[0]).toBe("webxr"); // blob: src cannot go to Scene Viewer
    expect(arModes("android", false)).toContain("scene-viewer");
    expect(arModes("desktop", true)).toBe("webxr");
  });
});

describe("state + params", () => {
  it("rebuild only when idle; busy while working", () => {
    expect(canRebuild("done")).toBe(true);
    expect(canRebuild("failed")).toBe(true);
    expect(canRebuild("building")).toBe(false);
    expect(isBusy("building")).toBe(true);
    expect(isBusy("rendering")).toBe(true);
    expect(isBusy("done")).toBe(false);
    expect(isBusy("awaiting_user")).toBe(false);
  });
  it("parseParamInput keeps the original type", () => {
    expect(parseParamInput(1400, "1500")).toBe(1500);
    expect(parseParamInput(1400, "1,5")).toBe(1.5);
    expect(parseParamInput(1400, "abc")).toBeNull();
    expect(parseParamInput(1400, " ")).toBeNull();
    expect(parseParamInput("inox", "gỗ")).toBe("gỗ");
  });
  it("changedParams returns only differences", () => {
    expect(changedParams({ a: 1, b: "x" }, { a: 1, b: "y" })).toEqual({ b: "y" });
    expect(changedParams({ a: 1 }, { a: 1 })).toEqual({});
  });
  it("names", () => {
    expect(baseName("renders\\front_left.png")).toBe("front_left.png");
    expect(renderLabel("renders/front_left.png")).toBe("front left");
  });
});

const SAMPLE = "D:/tnf-claude-workspace/outputs/20261110-130922-b67ad1-cabin/elevator_cabin.glb";
describe("parseGlbInfo", () => {
  it("rejects non-GLB", () => {
    expect(parseGlbInfo(new ArrayBuffer(4))).toBeNull();
    expect(parseGlbInfo(new Uint8Array(40).buffer)).toBeNull();
  });
  it("reads a minimal GLB", () => {
    const json = JSON.stringify({
      nodes: [{ name: "root", children: [1] }, { name: "wall", mesh: 0 }],
      meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }],
      accessors: [{ count: 36 }, { count: 24 }],
      materials: [{ name: "inox" }, { name: "inox" }, {}],
    });
    const pad = (4 - (json.length % 4)) % 4;
    const body = new TextEncoder().encode(json + " ".repeat(pad));
    const buf = new ArrayBuffer(20 + body.length);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, buf.byteLength, true);
    dv.setUint32(12, body.length, true); dv.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buf, 20).set(body);
    const info = parseGlbInfo(buf);
    expect(info).toEqual({ triangles: 12, materials: ["inox", "material_2"], nodes: ["root", "wall"], bytes: buf.byteLength });
  });
  it.skipIf(!existsSync(SAMPLE))("reads the sample cabin GLB", () => {
    const b = readFileSync(SAMPLE);
    const info = parseGlbInfo(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    expect(info).not.toBeNull();
    expect(info!.triangles).toBeGreaterThan(0);
    expect(info!.nodes.length).toBeGreaterThan(0);
  });
});

describe("AR size controls", () => {
  const orig = sizeToMm({ x: 2, y: 1, z: 0.5 }); // 2000 x 1000 x 500 mm
  it("changes one axis only without lock", () => {
    expect(resizeAxis(orig, orig, "x", 3000, false)).toEqual({ x: 3000, y: 1000, z: 500 });
  });
  it("keeps proportions with lock", () => {
    expect(resizeAxis(orig, orig, "z", 250, true)).toEqual({ x: 1000, y: 500, z: 250 });
  });
  it("rejects zero, negative, NaN and out-of-range", () => {
    expect(resizeAxis(orig, orig, "x", 0, false)).toBeNull();
    expect(resizeAxis(orig, orig, "x", -5, false)).toBeNull();
    expect(resizeAxis(orig, orig, "x", Number.NaN, false)).toBeNull();
    expect(resizeAxis(orig, orig, "x", 2000 * 101, false)).toBeNull();
  });
  it("scaleFor is null at the original size, multipliers otherwise", () => {
    expect(scaleFor(orig, orig)).toBeNull();
    expect(scaleFor(orig, { x: 1000, y: 1000, z: 1000 })).toEqual({ x: 0.5, y: 1, z: 2 });
  });
  it("arIssue explains a missing AR button", () => {
    expect(arIssue("desktop", true, false)).toBe("desktop");
    expect(arIssue("android", false, false)).toBe("insecure");
    expect(arIssue("ios", true, false)).toBe("unsupported");
    expect(arIssue("android", true, true)).toBeNull();
    expect(arIssue("ios", true, null)).toBeNull();
  });
});
