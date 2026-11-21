import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../ui/src/styles.css", import.meta.url), "utf8");
const count = (s: string) => css.split(s).length - 1;

describe("office css: furniture and wall/door", () => {
  it("styles furniture", () => {
    expect(css).toContain("g[data-furniture] .shelf rect");
    expect(css).toContain('rect[rx="10"]');
    expect(css).toContain('rect[rx="12"]');
    expect(css).toContain('circle[r="12"]');
  });
  it("styles character parts and reduced motion", () => {
    for (const c of [".char-item", ".char-ok", ".char-fail", ".char-gone", ".char-wait"]) {
      expect(css).toContain(c);
    }
    expect(css).toContain("prefers-reduced-motion");
  });
  it("defines each keyframes name once", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
  });
  it("character component produces the pose classes", () => {
    const tsx = readFileSync(new URL("../../ui/src/components/office/OfficeCharacter.tsx", import.meta.url), "utf8");
    expect(tsx).toContain("char-${pose}");
    expect(tsx).toContain('"gone"');
    expect(tsx).toContain('"wait"');
  });
  it("styles zoom bar states and keeps structure sane", () => {
    expect(css).toContain(".office-zoom-bar button:hover");
    expect(css).toContain(".office-zoom-bar button:disabled");
    expect(css.match(/:root/g)!.length).toBe(3);
    expect(count("{")).toBe(count("}"));
  });
  it("applies sprite css to the iso4 scene root", () => {
    const tsx = readFileSync(new URL("../../ui/src/components/office/OfficeScene25D.tsx", import.meta.url), "utf8");
    expect(tsx).toContain('className="office-scene iso4 iso-office"');
    expect(css).toContain(".iso-office .p.walking .leg.l");
    expect(css).toMatch(/\.iso-office \.p \.mood-bg \{ fill: #ffffff/);
  });
  it("keeps existing selectors exactly once", () => {
    for (const sel of [
      ".office-scene.iso4 .iso4-wall.north {",
      ".office-scene.iso4 .iso4-link {",
      ".office-scene .door rect {",
      ".office-scene .door-label {",
      ".office-viewport {",
      ".office-zoom-bar {",
    ]) {
      expect(count(sel), sel).toBe(1);
    }
  });
});
