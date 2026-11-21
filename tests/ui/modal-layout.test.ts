import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("ui/src/office/city.css", "utf8");
const modalTsx = readFileSync("ui/src/components/common/Modal.tsx", "utf8");

function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
}

describe("modal layout", () => {
  it("has a fixed height and no max-height 92vh", () => {
    const r = rule(".single-screen .ss-modal");
    expect(r).toMatch(/\sheight:/);
    expect(css).not.toContain("max-height: 92vh");
    expect(r).toContain("overflow: hidden");
  });
  it("body is the single scroll area", () => {
    const r = rule(".single-screen .ss-body");
    expect(r).toMatch(/overflow(-y)?:\s*auto/);
    expect(r).toContain("min-height: 0");
  });
  it("is full screen at 480px", () => {
    const i = css.indexOf("@media (max-width: 480px)");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(css.slice(i)).toContain("100dvh");
  });
  it("Modal renders children in ss-body", () => {
    expect(modalTsx).toContain('className="ss-body"');
  });
});
