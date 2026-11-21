import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../ui/src/api";

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function callOf(fn: ReturnType<typeof mockFetch>): [string, RequestInit] {
  return fn.mock.calls[0] as unknown as [string, RequestInit];
}

const view = { enabled: true, schedule: null, webhookCount: 0, webhooks: [], updatedAt: "2026-10-30T00:00:00Z" };

afterEach(() => vi.unstubAllGlobals());

describe("autopilot api client", () => {
  it("autopilotStatus() GETs status", async () => {
    const fn = mockFetch(view);
    const r = await api.autopilotStatus();
    expect(r).toEqual(view);
    const c = callOf(fn);
    expect(c[0]).toBe("/api/autopilot/status");
    expect(c[1].method).toBeUndefined();
  });

  it("autopilotEnable() and autopilotDisable() POST without body", async () => {
    const fn = mockFetch(view);
    await api.autopilotEnable();
    expect(callOf(fn)[0]).toBe("/api/autopilot/enable");
    expect(callOf(fn)[1].method).toBe("POST");
    expect(callOf(fn)[1].body).toBeUndefined();
    const fn2 = mockFetch({ ...view, enabled: false });
    const r = await api.autopilotDisable();
    expect(r.enabled).toBe(false);
    expect(callOf(fn2)[0]).toBe("/api/autopilot/disable");
    expect(callOf(fn2)[1].method).toBe("POST");
    expect(callOf(fn2)[1].body).toBeUndefined();
  });

  it("autopilotSetSchedule() PUTs schedule, null stays null", async () => {
    const fn = mockFetch(view);
    await api.autopilotSetSchedule("0 9 * * *");
    expect(callOf(fn)[0]).toBe("/api/autopilot/schedule");
    expect(callOf(fn)[1].method).toBe("PUT");
    expect(JSON.parse(String(callOf(fn)[1].body))).toEqual({ schedule: "0 9 * * *" });
    const fn2 = mockFetch(view);
    await api.autopilotSetSchedule(null);
    expect(String(callOf(fn2)[1].body)).toBe('{"schedule":null}');
  });

  it("autopilotSetWebhooks() PUTs webhooks", async () => {
    const fn = mockFetch(view);
    await api.autopilotSetWebhooks(["https://example.com/h"]);
    expect(callOf(fn)[0]).toBe("/api/autopilot/webhooks");
    expect(callOf(fn)[1].method).toBe("PUT");
    expect(JSON.parse(String(callOf(fn)[1].body))).toEqual({ webhooks: ["https://example.com/h"] });
  });

  it("autopilotSummary() builds query with from/to", async () => {
    const summary = { from: "a", to: "b", counts: { done: 1, error: 0, other: 0, total: 1 }, costUsd: 0.1, blocked: [], text: "t", truncated: false, estimate: true };
    const fn = mockFetch(summary);
    const r = await api.autopilotSummary("2026-10-01", "2026-10-30");
    expect(r).toEqual(summary);
    expect(callOf(fn)[0]).toBe("/api/autopilot/summary?from=2026-10-01&to=2026-10-30");
    expect(callOf(fn)[1].method).toBeUndefined();
  });

  it("autopilotSummary() without params has no query string", async () => {
    const fn = mockFetch({});
    await api.autopilotSummary();
    expect(callOf(fn)[0]).toBe("/api/autopilot/summary");
    const fn2 = mockFetch({});
    await api.autopilotSummary("", "2026-10-30");
    expect(callOf(fn2)[0]).toBe("/api/autopilot/summary?to=2026-10-30");
  });

  it("autopilotCheckDuplicate() POSTs input JSON", async () => {
    const res = { duplicates: [{ id: "q1", title: "t", score: 0.9, tokenScore: 0.8, fileScore: 1, level: "high" }], hasHigh: true };
    const fn = mockFetch(res);
    const input = { project: "p", title: "t", prompt: "x", files: ["a.ts"] };
    const r = await api.autopilotCheckDuplicate(input);
    expect(r).toEqual(res);
    expect(callOf(fn)[0]).toBe("/api/autopilot/check-duplicate");
    expect(callOf(fn)[1].method).toBe("POST");
    expect(JSON.parse(String(callOf(fn)[1].body))).toEqual(input);
  });

  it("HTTP error throws ApiError with status and code", async () => {
    mockFetch({ error: "bad_request", message: "xấu" }, 400);
    const err = await api.autopilotStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).code).toBe("bad_request");
    expect((err as ApiError).message).toBe("xấu");
  });
});
