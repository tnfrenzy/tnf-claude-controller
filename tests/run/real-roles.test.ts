import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StreamParser } from "../../src/core/run/stream-parser.js";
import type { NormalizedEvent } from "../../src/core/run/events.js";

/** Real coordinator + 3 roles run captured from Claude Code 2.1.301 on 2026-10-20 (smoke --roles). */
const FILE = path.resolve(__dirname, "..", "..", "fixtures", "real-roles.stream.jsonl");

describe("StreamParser – real roles run (background subagents, multiple result lines)", () => {
  const parser = new StreamParser("real-roles");
  const events: NormalizedEvent[] = [];
  for (const line of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) events.push(...parser.feedLine(line));
  const final = parser.finalize();
  const types = (t: NormalizedEvent["type"]) => events.filter((e) => e.type === t);

  it("has no unknown events", () => {
    expect(types("unknown")).toEqual([]);
  });
  it("starts the run once although init is repeated per subagent", () => {
    expect(types("run.started")).toHaveLength(1);
  });
  it("builds searcher×2 → analyzer → synthesizer under the coordinator", () => {
    const started = types("agent.started") as Extract<NormalizedEvent, { type: "agent.started" }>[];
    expect(started.map((s) => s.role)).toEqual(["searcher", "searcher", "analyzer", "synthesizer"]);
    expect(started.every((s) => s.parent_id === "coordinator")).toBe(true);
  });
  it("does not finish agents on the async-launch tool result; finishes them on task_notification", () => {
    const finished = types("agent.finished") as Extract<NormalizedEvent, { type: "agent.finished" }>[];
    expect(finished).toHaveLength(4);
    expect(finished.every((f) => !/Async agent launched/.test(f.summary))).toBe(true);
    expect(finished.every((f) => f.status === "completed" && !!f.output_file)).toBe(true);
    const synth = [...parser.agents.values()].find((a) => a.role === "synthesizer")!;
    expect(synth.status).toBe("finished");
    expect(synth.output_file).toMatch(/\.output$/);
    expect(synth.progress?.total_tokens).toBeGreaterThan(0);
  });
  it("emits agent.progress from task_progress", () => {
    expect(types("agent.progress").length).toBeGreaterThan(10);
  });
  it("treats the five result lines as segments and finalizes once", () => {
    expect(types("run.segment")).toHaveLength(5);
    expect(types("run.result")).toHaveLength(0);
    expect(final.map((e) => e.type)).toEqual(["run.result"]);
    const r = final[0] as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Báo cáo chưa được lưu");
    expect(r.cost_usd_est).toBeCloseTo(0.4864, 3);
    expect(r.num_turns).toBe(3 + 1 + 2 + 2 + 1);
    // usage from modelUsage (sonnet + haiku)
    expect(r.usage).toEqual({ input: 28 + 72761, output: 19544 + 33268, cache_read: 363204 + 59678, cache_write: 68463 + 28433 });
    expect(r.permission_denials).toEqual([]);
  });
  it("attributes subagent usage to the subagent, not the coordinator", () => {
    const agents = [...parser.agents.values()];
    const searchers = agents.filter((a) => a.role === "searcher");
    const coord = agents.find((a) => a.role === "coordinator")!;
    // Forwarded subagent `assistant` lines only carry partial usage snapshots (no message_delta is forwarded), so
    // per-agent `usage` undercounts; `progress.total_tokens` from task_progress is the reliable per-subagent figure.
    const searcherTotal = searchers.reduce((s, a) => s + (a.progress?.total_tokens ?? 0), 0);
    expect(searcherTotal).toBeGreaterThan(10_000);
    expect(searchers.every((a) => a.usage.output > 0)).toBe(true);
    expect(coord.usage.output).toBeLessThan(parser.totalUsage.output);
    expect(searchers.every((a) => a.model === "claude-haiku-5-5")).toBe(true);
  });
  it("records the refused subagent Write calls as failed tool results", () => {
    const failed = (types("tool.result") as Extract<NormalizedEvent, { type: "tool.result" }>[]).filter((t) => !t.ok);
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(failed.some((f) => /return findings as text/.test(f.summary))).toBe(true);
  });
});
