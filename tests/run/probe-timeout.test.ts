import { describe, expect, it } from "vitest";
import { buildProbePrompt, probeWasCut, summarizeProbe } from "../../scripts/probe-timeout.js";

describe("probe-timeout (pure helpers, no real run)", () => {
  it("prompt contains the 700000 ms sleep command", () => {
    const p = buildProbePrompt();
    expect(p).toContain("setTimeout(()=>{},700000)");
    expect(p).toContain("PROBE: CUT");
  });
  it("summarizeProbe covers the four combinations", () => {
    expect(summarizeProbe(true, false)).toMatch(/được ủng hộ/);
    expect(summarizeProbe(true, true)).toMatch(/cả hai đều bị cắt/);
    expect(summarizeProbe(false, true)).toMatch(/bất thường/);
    expect(summarizeProbe(false, false)).toMatch(/không bị cắt/);
  });
  it("probeWasCut: non-done status or interrupted error counts as cut", () => {
    expect(probeWasCut({ status: "done" })).toBe(false);
    expect(probeWasCut({ status: "error", error: "x" })).toBe(true);
    expect(probeWasCut({ status: "done", error: "subagent_interrupted" })).toBe(true);
  });
});
