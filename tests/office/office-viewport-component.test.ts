import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeViewport } from "../../ui/src/components/office/OfficeViewport.js";

const g = globalThis as unknown as { matchMedia?: unknown };

afterEach(() => {
  delete g.matchMedia;
});

function render(): string {
  return renderToStaticMarkup(createElement(OfficeViewport, { agents: [], running: false }));
}

describe("OfficeViewport markup", () => {
  it("renders three labelled buttons (vi) and the office scene svg", () => {
    const html = render();
    expect(html).toContain('aria-label="Phóng to"');
    expect(html).toContain('aria-label="Thu nhỏ"');
    expect(html).toContain('aria-label="Vừa khung"');
    expect(html).toContain('title="Phóng to"');
    expect(html).toContain("office-scene");
    expect(html).toContain("<svg");
  });

  it("frame clips overflow and declares touch-action (pan-y at fit so the page still scrolls)", () => {
    const html = render();
    expect(html).toMatch(/overflow:hidden/);
    expect(html).toMatch(/touch-action:pan-y/);
    expect(html).toMatch(/position:relative/);
  });
});
