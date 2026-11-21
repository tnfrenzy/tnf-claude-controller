import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanUsage, type ScanUsageOptions } from "../../src/core/usage/usage-blocks.js";

let tmp: string;
const NOW = new Date("2026-11-02T00:00:00.000Z");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-blocks-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(opts: Omit<ScanUsageOptions, "claudeDir"> = {}) {
  return scanUsage({ claudeDir: tmp, now: NOW, ...opts });
}

function line(o: {
  ts: string;
  id?: string;
  req?: string;
  session?: string;
  input?: number;
  output?: number;
  model?: string;
}): string {
  const rec: Record<string, unknown> = {
    timestamp: o.ts,
    sessionId: o.session ?? "s1",
    message: {
      ...(o.id ? { id: o.id } : {}),
      model: o.model ?? "m1",
      usage: { input_tokens: o.input ?? 10, output_tokens: o.output ?? 20 },
    },
  };
  if (o.req) rec["requestId"] = o.req;
  return JSON.stringify(rec);
}

function write(rel: string, lines: string[]): void {
  const full = path.join(tmp, "projects", rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.join("\n") + "\n", "utf8");
}

describe("usage-blocks", () => {
  it("splits 5-hour blocks", async () => {
    write("p1/a.jsonl", [
      line({ ts: "2026-11-01T10:20:00.000Z", id: "a", req: "r1" }),
      line({ ts: "2026-11-01T12:00:00.000Z", id: "b", req: "r2" }),
      line({ ts: "2026-11-01T15:30:00.000Z", id: "c", req: "r3" }),
      line({ ts: "2026-11-01T22:00:00.000Z", id: "d", req: "r4" }),
    ]);
    const r = await run();
    expect(r.blocks).toHaveLength(3);
    expect(r.blocks[0]?.start).toBe("2026-11-01T10:00:00.000Z");
    expect(r.blocks[0]?.end).toBe("2026-11-01T15:00:00.000Z");
    expect(r.blocks[0]?.entries).toBe(2);
    expect(r.blocks[0]?.total).toBe(60);
    expect(r.blocks[1]?.start).toBe("2026-11-01T15:00:00.000Z");
    expect(r.blocks[2]?.start).toBe("2026-11-01T22:00:00.000Z");
    expect(r.blocks.reduce((s, b) => s + b.total, 0)).toBe(120);
  });

  it("reports the active block and remaining time", async () => {
    write("p1/a.jsonl", [
      line({ ts: "2026-11-01T10:20:00.000Z", id: "a", req: "r1" }),
      line({ ts: "2026-11-01T12:00:00.000Z", id: "b", req: "r2" }),
    ]);
    const live = await run({ now: new Date("2026-11-01T13:00:00.000Z") });
    expect(live.activeBlock).not.toBeNull();
    expect(live.remainingMs).toBe(2 * 3600_000);
    const done = await run({ now: new Date("2026-11-01T16:00:00.000Z") });
    expect(done.activeBlock).toBeNull();
    expect(done.remainingMs).toBe(0);
  });

  it("skips broken lines without throwing", async () => {
    write("p1/a.jsonl", [
      line({ ts: "2026-11-01T10:20:00.000Z", id: "a", req: "r1" }),
      '{"timestamp":"2026-11-01T10:2',
      "",
      JSON.stringify({ timestamp: "2026-11-01T10:30:00.000Z", message: { id: "x" } }),
      line({ ts: "2026-11-01T10:40:00.000Z", id: "b", req: "r2" }),
    ]);
    const r = await run();
    expect(r.skippedLines).toBeGreaterThanOrEqual(3);
    expect(r.blocks[0]?.entries).toBe(2);
    expect(r.blocks[0]?.total).toBe(60);
  });

  it("counts duplicated message+request once, keeping the largest output", async () => {
    // small first, then large (same file); large first, then small (other file)
    write("p1/a.jsonl", [
      line({ ts: "2026-11-01T10:00:00.000Z", id: "m1", req: "q1", output: 5 }),
      line({ ts: "2026-11-01T10:00:01.000Z", id: "m1", req: "q1", output: 500 }),
    ]);
    write("p1/b.jsonl", [
      line({ ts: "2026-11-01T11:00:00.000Z", id: "m2", req: "q2", output: 500 }),
    ]);
    write("p1/s1/subagents/agent-x.jsonl", [
      line({ ts: "2026-11-01T11:00:01.000Z", id: "m2", req: "q2", output: 5 }),
    ]);
    const r = await run();
    expect(r.blocks[0]?.entries).toBe(2);
    expect(r.blocks[0]?.output).toBe(1000);
  });

  it("dedupes by messageId when requestId is missing", async () => {
    write("p1/a.jsonl", [
      line({ ts: "2026-11-01T10:00:00.000Z", id: "m1", output: 5 }),
      line({ ts: "2026-11-01T10:00:01.000Z", id: "m1", output: 500 }),
    ]);
    const r = await run();
    expect(r.blocks[0]?.entries).toBe(1);
    expect(r.blocks[0]?.output).toBe(500);
  });

  it("sums by day and by session, including subagent files", async () => {
    write("p1/a.jsonl", [
      line({ ts: "2026-11-01T10:00:00.000Z", id: "a", req: "r1", session: "s1" }),
      line({ ts: "2026-11-02T10:00:00.000Z", id: "b", req: "r2", session: "s1" }),
    ]);
    write("p1/s2/subagents/agent-x.jsonl", [
      line({ ts: "2026-11-02T11:00:00.000Z", id: "c", req: "r3", session: "s2" }),
    ]);
    const r = await run({ now: new Date("2026-11-03T00:00:00.000Z") });
    expect(r.byDay.map((d) => [d.day, d.total])).toEqual([
      ["2026-11-01", 30],
      ["2026-11-02", 60],
    ]);
    expect(r.bySession.map((s) => [s.sessionId, s.total])).toEqual([
      ["s1", 60],
      ["s2", 30],
    ]);
  });

  it("marks cost as estimate and only adds cost when pricing matches", async () => {
    write("p1/a.jsonl", [line({ ts: "2026-11-01T10:00:00.000Z", id: "a", req: "r1", input: 1_000_000, output: 0 })]);
    const none = await run();
    expect(none.costIsEstimate).toBe(true);
    expect(none.byDay[0]).not.toHaveProperty("estimatedCostUsd");
    const priced = await run({ pricing: { m1: { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 } } });
    expect(priced.costIsEstimate).toBe(true);
    expect(priced.byDay[0]?.estimatedCostUsd).toBeCloseTo(3);
  });

  it("returns empty result for a missing dir and skips a directory named *.jsonl", async () => {
    const missing = await scanUsage({ claudeDir: path.join(tmp, "nope"), now: NOW });
    expect(missing.blocks).toEqual([]);
    expect(missing.byDay).toEqual([]);
    expect(missing.activeBlock).toBeNull();
    fs.mkdirSync(path.join(tmp, "projects", "p1", "x.jsonl"), { recursive: true });
    write("p1/a.jsonl", [line({ ts: "2026-11-01T10:00:00.000Z", id: "a", req: "r1" })]);
    const r = await run();
    expect(r.skippedFiles).toBe(1);
    expect(r.blocks).toHaveLength(1);
  });
});
