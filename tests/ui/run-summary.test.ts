import { describe, expect, it } from "vitest";
import { buildSummary, parseTestStatus } from "../../ui/src/run/runSummary.js";

const base = { kind: "coding", status: "done", merged: true };

describe("buildSummary", () => {
  it("pass, 2 commits, 4 files, test pass", () => {
    const s = buildSummary(
      { ...base, verdicts: [{ verdict: "PASS" }], commits: [{}, {}], changed_files: 4, cost_usd_est: 0.41, duration_ms: 1000 },
      "pass",
    );
    expect(s).toMatchObject({ verdict: "pass", commits: 2, files: 4, test: "pass", costUsd: 0.41, durationMs: 1000, primary: "diff" });
  });
  it("fail verdict (last one wins)", () => {
    expect(buildSummary({ ...base, verdicts: [{ verdict: "PASS" }, { verdict: "FAIL" }] }, "fail").verdict).toBe("fail");
  });
  it("no verdict", () => {
    expect(buildSummary({ ...base }, "unknown").verdict).toBe("none");
  });
  it("coding done not merged -> primary commit", () => {
    expect(buildSummary({ kind: "coding", status: "done", merged: false }, "unknown").primary).toBe("commit");
  });
  it("research run -> primary diff", () => {
    expect(buildSummary({ kind: "research", status: "done" }, "unknown").primary).toBe("diff");
  });
});

describe("parseTestStatus", () => {
  it("parses the three headers and empty", () => {
    expect(parseTestStatus("# Lần chạy test cuối (thành công)\n$ npm test")).toBe("pass");
    expect(parseTestStatus("# Lần chạy test cuối (thất bại / bị từ chối)\n$ x")).toBe("fail");
    expect(parseTestStatus("Không tìm thấy lần chạy test nào trong stream")).toBe("unknown");
    expect(parseTestStatus("")).toBe("unknown");
    expect(parseTestStatus(null)).toBe("unknown");
  });
});
