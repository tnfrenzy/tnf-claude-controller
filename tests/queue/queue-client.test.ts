import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setToken } from "../../ui/src/api";

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>): [string, RequestInit] {
  return fn.mock.calls[0] as unknown as [string, RequestInit];
}

afterEach(() => vi.unstubAllGlobals());

const lock = { locked: false, reasons: [] };
const cmd = {
  id: "c1",
  project: "a b",
  batch: 1,
  position: 1,
  title: "T",
  body: "B",
  bodyOriginal: "B",
  dependsOn: [],
  files: ["src/x.ts"],
  references: [],
  warnings: [],
  source: "manual",
  sourceRef: "",
  status: "chờ duyệt",
  runId: null,
  branch: null,
  estCostUsd: 0.5,
  createdAt: 1,
  updatedAt: 1,
  approvedAt: null,
};

describe("queue api client", () => {
  it("queue() GETs the encoded project queue with the token header", async () => {
    setToken("tok123");
    const view = {
      commands: [{ ...cmd, wave: 1, waveReasons: [], estimatedCostUsd: 0.5, locks: { edit: lock, approveRun: lock, skip: lock } }],
      waveError: null,
      totalEstimatedCostUsd: 0.5,
      costNote: "ước tính",
      budget: { canOpenNew: true, reached: false, spentUsd: 0, maxBudgetUsd: 5, remainingUsd: 5, message: "" },
      maxParallel: 2,
      codingRunning: 0,
    };
    const fn = mockFetch(view);
    const r = await api.queue("a b");
    const [url, init] = lastCall(fn);
    expect(url).toBe("/api/projects/a%20b/queue");
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>)["x-controller-token"]).toBe("tok123");
    expect(r.commands[0]!.locks.approveRun.locked).toBe(false);
    expect(r.budget.canOpenNew).toBe(true);
    expect(r.totalEstimatedCostUsd).toBe(0.5);
  });

  it("queuePatch() PATCHes the encoded id with a JSON body and returns command + waveError", async () => {
    const resp = { command: { ...cmd, wave: 1, waveReasons: [], estimatedCostUsd: 0.5, locks: { edit: lock, approveRun: lock, skip: lock } }, waveError: null };
    const fn = mockFetch(resp);
    const r = await api.queuePatch("a b", "c/1", { title: "Mới", files: ["a.ts"] });
    const [url, init] = lastCall(fn);
    expect(url).toBe("/api/projects/a%20b/queue/c%2F1");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Mới", files: ["a.ts"] });
    expect(r).toEqual(resp);
  });

  it("queueApproveRun() POSTs approve-run and returns both started branches intact", async () => {
    const started = { started: true, run: { id: "r1" }, command: { ...cmd, status: "đang chạy" } };
    const fn = mockFetch(started);
    const r = await api.queueApproveRun("a b", "c1");
    const [url, init] = lastCall(fn);
    expect(url).toBe("/api/projects/a%20b/queue/c1/approve-run");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(r).toEqual(started);
    expect(r.started).toBe(true);

    const waiting = { started: false, command: { ...cmd, status: "đã duyệt" }, reasons: ["Chờ lệnh c0 được gộp"] };
    mockFetch(waiting);
    const r2 = await api.queueApproveRun("a b", "c1");
    expect(r2).toEqual(waiting);
    if (!r2.started) expect(r2.reasons).toEqual(["Chờ lệnh c0 được gộp"]);
    else throw new Error("expected started=false");
  });

  it("queueRunParallel() POSTs {ids} to run-parallel and returns started/rejected", async () => {
    const resp = { started: [{ id: "a", run: { id: "r1" } }], rejected: [{ id: "b", reasons: ["trùng file"] }] };
    const fn = mockFetch(resp);
    const r = await api.queueRunParallel("a b", ["a", "b"]);
    const [url, init] = lastCall(fn);
    expect(url).toBe("/api/projects/a%20b/queue/run-parallel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ids: ["a", "b"] });
    expect(r).toEqual(resp);
  });

  it("queueSkip() POSTs skip and returns the raw command", async () => {
    const resp = { command: { ...cmd, status: "bỏ qua" } };
    const fn = mockFetch(resp);
    const r = await api.queueSkip("a b", "c1");
    const [url, init] = lastCall(fn);
    expect(url).toBe("/api/projects/a%20b/queue/c1/skip");
    expect(init.method).toBe("POST");
    expect(r.command.status).toBe("bỏ qua");
  });

  it("recovery actions POST to their endpoints", async () => {
    const cases: [string, (p: string, i: string) => Promise<unknown>][] = [
      ["confirm-done", api.queueConfirmDone], ["confirm-merged", api.queueConfirmMerged],
      ["retry", api.queueRetry], ["mark-failed", api.queueMarkFailed], ["unskip", api.queueUnskip],
    ];
    for (const [action, fnc] of cases) {
      const fn = mockFetch({ command: cmd });
      await fnc("a b", "c1");
      const [url, init] = lastCall(fn);
      expect(url).toBe(`/api/projects/a%20b/queue/c1/${action}`);
      expect(init.method).toBe("POST");
    }
  });

  it("409 surfaces ApiError with status, code and the Vietnamese server message", async () => {
    mockFetch({ error: "already_ran", message: "Lệnh đã chạy, hãy chạy lại để sửa." }, 409);
    const err = await api.queuePatch("p", "c1", { title: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(409);
    expect(e.code).toBe("already_ran");
    expect(e.message).toBe("Lệnh đã chạy, hãy chạy lại để sửa.");

    mockFetch({ error: "bad_transition", message: "Không thể chuyển trạng thái." }, 409);
    const e2 = (await api.queueSkip("p", "c1").catch((x: unknown) => x)) as ApiError;
    expect(e2.status).toBe(409);
    expect(e2.code).toBe("bad_transition");
    expect(e2.message).toBe("Không thể chuyển trạng thái.");
  });

  it("400 and 404 keep their status, code and message", async () => {
    mockFetch({ error: "no_repo", message: "Môi trường chưa gắn repo." }, 400);
    const e1 = (await api.queue("default").catch((x: unknown) => x)) as ApiError;
    expect(e1).toBeInstanceOf(ApiError);
    expect([e1.status, e1.code, e1.message]).toEqual([400, "no_repo", "Môi trường chưa gắn repo."]);

    mockFetch({ error: "not_found", message: "Không tìm thấy lệnh." }, 404);
    const e2 = (await api.queueApproveRun("p", "zz").catch((x: unknown) => x)) as ApiError;
    expect([e2.status, e2.code, e2.message]).toEqual([404, "not_found", "Không tìm thấy lệnh."]);
  });

  it("a network failure rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api.queue("p")).rejects.toBeDefined();
  });
});
