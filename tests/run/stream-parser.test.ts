import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COORDINATOR_ID, StreamParser, summarizeToolInput } from "../../src/core/run/stream-parser.js";
import type { NormalizedEvent } from "../../src/core/run/events.js";

const FIX = path.resolve(__dirname, "..", "..", "fixtures");

function parseFixture(name: string): { parser: StreamParser; events: NormalizedEvent[] } {
  const parser = new StreamParser("run-test");
  const events: NormalizedEvent[] = [];
  for (const line of fs.readFileSync(path.join(FIX, name), "utf8").split(/\r?\n/)) events.push(...parser.feedLine(line));
  // The runner calls finalize() when the process exits; emulate that here.
  events.push(...parser.finalize());
  return { parser, events };
}

describe("StreamParser – hello fixture", () => {
  it("emits run.started, text deltas, text.message, usage and run.result", () => {
    const { parser, events } = parseFixture("hello.stream.jsonl");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run.started");
    expect(types.filter((t) => t === "text.delta")).toHaveLength(2);
    expect(types).toContain("text.message");
    expect(types).toContain("usage.update");
    expect(types.at(-1)).toBe("run.result");
    const started = events[0] as Extract<NormalizedEvent, { type: "run.started" }>;
    expect(started.session_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(started.claude_version).toBe("2.1.301");
    const result = events.at(-1) as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(result.ok).toBe(true);
    expect(result.cost_usd_est).toBeCloseTo(0.0028);
    expect(result.usage).toEqual({ input: 3, output: 12, cache_read: 0, cache_write: 2100 });
    expect(result.num_turns).toBe(1);
    expect(parser.hasResult).toBe(true);
    expect(parser.agents.size).toBe(1);
  });
});

describe("StreamParser – roles fixture (agent tree)", () => {
  it("builds coordinator → searcher/synthesizer tree from parent_tool_use_id", () => {
    const { parser, events } = parseFixture("roles.stream.jsonl");
    const started = events.filter((e): e is Extract<NormalizedEvent, { type: "agent.started" }> => e.type === "agent.started");
    expect(started.map((s) => s.role)).toEqual(["searcher", "synthesizer"]);
    expect(started.every((s) => s.parent_id === COORDINATOR_ID)).toBe(true);

    const searcher = parser.agents.get("toolu_search1")!;
    expect(searcher.status).toBe("finished");
    expect(searcher.summary).toContain("notes/searcher-site.md");
    expect(searcher.model).toBe("claude-haiku-4-5-20251001");
    // searcher usage = sum of its three assistant messages
    expect(searcher.usage.input).toBe(400 + 900 + 1100);

    const toolUses = events.filter((e): e is Extract<NormalizedEvent, { type: "tool.use" }> => e.type === "tool.use");
    const fetch = toolUses.find((t) => t.tool === "WebFetch")!;
    expect(fetch.agent_id).toBe("toolu_search1");
    expect(fetch.input_summary).toBe("https://example.com");

    const finished = events.filter((e) => e.type === "agent.finished");
    expect(finished).toHaveLength(2);
  });

  it("stores unknown event types as `unknown` without throwing", () => {
    const { events } = parseFixture("roles.stream.jsonl");
    const unknown = events.filter((e): e is Extract<NormalizedEvent, { type: "unknown" }> => e.type === "unknown");
    expect(unknown).toHaveLength(1);
    expect((unknown[0]!.raw as { type: string }).type).toBe("weird_future_event");
  });

  it("totals usage across all agents", () => {
    const { parser } = parseFixture("roles.stream.jsonl");
    expect(parser.totalUsage.output).toBe(95 + 60 + 120 + 40 + 70 + 30 + 400 + 80);
  });
});

describe("StreamParser – robustness", () => {
  it("handles garbage lines and empty lines", () => {
    const p = new StreamParser("r");
    expect(p.feedLine("")).toEqual([]);
    expect(p.feedLine("   ")).toEqual([]);
    const ev = p.feedLine("{not json");
    expect(ev[0]!.type).toBe("unknown");
    expect(p.feedLine("[1,2]")[0]!.type).toBe("unknown");
  });

  it("registers an unseen parent_tool_use_id as an unknown agent", () => {
    const p = new StreamParser("r");
    const ev = p.feedLine(JSON.stringify({ type: "assistant", parent_tool_use_id: "toolu_ghost", message: { content: [{ type: "text", text: "hi" }] } }));
    expect(ev[0]).toEqual({ type: "text.message", agent_id: "toolu_ghost", text: "hi" });
    expect(p.agents.get("toolu_ghost")?.role).toBe("unknown");
  });

  it("maps error results to run.error with max_turns kind", () => {
    const p = new StreamParser("r");
    const seg = p.feedLine(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 3, result: "", total_cost_usd: 0.1 }));
    expect(seg.map((e) => e.type)).toEqual(["run.segment"]);
    const ev = p.finalize();
    expect(ev.map((e) => e.type)).toEqual(["run.result", "run.error"]);
    expect((ev[1] as Extract<NormalizedEvent, { type: "run.error" }>).kind).toBe("max_turns");
  });

  it("emits api.retry and permission.denied", () => {
    const p = new StreamParser("r");
    expect(p.feedLine(JSON.stringify({ type: "system", subtype: "api_retry", attempt: 2, error: "overloaded" }))[0]).toEqual({ type: "api.retry", attempt: 2, error: "overloaded" });
    const d = p.feedLine(JSON.stringify({ type: "system", subtype: "permission_denied", tool_name: "Bash", reason: "not allowed" }))[0];
    expect(d).toMatchObject({ type: "permission.denied", tool: "Bash" });
  });

  it("maps permission_denied.agent_id (task_id) to the subagent, falling back to coordinator", () => {
    const p = new StreamParser("r");
    p.feedLine(JSON.stringify({ type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "toolu_a", subagent_type: "implementer", description: "x" }));
    const hit = p.feedLine(JSON.stringify({ type: "system", subtype: "permission_denied", tool_name: "Bash", agent_id: "task-1", message: "no" }))[0];
    expect(hit).toMatchObject({ type: "permission.denied", agent_id: "toolu_a", reason: "no" });
    const miss = p.feedLine(JSON.stringify({ type: "system", subtype: "permission_denied", tool_name: "Bash", agent_id: "task-zzz", message: "no" }))[0];
    expect(miss).toMatchObject({ type: "permission.denied", agent_id: COORDINATOR_ID });
  });

  it("emits agent.verdict from a VERDICT: first line and ignores task_summary", () => {
    const p = new StreamParser("r");
    expect(p.feedLine(JSON.stringify({ type: "system", subtype: "task_summary", detail: "x" }))).toEqual([]);
    p.feedLine(JSON.stringify({ type: "system", subtype: "task_started", task_id: "t", tool_use_id: "toolu_q", subagent_type: "qa" }));
    const evs = p.feedLine(JSON.stringify({ type: "system", subtype: "task_notification", tool_use_id: "toolu_q", status: "completed", summary: "VERDICT: PASS\n\nTất cả đạt." }));
    expect(evs.map((e) => e.type)).toEqual(["agent.finished", "agent.verdict"]);
    expect(evs[1]).toEqual({ type: "agent.verdict", agent_id: "toolu_q", role: "qa", verdict: "PASS" });
    const none = p.feedLine(JSON.stringify({ type: "system", subtype: "task_notification", tool_use_id: "toolu_q", status: "completed", summary: "Không có verdict" }));
    expect(none.map((e) => e.type)).toEqual(["agent.finished"]);
  });

  describe("agentForVcs attribution", () => {
    const spawn = (p: StreamParser, id: string, role: string) =>
      p.feedLine(JSON.stringify({ type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: role, description: "d" } }] } }));
    const vcs = (p: StreamParser, extra: Record<string, unknown> = {}) =>
      p.feedLine(JSON.stringify({ type: "system", subtype: "vcs_state_changed", kind: "commit", branch: "tnf/x", cwd: "D:\\wt", ...extra }))[0] as { agent_id: string };

    it("assigns the commit to the sole running subagent", () => {
      const p = new StreamParser("r");
      spawn(p, "toolu_a", "implementer");
      expect(vcs(p).agent_id).toBe("toolu_a");
    });

    it("falls back to the coordinator when two subagents are running", () => {
      const p = new StreamParser("r");
      spawn(p, "toolu_a", "implementer");
      spawn(p, "toolu_b", "qa");
      expect(vcs(p).agent_id).toBe(COORDINATOR_ID);
    });

    it("falls back to the coordinator when the subagent already finished", () => {
      const p = new StreamParser("r");
      spawn(p, "toolu_a", "implementer");
      p.feedLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "done", is_error: false }] } }));
      expect(vcs(p).agent_id).toBe(COORDINATOR_ID);
    });

    it("keeps the old behaviour for a non-empty parent_tool_use_id", () => {
      const p = new StreamParser("r");
      spawn(p, "toolu_a", "implementer");
      spawn(p, "toolu_b", "qa");
      expect(vcs(p, { parent_tool_use_id: "toolu_b" }).agent_id).toBe("toolu_b");
    });

    it("(b) two running subagents and no parent_tool_use_id: coordinator fallback", () => {
      const p = new StreamParser("r");
      spawn(p, "toolu_impl", "implementer");
      spawn(p, "toolu_qa", "qa");
      expect(vcs(p).agent_id).toBe(COORDINATOR_ID);
    });

    it("(c) parent_tool_use_id wins even with two running subagents", () => {
      const p = new StreamParser("r");
      spawn(p, "toolu_impl", "implementer");
      spawn(p, "toolu_qa", "qa");
      expect(vcs(p, { parent_tool_use_id: "toolu_impl" }).agent_id).toBe("toolu_impl");
    });

    it("(d) no subagent running: coordinator", () => {
      const p = new StreamParser("r");
      expect(vcs(p).agent_id).toBe(COORDINATOR_ID);
    });

    it("attributes real-fixture vcs.commit events to the implementer subagent", () => {
      const { parser, events } = parseFixture("real-coding-pass.stream.jsonl");
      const commits = events.filter((e) => e.type === "vcs.commit") as Array<{ agent_id: string }>;
      expect(commits).toHaveLength(2);
      for (const c of commits) {
        expect(c.agent_id).not.toBe(COORDINATOR_ID);
        expect(c.agent_id).toBe("toolu_01DKvyMFGfPfhs3m77zhWTug");
        expect(parser.agents.get(c.agent_id)?.role).toBe("implementer");
      }
    });
  });

  it("emits vcs.commit and tracks the last test command output", () => {
    const p = new StreamParser("r");
    const c = p.feedLine(JSON.stringify({ type: "system", subtype: "vcs_state_changed", kind: "commit", branch: "tnf/x", cwd: "D:\\wt" }))[0];
    expect(c).toEqual({ type: "vcs.commit", agent_id: COORDINATOR_ID, kind: "commit", branch: "tnf/x", cwd: "D:\\wt" });
    p.feedLine(JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test 2>&1 | tail -n 5" } }] } }));
    p.feedLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "x".repeat(500) + "\npass 3 fail 0", is_error: false }] } }));
    expect(p.lastTestOutput).toMatchObject({ agent_id: COORDINATOR_ID, command: "npm test 2>&1 | tail -n 5", ok: true });
    expect(p.lastTestOutput!.text.length).toBeGreaterThan(400);
    p.feedLine(JSON.stringify({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "tu2", name: "Bash", input: { command: "git log --oneline -3" } }] } }));
    p.feedLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu2", content: "abc", is_error: false }] } }));
    expect(p.lastTestOutput!.command).toMatch(/^npm test/);
  });
});

describe("summarizeToolInput", () => {
  it("summarizes known tools and truncates", () => {
    expect(summarizeToolInput("WebSearch", { query: "thang máy" })).toBe("thang máy");
    expect(summarizeToolInput("Agent", { subagent_type: "searcher", description: "x" })).toBe("searcher: x");
    expect(summarizeToolInput("Other", { a: "b".repeat(500) }).length).toBeLessThanOrEqual(160);
  });
});

describe("StreamParser – subagent interrupted before its notification (real stream, CLI 2.1.301)", () => {
  // Coordinator launched `implementer` in the background; the process then exited and the CLI reported the task as
  // `stopped`/`killed` while the final result line still said success ("Implementer đang chạy, tôi đang chờ…").
  it("does not report such a run as successful", () => {
    const { parser, events } = parseFixture("interrupted-subagent.stream.jsonl");
    const finished = events.find((e) => e.type === "agent.finished") as Extract<NormalizedEvent, { type: "agent.finished" }>;
    expect(finished.status).toBe("stopped");
    const result = events.find((e) => e.type === "run.result") as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(result.ok).toBe(false);
    const err = events.find((e) => e.type === "run.error") as Extract<NormalizedEvent, { type: "run.error" }>;
    expect(err.kind).toBe("subagent_interrupted");
    expect(err.message).toContain("implementer");
    expect(err.message).toContain("Hỏi tiếp");
    expect(parser.interruptedRoles()).toEqual(["implementer"]);
  });

  it("flags a background subagent that never got a notification as interrupted", () => {
    const lines = fs.readFileSync(path.join(FIX, "interrupted-subagent.stream.jsonl"), "utf8").split(/\r?\n/).filter((l) => !l.includes('"task_notification"'));
    const parser = new StreamParser("run-test");
    const events: NormalizedEvent[] = [];
    for (const l of lines) events.push(...parser.feedLine(l));
    events.push(...parser.finalize());
    const err = events.find((e) => e.type === "run.error") as Extract<NormalizedEvent, { type: "run.error" }>;
    expect(err.kind).toBe("subagent_interrupted");
    expect(parser.agents.get("toolu_01G6oCC8CBR5u3Y59jHXzwi2")?.task_status).toBe("interrupted");
  });

  it("does not flag completed subagents or stopped Bash background tasks", () => {
    const { parser, events } = parseFixture("roles.stream.jsonl");
    expect(parser.interruptedRoles()).toEqual([]);
    expect(events.some((e) => e.type === "run.error")).toBe(false);
    const result = events.find((e) => e.type === "run.result") as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(result.ok).toBe(true);
  });
});

describe("StreamParser – no false positive on completed real coding runs", () => {
  it.each(["real-coding-pass.stream.jsonl", "real-coding-commit.stream.jsonl", "real-coding.stream.jsonl", "real-roles.stream.jsonl"])("%s", (name) => {
    const { parser, events } = parseFixture(name);
    expect(parser.interruptedRoles()).toEqual([]);
    expect(events.some((e) => e.type === "run.error" && e.kind === "subagent_interrupted")).toBe(false);
  });
});
