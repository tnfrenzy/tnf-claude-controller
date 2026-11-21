import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tree = readFileSync(new URL("../../ui/src/components/run/AgentTree.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../ui/src/styles.css", import.meta.url), "utf8");
const city = readFileSync(new URL("../../ui/src/office/city.css", import.meta.url), "utf8");

describe("agent tree layout", () => {
  it("prints the full summary without truncation or hover title", () => {
    expect(tree).not.toContain("slice(0, 140)");
    expect(tree).not.toContain("slice(0,140)");
    expect(tree).not.toContain("title={a.summary}");
  });
  it("wraps text and avoids horizontal scroll", () => {
    expect(css).toMatch(/\.agent \.meta \{[^}]*white-space: normal[^}]*overflow-wrap: anywhere/);
    expect(css).toContain("minmax(0, 2fr) minmax(0, 1fr)");
    expect(css).toMatch(/\.card, \.timeline-wrap \{ min-width: 0; \}/);
    expect(city).toMatch(/\.ss-body \{[^}]*overflow-x: hidden/);
  });
});
