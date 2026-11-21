import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../ui/src/pages/RunPage.tsx", import.meta.url), "utf8");

describe("RunPage merge precheck wiring", () => {
  it("imports badge and helper", () => {
    expect(src).toContain('import { MergePrecheckBadge } from "../components/run/MergePrecheckBadge"');
    expect(src).toContain('import { shouldShowMergePrecheck } from "../run/mergePrecheckVisible"');
  });

  it("recheckMerge takes no params, calls the API and updates meta and run", () => {
    expect(src).toContain("const recheckMerge = async () =>");
    expect(src).toContain("api.mergePrecheck(");
    expect(src.split("merge_precheck: res").length - 1).toBe(2);
    const start = src.indexOf("const recheckMerge");
    const body = src.slice(start, src.indexOf("const cancel", start));
    expect(body).toContain("setErr(e instanceof ApiError ? e.message : String(e))");
  });

  it("reads merged only from meta, not run", () => {
    expect(src).toContain("merged: meta?.merged");
    expect(src).not.toContain("run.merged");
  });

  it("places the badge inside the changes tab, after git-log block and before diff stat", () => {
    const tab = src.indexOf('{curTab === "changes" && (');
    const gitLog = src.indexOf('{texts["git-log.txt"] && (', tab);
    const badge = src.indexOf("<MergePrecheckBadge precheck", tab);
    const stat = src.indexOf("{stat && stat.rows.length > 0 ? (", tab);
    expect(tab).toBeGreaterThan(-1);
    expect(gitLog).toBeGreaterThan(tab);
    expect(badge).toBeGreaterThan(gitLog);
    expect(stat).toBeGreaterThan(badge);
  });
});
