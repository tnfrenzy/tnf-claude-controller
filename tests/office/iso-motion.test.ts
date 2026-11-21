import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("ui/src/styles.css", "utf8");
const tsx = readFileSync("ui/src/components/office/IsoPerson.tsx", "utf8") + readFileSync("ui/src/components/office/OfficeScene25D.tsx", "utf8");

describe("iso motion", () => {
  it("defines bob, think and zzz animations", () => {
    for (const c of [".iso-bob", ".iso-think", ".iso-zzz"]) expect(css).toContain(c);
    expect(css).toContain("@keyframes iso-blink");
  });
  it("respects prefers-reduced-motion", () => {
    const m = css.match(/prefers-reduced-motion: reduce\) \{ ([^{}]*)\{ animation: none/g) ?? [];
    const joined = m.join("\n");
    for (const c of [".iso-bob", ".iso-think", ".iso-zzz", ".iso-office .tv", ".iso-office .pb-working"]) {
      expect(joined).toContain(c);
    }
  });
  it("the isometric people apply the classes", () => {
    for (const c of ["iso-bob", "iso-think", "iso-zzz"]) expect(tsx).toContain(c);
  });
});
