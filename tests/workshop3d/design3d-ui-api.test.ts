import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

describe("Design3D api wrappers (structure)", () => {
  const api = read("ui/src/api.ts");
  it("has getDesign3D on /api/design3d", () => {
    expect(api).toMatch(/getDesign3D/);
    expect(api).toMatch(/"\/api\/design3d"/);
  });
  it("has modelUrl building /model?path= with encodeURIComponent", () => {
    expect(api).toMatch(/export function modelUrl/);
    expect(api).toMatch(/\/model\?path=/);
    expect(api).toMatch(/encodeURIComponent/);
  });
  it("modelBlob uses the token header and modelUrl has no token in the URL", () => {
    expect(api).toMatch(/export async function modelBlob[\s\S]{0,200}x-controller-token/);
    const m = /export function modelUrl[\s\S]*?\n}/.exec(api);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/token=/);
  });
  it("modelUrl behaves (real call)", async () => {
    const mod = await import("../../ui/src/api");
    expect(mod.modelUrl("run 1", "a/b c.glb")).toBe("/api/runs/run%201/model?path=a%2Fb%20c.glb");
  });
});

describe("Design3D UI types (structure)", () => {
  const types = read("ui/src/types.ts");
  it("declares the kit, template and floor types", () => {
    expect(types).toMatch(/export interface Design3DKit/);
    expect(types).toMatch(/export interface Design3DTemplate/);
    expect(types).toMatch(/export interface Design3DFloor/);
    expect(types).toMatch(/primaryFormat/);
    expect(types).toMatch(/fileCount/);
  });
});
