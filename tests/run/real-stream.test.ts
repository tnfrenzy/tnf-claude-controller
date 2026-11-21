import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StreamParser } from "../../src/core/run/stream-parser.js";
import type { NormalizedEvent } from "../../src/core/run/events.js";

/** Real stream captured from Claude Code 2.1.301 on 2026-10-20 (smoke "chào" run). */
const FILE = path.resolve(__dirname, "..", "..", "fixtures", "real-hello.stream.jsonl");

describe("StreamParser – real CLI 2.1.301 stream", () => {
  const parser = new StreamParser("real");
  const events: NormalizedEvent[] = [];
  for (const line of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) events.push(...parser.feedLine(line));
  events.push(...parser.finalize());

  it("produces no unknown events for hook/status/thinking_tokens/rate_limit lines", () => {
    expect(events.filter((e) => e.type === "unknown")).toEqual([]);
  });
  it("reads session, version, result and cost", () => {
    const started = events.find((e) => e.type === "run.started") as Extract<NormalizedEvent, { type: "run.started" }>;
    expect(started.session_id).toBe("b7216338-4560-47d0-8d1f-615db5b55507");
    expect(started.claude_version).toBe("2.1.301");
    const result = events.at(-1) as Extract<NormalizedEvent, { type: "run.result" }>;
    expect(result.type).toBe("run.result");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Chào bạn");
    expect(result.cost_usd_est).toBeCloseTo(0.0048, 3);
    expect(result.usage).toEqual({ input: 2, output: 92, cache_read: 17004, cache_write: 22965 });
  });
  it("does not double-count usage when the same message id appears twice", () => {
    const coord = parser.agents.get("coordinator")!;
    expect(coord.usage).toEqual({ input: 2, output: 92, cache_read: 17004, cache_write: 22965 });
    expect(parser.totalUsage).toEqual({ input: 2, output: 92, cache_read: 17004, cache_write: 22965 });
  });
  it("parses rate_limit_event into rate.limit", () => {
    const rl = events.find((e) => e.type === "rate.limit") as Extract<NormalizedEvent, { type: "rate.limit" }>;
    expect(rl).toBeDefined();
    expect(rl.status).toBe("allowed");
    expect(rl.five_hour_pct).toBe(17);
    expect(rl.seven_day_pct).toBe(32);
    expect(rl.using_overage).toBe(false);
    expect(rl.five_hour_resets_at).toBe(1792494600 * 1000);
  });
  it("emits thinking deltas and text deltas separately", () => {
    expect(events.some((e) => e.type === "thinking.delta")).toBe(true);
    const text = events.filter((e): e is Extract<NormalizedEvent, { type: "text.delta" }> => e.type === "text.delta").map((e) => e.text).join("");
    expect(text).toBe("Chào bạn, mình có thể giúp gì cho bạn hôm nay?");
  });
});
