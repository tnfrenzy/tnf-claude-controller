import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatSize, shortHash } from "../../ui/src/settings/releaseFlow.js";

const runPage = readFileSync("ui/src/pages/RunPage.tsx", "utf8");

describe("release result helpers", () => {
  it("formats file sizes", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(512 * 1024)).toBe("512 KB");
    expect(formatSize(25_797_611)).toBe("24,6 MB");
    expect(formatSize(-1)).toBe("");
  });
  it("shortens a sha256 to 12 characters", () => {
    expect(shortHash("0123456789abcdef0123456789abcdef")).toBe("0123456789ab");
    expect(shortHash("abc")).toBe("abc");
  });
});

describe("RunPage release flow", () => {
  it("a missing release config shows a persistent choice, not a silent version bump", () => {
    expect(runPage).toContain("relTemplates");
    expect(runPage).toContain('data-testid="rel-no-config"');
    expect(runPage).toContain("t.rel_use_template");
    expect(runPage).toContain("t.rel_bump_only");
    // the old behaviour: a transient notice then straight into the bump-only confirmation
    const branch = runPage.slice(runPage.indexOf('e.code === "no_release_config"'), runPage.indexOf('e.code === "no_release_config"') + 400);
    expect(branch).not.toContain("setNotice");
    expect(branch).not.toContain("setPublishStep");
  });
  it("choosing a template saves it and then runs the dry-run preview", () => {
    const fn = runPage.slice(runPage.indexOf("const useTemplate"), runPage.indexOf("const executeRelease"));
    expect(fn).toContain("api.putReleaseConfig(run.project, { template })");
    expect(fn).toContain("await startRelease()");
  });
  it("the bump-only choice still reaches the two-step version bump confirmation", () => {
    expect(runPage).toMatch(/setRelTemplates\(null\); setPublishStep\(\(s\) => nextConfirmStep\(s, "ask"\)\)/);
  });
  it("the finished release shows the installer path, size and short sha with a copy button", () => {
    expect(runPage).toContain('data-testid="rel-artifact"');
    expect(runPage).toContain("relResult.log.artifact.path");
    expect(runPage).toContain("formatSize(relResult.log.artifact.size)");
    expect(runPage).toContain("shortHash(relResult.log.artifact.sha256)");
    expect(runPage).toContain("t.rel_copy");
  });
  it("the plain Phát hành button is hidden while the template choice is open", () => {
    expect(runPage).toContain('relPhase === "idle" && relTemplates === null && <button');
  });
});

describe("release progress while running", () => {
  it("formatElapsed and releaseElapsed", async () => {
    const { formatElapsed, releaseElapsed } = await import("../../ui/src/settings/releaseFlow.js");
    expect(formatElapsed(32_000)).toBe("32 s");
    expect(formatElapsed(125_000)).toBe("2 ph 05 s");
    const t0 = Date.parse("2026-10-29T02:00:00.000Z");
    expect(releaseElapsed({ steps: [{ index: 1, startedAt: "2026-10-29T02:00:00.000Z" }] }, 1, t0 + 61_000)).toBe("1 ph 01 s");
    expect(releaseElapsed({ steps: [{ index: 1, startedAt: null }] }, 1)).toBe("");
    expect(releaseElapsed({ steps: [] }, 3)).toBe("");
  });
  it("RunPage shows the current step, the elapsed time and the keep-open warning instead of one line", () => {
    expect(runPage).toContain('data-testid="rel-progress"');
    expect(runPage).toContain("setRelProgress");
    expect(runPage).toContain("t.rel_keep_open");
    expect(runPage).toContain("releaseElapsed(relProgress, s.index)");
  });
});
