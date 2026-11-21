import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TaskListModal merge precheck badge", () => {
  const s = readFileSync(new URL("../../ui/src/components/run/TaskListModal.tsx", import.meta.url), "utf8");

  it("imports and renders the compact badge guarded by shouldShowQueueMergePrecheck", () => {
    expect(s).toContain("MergePrecheckBadge");
    expect(s).toContain("<MergePrecheckBadge compact");
    expect(s).toContain("shouldShowQueueMergePrecheck(c)");
  });

  it("places the badge inside the <li>, not inside <summary>", () => {
    const badge = s.indexOf("<MergePrecheckBadge compact");
    const liOpen = s.lastIndexOf("<li key={c.id}", badge);
    const liClose = s.indexOf("</li>", badge);
    expect(liOpen).toBeGreaterThan(-1);
    expect(liClose).toBeGreaterThan(badge);
    const summaryOpen = s.lastIndexOf("<summary", badge);
    const summaryClose = s.lastIndexOf("</summary>", badge);
    expect(summaryClose).toBeGreaterThan(summaryOpen);
  });

  it("no longer skips confirmMerged in the recovery action list", () => {
    expect(s).not.toContain('a !== "confirmMerged"');
  });
});
