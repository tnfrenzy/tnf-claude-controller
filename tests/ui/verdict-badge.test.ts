import { describe, expect, it } from "vitest";
import { verdictLabel, verdictTone } from "../../ui/src/components/run/Verdict";
import { reduceOffice, emptyOffice } from "../../ui/src/office/model";
import { buildSummary } from "../../ui/src/run/runSummary";

describe("PASS_ENV verdict", () => {
  it("tone is warn, different from PASS and FAIL", () => {
    expect(verdictTone("PASS_ENV")).toBe("warn");
    expect(verdictTone("PASS_ENV")).not.toBe(verdictTone("PASS"));
    expect(verdictTone("PASS_ENV")).not.toBe(verdictTone("FAIL"));
  });
  it("has vi label and en fallback", () => {
    expect(verdictLabel("PASS_ENV", "vi")).toContain("lỗi môi trường đã biết");
    expect(verdictLabel("PASS_ENV", "en")).toBe("PASS_ENV");
  });
  it("run summary counts PASS_ENV as pass", () => {
    const s = buildSummary({ kind: "coding", status: "done", verdicts: [{ verdict: "PASS_ENV" }] }, "unknown");
    expect(s.verdict).toBe("pass");
  });
  it("office model treats PASS_ENV as done, not error", () => {
    const base = reduceOffice(emptyOffice("r1"), { seq: 1, run_id: "r1", ts: 1, event: { type: "agent.started", agent_id: "a1", role: "qa", parent_id: null, tool_use_id: null } } as never);
    const next = reduceOffice(base, { seq: 2, run_id: "r1", ts: 2, event: { type: "agent.verdict", agent_id: "a1", role: "qa", verdict: "PASS_ENV" } } as never);
    const a = next.agents.find((x) => x.id === "a1");
    expect(a?.bubble?.kind).toBe("done");
  });
});
