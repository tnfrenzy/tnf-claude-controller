import { describe, expect, it, vi } from "vitest";
import { createW3DRunStep, WORKSHOP3D_PROJECT, type W3DStepManager } from "../../src/core/workshop3d/step-adapter.js";
import { loadW3DRoles } from "../../src/core/workshop3d/roles.js";

type Done = Awaited<ReturnType<W3DStepManager["waitFor"]>>;
function fake(done: Done | (() => Promise<Done>)) {
  const startRun = vi.fn(async (_i: unknown) => ({ id: "r1" }));
  const cancel = vi.fn(() => true);
  const waitFor = vi.fn(async () => (typeof done === "function" ? done() : done));
  const m: W3DStepManager = { startRun: startRun as W3DStepManager["startRun"], waitFor, cancel };
  return { m, startRun, cancel, waitFor };
}

describe("createW3DRunStep", () => {
  const roles = loadW3DRoles();
  it("starts exactly one read-only run with Read-only tool and maps done", async () => {
    const f = fake({ status: "done", cost_usd_est: 0.12, result_text: "xin chao" });
    const { runStep } = createW3DRunStep(f.m, roles, { maxBudgetUsd: 1 });
    const r = await runStep("cad-modeler", "P", "D:/tmp/sess/");
    expect(f.startRun).toHaveBeenCalledTimes(1);
    const arg = f.startRun.mock.calls[0]![0] as any;
    expect(arg.project).toBe(WORKSHOP3D_PROJECT);
    expect(arg.model).toBe(roles["cad-modeler"].model);
    expect(arg.prompt).toBe("P");
    expect(arg.maxBudgetUsd).toBe(1);
    expect(arg.readOnly.allowedTools).toEqual(["Read(D:/tmp/sess/**)"]);
    expect(arg.readOnly.addDirs).toEqual(["D:/tmp/sess/"]);
    expect(arg.readOnly.systemPrompt).toBe(roles["cad-modeler"].prompt);
    expect(r).toMatchObject({ runId: "r1", ok: true, text: "xin chao", costUsd: 0.12, interrupted: false, rateLimited: false });
  });
  it("modeler continues its own session only when the option is on, chains at most 3, never for other roles", async () => {
    let n = 0;
    const startRun = vi.fn(async (_i: unknown) => ({ id: `r${++n}` }));
    const m: W3DStepManager = { startRun: startRun as W3DStepManager["startRun"], waitFor: async () => ({ status: "done", cost_usd_est: 0, result_text: "" }), cancel: () => true };
    let on = false;
    const { runStep } = createW3DRunStep(m, roles, { resumeModeler: () => on });
    const calls = () => startRun.mock.calls.map((c) => (c[0] as { resumeSessionOf?: string }).resumeSessionOf);
    await runStep("cad-modeler", "p", "/s");              // r1, option off
    await runStep("cad-modeler", "p", "/s");              // r2, option off -> fresh
    on = true;
    await runStep("cad-modeler", "p", "/s");              // r3 resumes r2
    await runStep("visual-reviewer", "p", "/s");          // r4, other role: fresh
    await runStep("cad-modeler", "p", "/s");              // r5 resumes r3
    await runStep("cad-modeler", "p", "/s");              // r6 resumes r5
    await runStep("cad-modeler", "p", "/s");              // r7: 3 continuations done (r3, r5, r6) -> fresh
    await runStep("cad-modeler", "p", "/s");              // r8 resumes r7
    expect(calls()).toEqual([undefined, undefined, "r2", undefined, "r3", "r5", undefined, "r7"]);
  });
  it("a failed modeler run ends the chain", async () => {
    let n = 0;
    const startRun = vi.fn(async (_i: unknown) => ({ id: `r${++n}` }));
    let status = "done";
    const m: W3DStepManager = { startRun: startRun as W3DStepManager["startRun"], waitFor: async () => ({ status, cost_usd_est: 0, result_text: "" }), cancel: () => true };
    const { runStep } = createW3DRunStep(m, roles, { resumeModeler: () => true });
    await runStep("cad-modeler", "p", "/s");
    status = "error";
    await runStep("cad-modeler", "p", "/s");              // resumes r1, fails
    status = "done";
    await runStep("cad-modeler", "p", "/s");              // fresh again
    expect(startRun.mock.calls.map((c) => (c[0] as { resumeSessionOf?: string }).resumeSessionOf)).toEqual([undefined, "r1", undefined]);
  });
  it("flags interrupted and rate limited", async () => {
    const a = await createW3DRunStep(fake({ status: "error", error: "subagent_interrupted" }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
    expect(a).toMatchObject({ ok: false, interrupted: true, rateLimited: false });
    const b = await createW3DRunStep(fake({ status: "error", error: "Usage limit reached" }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
    expect(b).toMatchObject({ ok: false, rateLimited: true, interrupted: false });
  });
  it("does not throw when startRun throws", async () => {
    const f = fake(null);
    f.startRun.mockRejectedValueOnce(new Error("boom"));
    const r = await createW3DRunStep(f.m, roles).runStep("tiep-nhan-3d", "p", "/s");
    expect(r).toMatchObject({ ok: false, error: "boom", costUsd: 0 });
  });
  it("cancelActive cancels the running run", async () => {
    let release!: (v: Done) => void;
    const f = fake(() => new Promise<Done>((res) => { release = res; }));
    const { runStep, cancelActive } = createW3DRunStep(f.m, roles);
    const p = runStep("tiep-nhan-3d", "p", "/s");
    await vi.waitFor(() => expect(f.waitFor).toHaveBeenCalled());
    cancelActive();
    expect(f.cancel).toHaveBeenCalledWith("r1");
    release({ status: "cancelled", error: "huy" });
    expect((await p).ok).toBe(false);
  });
  it("classifies real-looking subscription limit messages", async () => {
    for (const error of ["You've hit your limit · resets 3pm", "5-hour limit reached", "Rate limit exceeded", "Đã hết hạn mức", "quota exceeded"]) {
      const r = await createW3DRunStep(fake({ status: "error", error }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
      expect(r, error).toMatchObject({ rateLimited: true, interrupted: false });
    }
  });
  it("does not treat a bare 'quota' / 'hạn mức' in an error text as a subscription limit", async () => {
    for (const error of ["Lỗi khi đọc quota.json", "Script dùng biến quota_mm chưa khai báo", "Kiểm tra hạn mức ngân sách của vai", "hạn mức: chưa rõ"]) {
      const r = await createW3DRunStep(fake({ status: "error", error }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
      expect(r, error).toMatchObject({ rateLimited: false });
    }
    for (const error of ["Quota exceeded", "quota reached", "Hạn mức đã hết", "đã hết hạn mức thuê bao", "Usage limit reached for the 5-hour window"]) {
      const r = await createW3DRunStep(fake({ status: "error", error }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
      expect(r, error).toMatchObject({ rateLimited: true });
    }
  });
  it("classifies interrupted by anchored prefix, not by a mid-sentence word", async () => {
    for (const error of ["timeout: 600s", "subagent_interrupted", "Run bị cắt giữa chừng"]) {
      const r = await createW3DRunStep(fake({ status: "error", error }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
      expect(r, error).toMatchObject({ interrupted: true });
    }
    const n = await createW3DRunStep(fake({ status: "error", error: "Lỗi mạng: connection timeout while fetching" }).m, roles).runStep("tiep-nhan-3d", "p", "/s");
    expect(n.interrupted).toBe(false);
  });
  it("normalises a backslash/space session dir and omits maxBudgetUsd when unset", async () => {
    const f = fake({ status: "done", result_text: "x" });
    await createW3DRunStep(f.m, roles).runStep("cad-modeler", "P", "C:\\a b\\s\\");
    const arg = f.startRun.mock.calls[0]![0] as any;
    expect(arg.readOnly.allowedTools).toEqual(["Read(C:/a b/s/**)"]);
    expect("maxBudgetUsd" in arg).toBe(false);
  });
  it("marks cancelled, refuses new runs until resetCancel, and kills a run that starts after cancel", async () => {
    let release!: (v: Done) => void;
    const f = fake(() => new Promise<Done>((res) => { release = res; }));
    const { runStep, cancelActive, resetCancel } = createW3DRunStep(f.m, roles);
    const p = runStep("tiep-nhan-3d", "p", "/s");
    await vi.waitFor(() => expect(f.waitFor).toHaveBeenCalled());
    cancelActive();
    release({ status: "cancelled", error: "timeout" });
    expect(await p).toMatchObject({ ok: false, cancelled: true, interrupted: false });
    const refused = await runStep("tiep-nhan-3d", "p", "/s");
    expect(refused).toMatchObject({ ok: false, cancelled: true });
    expect(f.startRun).toHaveBeenCalledTimes(1);
    resetCancel();
    f.waitFor.mockResolvedValueOnce({ status: "done", result_text: "ok" } as any);
    expect(await runStep("tiep-nhan-3d", "p", "/s")).toMatchObject({ ok: true, cancelled: false });
  });
  it("cancel during startRun cancels the run as soon as it resolves", async () => {
    let resolveStart!: (v: { id: string }) => void;
    const f = fake({ status: "cancelled", error: "huy" });
    f.startRun.mockImplementationOnce(() => new Promise((res) => { resolveStart = res; }));
    const { runStep, cancelActive } = createW3DRunStep(f.m, roles);
    const p = runStep("tiep-nhan-3d", "p", "/s");
    await vi.waitFor(() => expect(f.startRun).toHaveBeenCalled());
    cancelActive();
    resolveStart({ id: "late" });
    expect(await p).toMatchObject({ cancelled: true });
    expect(f.cancel).toHaveBeenCalledWith("late");
  });
});
