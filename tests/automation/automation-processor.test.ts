import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutomationProcessor,
  readLastRunAt,
  writeLastRunAt,
  type AutomationDeps,
} from "../../src/core/queue/automation-processor.js";
import type { ScheduleSpec } from "../../src/core/queue/schedule-spec.js";

const SPEC: ScheduleSpec = { kind: "interval", everyMinutes: 15 } as ScheduleSpec;
const NOW = Date.UTC(2026, 10, 3, 5, 0);

function mkDeps(over: Partial<AutomationDeps> = {}, calls: string[] = []): AutomationDeps {
  let last: number | null = NOW - 60 * 60_000;
  return {
    now: () => NOW,
    utcOffsetMinutes: () => 0,
    snapshot: () => ({ enabled: true, scheduleSpec: SPEC }),
    projects: () => ["a", "b", "c"],
    hasApproved: (p) => p !== "c",
    isActive: () => false,
    startRunAll: async (p) => {
      calls.push(`start:${p}`);
    },
    loadLastRunAt: () => last,
    saveLastRunAt: (ms) => {
      calls.push(`save:${ms}`);
      last = ms;
    },
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AutomationProcessor.tick", () => {
  it("off when autopilot is disabled", async () => {
    const calls: string[] = [];
    const p = new AutomationProcessor(mkDeps({ snapshot: () => ({ enabled: false, scheduleSpec: SPEC }) }, calls));
    expect((await p.tick()).status).toBe("off");
    expect(calls).toEqual([]);
  });

  it("no_schedule when enabled without schedule", async () => {
    const p = new AutomationProcessor(mkDeps({ snapshot: () => ({ enabled: true, scheduleSpec: null }) }));
    expect((await p.tick()).status).toBe("no_schedule");
  });

  it("seeds lastRunAt when null and does not start", async () => {
    const calls: string[] = [];
    const p = new AutomationProcessor(mkDeps({ loadLastRunAt: () => null }, calls));
    expect((await p.tick()).status).toBe("seeded");
    expect(calls).toEqual([`save:${NOW}`]);
  });

  it("not_due when schedule is not due", async () => {
    const calls: string[] = [];
    const p = new AutomationProcessor(mkDeps({ loadLastRunAt: () => NOW - 60_000 }, calls));
    expect((await p.tick()).status).toBe("not_due");
    expect(calls).toEqual([]);
  });

  it("ran: saves before start, only approved and inactive projects", async () => {
    const calls: string[] = [];
    const p = new AutomationProcessor(mkDeps({ isActive: (x) => x === "b" }, calls));
    const r = await p.tick();
    expect(r.status).toBe("ran");
    expect(r.started).toEqual(["a"]);
    expect(calls).toEqual([`save:${NOW}`, "start:a"]);
  });

  it("a failing project does not stop the next one", async () => {
    const calls: string[] = [];
    const log = vi.fn();
    const p = new AutomationProcessor(
      mkDeps(
        {
          log,
          startRunAll: async (x) => {
            if (x === "a") throw new Error("boom");
            calls.push(`start:${x}`);
          },
        },
        calls,
      ),
    );
    const r = await p.tick();
    expect(r.status).toBe("ran");
    expect(r.started).toEqual(["b"]);
    expect(r.errors).toEqual([{ project: "a", message: "boom" }]);
    expect(log).toHaveBeenCalled();
  });

  it("busy when ticks overlap", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = new AutomationProcessor(mkDeps({ startRunAll: () => gate }));
    const first = p.tick();
    const second = await p.tick();
    expect(second.status).toBe("busy");
    release();
    expect((await first).status).toBe("ran");
    expect((await p.tick()).status).not.toBe("busy");
  });
});

describe("lastRunAt file", () => {
  it("round-trips and tolerates broken files", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tnf-auto-")), "nested");
    expect(readLastRunAt(dir)).toBeNull();
    writeLastRunAt(dir, 12345);
    expect(readLastRunAt(dir)).toBe(12345);
    fs.writeFileSync(path.join(dir, "automation-state.json"), "{broken", "utf8");
    expect(readLastRunAt(dir)).toBeNull();
  });
});

describe("timer", () => {
  it("start twice creates one timer and stop clears it", async () => {
    vi.useFakeTimers();
    const snapshot = vi.fn(() => ({ enabled: false, scheduleSpec: null }));
    const p = new AutomationProcessor(mkDeps({ snapshot }));
    p.start(1000);
    p.start(1000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(snapshot).toHaveBeenCalledTimes(1);
    p.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(p.running).toBe(false);
  });
});
