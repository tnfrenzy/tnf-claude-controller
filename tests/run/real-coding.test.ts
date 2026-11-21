import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COORDINATOR_ID, StreamParser } from "../../src/core/run/stream-parser.js";
import type { NormalizedEvent } from "../../src/core/run/events.js";

const FIX = path.resolve(__dirname, "..", "..", "fixtures");

function parse(file: string) {
  const parser = new StreamParser(file);
  const events: NormalizedEvent[] = [];
  for (const line of fs.readFileSync(path.join(FIX, file), "utf8").split(/\r?\n/)) events.push(...parser.feedLine(line));
  const final = parser.finalize();
  const of = <T extends NormalizedEvent["type"]>(t: T) => events.filter((e): e is Extract<NormalizedEvent, { type: T }> => e.type === t);
  return { parser, events, final, of };
}

/** Spike S5 #2 (2026-10-21, CLI 2.1.301): sonnet coordinator, 6 haiku role calls, implementer denied twice, no commit. */
describe("StreamParser – real coding run (S5, 6-role chain)", () => {
  const { parser, of, final } = parse("real-coding.stream.jsonl");

  it("has no unknown events (task_summary, vcs_state_changed handled)", () => {
    expect(of("unknown")).toEqual([]);
  });
  it("sees the six role calls in order", () => {
    expect(of("agent.started").map((s) => s.role)).toEqual(["analyst", "planner", "critic", "planner", "critic", "implementer"]);
    expect(of("agent.finished")).toHaveLength(6);
  });
  it("emits agent.verdict for the two critic replies", () => {
    const v = of("agent.verdict");
    expect(v.map((x) => x.verdict)).toEqual(["NEEDS_REVISION", "NEEDS_REVISION"]);
    expect(v.every((x) => x.role === "critic")).toBe(true);
    expect(v.map((x) => x.agent_id)).toEqual(["toolu_01Ff7NiULQynQFSVgus8Zihc", "toolu_01UobtB968Q1LP7XVYbFHaJ2"]);
    expect(parser.agents.get("toolu_01UobtB968Q1LP7XVYbFHaJ2")!.verdict).toBe("NEEDS_REVISION");
  });
  it("attributes permission.denied to the implementer, not the coordinator (task_id → tool_use_id)", () => {
    const d = of("permission.denied");
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.agent_id === "toolu_011ec7xSShhy4PKKTt3vjPrD")).toBe(true);
    expect(d.every((x) => x.tool === "Bash")).toBe(true);
    expect(d[0]!.reason).toMatch(/don't ask mode/);
  });
  it("records the denied npm test attempt as a failed test output (ok=false)", () => {
    const t = parser.lastTestOutput!;
    expect(t.agent_id).toBe("toolu_011ec7xSShhy4PKKTt3vjPrD");
    expect(t.command).toContain("npm test");
    expect(t.ok).toBe(false);
    expect(t.text).toMatch(/denied/);
  });
  it("finalizes with the recorded cost", () => {
    const r = final[0] as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(r.ok).toBe(true);
    expect(r.cost_usd_est).toBeCloseTo(0.322, 3);
  });
});

/** Spike d (S6/S7, 2026-10-21): one implementer, Edit + npm test + commit, three denied probes. */
describe("StreamParser – real coding run with commit (spike d)", () => {
  const { parser, of } = parse("real-coding-commit.stream.jsonl");

  it("has no unknown events", () => {
    expect(of("unknown")).toEqual([]);
  });
  it("emits vcs.commit from system/vcs_state_changed", () => {
    const c = of("vcs.commit");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "commit", branch: "tnf/spike-d-20261021042427" });
    expect(c[0]!.cwd).toMatch(/worktrees[\\/]spike-d-20261021042427$/);
  });
  it("captures the last test command output in full", () => {
    const t = parser.lastTestOutput!;
    expect(t).not.toBeNull();
    expect(t.command).toMatch(/^npm test/);
    expect(t.ok).toBe(true);
    expect(t.text).toContain("fail 0");
    expect(t.agent_id).toBe("toolu_0114pWpC7xniH9b7Q6ssFEq2");
  });
  it("attributes the three denied probes to the implementer", () => {
    const d = of("permission.denied");
    expect(d).toHaveLength(3);
    expect(d.every((x) => x.agent_id === "toolu_0114pWpC7xniH9b7Q6ssFEq2")).toBe(true);
    expect(d.map((x) => x.reason)).toEqual([expect.stringContaining("git -C"), expect.stringContaining("git -c"), expect.stringContaining("reset --hard")]);
  });
  it("still knows the coordinator", () => {
    expect(parser.agents.get(COORDINATOR_ID)!.role).toBe("coordinator");
  });
});

/** Phase 5.2 smoke #1 (2026-10-21, CLI 2.1.301): run 20261021-130531-432628, full chain analyst → planner → critic → implementer → qa, PASS, 2 commits, no denials, $0.4062. */
describe("StreamParser – real coding run that PASSED (5.2 smoke)", () => {
  const { parser, of, final } = parse("real-coding-pass.stream.jsonl");

  it("has no unknown events", () => {
    expect(of("unknown")).toEqual([]);
  });
  it("sees the five role calls in the standard order, each finished", () => {
    expect(of("agent.started").map((s) => s.role)).toEqual(["analyst", "planner", "critic", "implementer", "qa"]);
    expect(of("agent.finished")).toHaveLength(5);
    expect([...parser.agents.values()].filter((a) => a.role !== "coordinator").every((a) => a.status === "finished")).toBe(true);
  });
  it("parses the critic and qa verdicts", () => {
    expect(of("agent.verdict").map((v) => [v.role, v.verdict])).toEqual([["critic", "APPROVED_WITH_CONCERNS"], ["qa", "PASS"]]);
  });
  it("keeps each read-only role's full reply for notes/<role>.md, starting with the VERDICT line", () => {
    const byRole = (r: string) => [...parser.agents.values()].find((a) => a.role === r)!;
    expect(byRole("analyst").reply!.length).toBeGreaterThan(300);
    expect(byRole("critic").reply!).toMatch(/^VERDICT: APPROVED_WITH_CONCERNS/);
    expect(byRole("qa").reply!).toMatch(/^VERDICT: PASS/);
    expect(byRole("implementer").reply!).toMatch(/af19ec7|164c02b/);
  });
  it("emits two vcs.commit events on the run branch", () => {
    const c = of("vcs.commit");
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.kind === "commit" && x.branch === "tnf/20261021-130531-432628")).toBe(true);
  });
  it("has no permission.denied and a successful last test run", () => {
    expect(of("permission.denied")).toEqual([]);
    const t = parser.lastTestOutput!;
    expect(t.ok).toBe(true);
    expect(t.command).toMatch(/^npm test/);
    expect(t.text).toContain("fail 0");
  });
  it("finalizes with the recorded cost and turn count", () => {
    const r = final[0] as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(r.ok).toBe(true);
    expect(r.cost_usd_est).toBeCloseTo(0.4062, 3);
    expect(r.num_turns).toBe(11);
  });
});
