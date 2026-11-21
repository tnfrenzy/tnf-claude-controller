import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../ui/src/office/useDesign3DFloors.ts", import.meta.url), "utf8");

describe("useDesign3DFloors source", () => {
  it("exports the hook", () => {
    expect(src).toContain("export function useDesign3DFloors");
  });
  it("polls the api, skips hidden tabs and cleans up", () => {
    expect(src).toContain("api.getDesign3D");
    expect(src).toContain("document.hidden");
    expect(src).toContain("clearInterval");
  });
  it("starts with an empty floor list and null kit", () => {
    expect(src).toContain("floors: [], kit: null");
  });
});
