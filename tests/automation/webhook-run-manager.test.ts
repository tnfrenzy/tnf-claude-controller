import { describe, expect, it, vi } from "vitest";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

const U = "https://hooks.example.com/x";
const usage = { input: 1, output: 1, cache_read: 0, cache_write: 0 };

function setup(fetchImpl: any, webhooks: string[] = [U]) {
  const store = new RunStore(":memory:");
  const config: any = { automation: { enabled: false, maxRetries: 0, schedule: null, webhooks } };
  const mgr = new RunManager({ config, store, webhookFetch: fetchImpl });
  store.createRun({ id: "r1", status: "running", prompt: "do it token=abc123456", mode: "single", model: null, session_id: null, parent_run_id: null, project: "p", claude_version: null, run_dir: "x" });
  const fire = (ev: any) => (mgr as any).onEvent("r1", {}, ev, null);
  return { store, fire, mgr };
}

describe("RunManager webhook wiring", () => {
  it("notifies run.done on run.result ok", async () => {
    const f = vi.fn(async () => ({}) as any);
    const { store, fire } = setup(f);
    fire({ type: "run.result", ok: true, text: "SECRETRESULT", cost_usd_est: 0, usage, num_turns: 1, duration_ms: 7 });
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(1);
    const body = (f.mock.calls[0] as any)[1].body as string;
    expect(JSON.parse(body)).toMatchObject({ event: "run.done", run_id: "r1", project: "p", duration_ms: 7 });
    expect(body).not.toContain("abc123456");
    expect(body).not.toContain("SECRETRESULT");
    store.close();
  });

  it("notifies run.error with kind only", async () => {
    const f = vi.fn(async () => ({}) as any);
    const { store, fire } = setup(f);
    fire({ type: "run.error", kind: "timeout", message: "detail C:\\path" });
    await new Promise((r) => setTimeout(r, 20));
    const body = (f.mock.calls[0] as any)[1].body as string;
    expect(JSON.parse(body)).toMatchObject({ event: "run.error", error_kind: "timeout" });
    expect(body).not.toContain("detail");
    store.close();
  });

  it("keeps run status when fetch always rejects", async () => {
    const f = vi.fn(async () => { throw new Error("down"); });
    const { store, fire } = setup(f);
    fire({ type: "run.result", ok: true, text: "t", cost_usd_est: 0, usage, num_turns: 1, duration_ms: 7 });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getRun("r1")!.status).toBe("done");
    store.close();
  });

  it("does nothing with an empty webhook list", async () => {
    const f = vi.fn(async () => ({}) as any);
    const { store, fire } = setup(f, []);
    fire({ type: "run.result", ok: true, text: "t", cost_usd_est: 0, usage, num_turns: 1, duration_ms: 7 });
    await new Promise((r) => setTimeout(r, 20));
    expect(f).not.toHaveBeenCalled();
    store.close();
  });

  it("applies a changed webhook list immediately even after the notifier was cached", async () => {
    const f = vi.fn(async () => ({}) as any);
    const { store, fire, mgr } = setup(f);
    fire({ type: "run.result", ok: true, text: "t", cost_usd_est: 0, usage, num_turns: 1, duration_ms: 7 });
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any)[0]).toBe(U);

    mgr.setWebhooks(["https://new.example.com/y"]);
    store.createRun({ id: "r2", status: "running", prompt: "again", mode: "single", model: null, session_id: null, parent_run_id: null, project: "p", claude_version: null, run_dir: "x" });
    (mgr as any).onEvent("r2", {}, { type: "run.result", ok: true, text: "t", cost_usd_est: 0, usage, num_turns: 1, duration_ms: 7 }, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[1] as any)[0]).toBe("https://new.example.com/y");
    store.close();
  });

  it("stops sending after the list is cleared via the manager", async () => {
    const f = vi.fn(async () => ({}) as any);
    const { store, fire, mgr } = setup(f);
    mgr.setWebhooks([]);
    fire({ type: "run.result", ok: true, text: "t", cost_usd_est: 0, usage, num_turns: 1, duration_ms: 7 });
    await new Promise((r) => setTimeout(r, 20));
    expect(f).not.toHaveBeenCalled();
    store.close();
  });
});
