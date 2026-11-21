import { describe, expect, it } from "vitest";
import { createManagerRunStep, type StepManager, type StepRunRecord } from "../../src/core/skill-workshop/run-step.js";

function fake(done: StepRunRecord | null) {
  const calls: any[] = [];
  const cancelled: string[] = [];
  let release: () => void = () => {};
  const manager: StepManager = {
    async startRun(input) {
      calls.push(input);
      return { id: "r1" };
    },
    async waitFor() {
      return done;
    },
    cancel(id) {
      cancelled.push(id);
      return true;
    }
  };
  return { manager, calls, cancelled, release };
}

describe("createManagerRunStep", () => {
  it("returns ok, cost and text from a done run, with research kind and no Bash", async () => {
    const f = fake({ id: "r1", status: "done", cost_usd_est: 0.25, result_text: "hi" });
    const { runStep } = createManagerRunStep(f.manager);
    const r = await runStep("chay-thu", "p");
    expect(r).toEqual({ runId: "r1", costUsd: 0.25, text: "hi", ok: true });
    expect(f.calls[0].kind).toBe("research");
    expect(f.calls[0].roles).toBe(false);
    expect(f.calls[0].project).toBe("skill-workshop");
    expect((f.calls[0].allowedTools as string[]).some((t) => /^Bash/.test(t))).toBe(false);
  });
  it("counts cost on failed runs", async () => {
    const f = fake({ id: "r1", status: "error", cost_usd_est: 0.5, result_text: null, error: "boom" });
    const r = await createManagerRunStep(f.manager).runStep("chay-thu", "p");
    expect(r.ok).toBe(false);
    expect(r.costUsd).toBe(0.5);
    expect(r.error).toBe("boom");
  });
  it("missing cost becomes 0", async () => {
    const f = fake({ id: "r1", status: "done", result_text: "x" });
    const r = await createManagerRunStep(f.manager).runStep("soan-skill", "p");
    expect(r.costUsd).toBe(0);
  });
  it("startRun failure becomes ok:false", async () => {
    const manager: StepManager = { startRun: async () => { throw new Error("nope"); }, waitFor: async () => null, cancel: () => false };
    const r = await createManagerRunStep(manager).runStep("chay-thu", "p");
    expect(r).toMatchObject({ ok: false, costUsd: 0, error: "nope" });
  });
  it("cancelActive cancels the run in flight", async () => {
    const cancelled: string[] = [];
    let resolveWait: (v: StepRunRecord) => void = () => {};
    const manager: StepManager = {
      startRun: async () => ({ id: "r9" }),
      waitFor: () => new Promise((res) => { resolveWait = res; }),
      cancel: (id) => { cancelled.push(id); return true; }
    };
    const { runStep, cancelActive } = createManagerRunStep(manager);
    const p = runStep("chay-thu", "p");
    await new Promise((r) => setTimeout(r, 10));
    cancelActive();
    resolveWait({ id: "r9", status: "cancelled" });
    const r = await p;
    expect(cancelled).toEqual(["r9"]);
    expect(r.ok).toBe(false);
  });
});
