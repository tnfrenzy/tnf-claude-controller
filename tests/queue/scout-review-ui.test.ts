import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("ScoutReview component", () => {
  const s = src("../../ui/src/components/queue/ScoutReview.tsx");
  it("uses the parser, the sequence runner and i18n keys", () => {
    expect(s).toContain("parseScoutProposals");
    expect(s).toContain("runSplitSequence");
    const keys = new Set(s.match(/t\.scoutReview_\w+/g) ?? []);
    expect(keys.size).toBeGreaterThan(15);
    const i18n = src("../../ui/src/i18n.ts");
    for (const k of keys) expect(i18n.split(`  ${k.slice(2)}:`).length - 1, k).toBe(2);
  });
  it("removes dismissed and settled items from the list", () => {
    expect(s).toContain("removeItem(");
    expect(s).toContain("removeSettled(");
  });
  it("remembers the skipped proposal per project when dismissing", () => {
    expect(s).toContain("addSkipped(project, { title: p.title");
  });
  it("renders plain text and never starts or approves runs", () => {
    expect(s).not.toContain("dangerouslySetInnerHTML");
    expect(s).not.toContain("startRun");
    expect(s).not.toContain("approve(");
    expect(s).not.toContain("queueApproveRun");
    expect(s).toContain("<pre>");
  });
  it("CSS has a one-column default and a two-column rule from 1280 px", () => {
    const css = src("../../ui/src/styles.css");
    expect(css).toMatch(/\.scout-review-list \{[^}]*grid-template-columns: 1fr/);
    expect(css).toMatch(/@media \(max-width: 480px\)[^@]*\.scout-review-list/);
    expect(css).toMatch(/@media \(min-width: 1280px\) \{[^@]*\.scout-review-list \{[^}]*repeat\(2/);
    expect(css).not.toMatch(/\.scout-card \{[^}]*[^-]width:\s*\d+px/);
  });
});

describe("ScoutReview shows the extended proposal fields", () => {
  it("renders agent/feature/security, github-only sources and dismissed filtering", async () => {
    const src = (await import("node:fs")).readFileSync("ui/src/components/queue/ScoutReview.tsx", "utf8");
    for (const k of ["scoutReview_agentAi", "scoutReview_feature", "scoutReview_security", "scoutReview_sources", "scoutReview_empty"]) expect(src).toContain(`t.${k}`);
    expect(src).toContain("filterDismissed");
    expect(src).toContain("markDismissed");
    expect(src).toContain('rel="noopener noreferrer"');
  });
});
