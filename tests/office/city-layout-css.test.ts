import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../ui/src/office/city.css", import.meta.url), "utf8");

describe("city layout css", () => {
  it("has a narrow breakpoint and a minimum scene height", () => {
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toMatch(/\.single-screen \.scene \{ min-height: 300px; \}/);
  });
  it("respects reduced motion", () => {
    expect(css).toContain("prefers-reduced-motion");
  });
  it("never nests .scene inside .scene", () => {
    expect(css).not.toMatch(/\.scene\s+\.scene\b/);
  });
});
