import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setToken } from "../../ui/src/api";

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>): [string, RequestInit] {
  return fn.mock.calls[0] as unknown as [string, RequestInit];
}

afterEach(() => vi.unstubAllGlobals());

const resume = {
  run_id: "r1",
  project: "p",
  kind: "run",
  scope: null,
  resume_at: 1000,
  attempt: 1,
  status: "pending",
  reason: null,
  created_at: 1,
  updated_at: 1,
};

describe("quota resume api client", () => {
  it("getQuotaResume GETs the quota-resume route", async () => {
    setToken("tok");
    const fn = mockFetch({ resume, max_attempts: 3 });
    const res = await api.getQuotaResume("r1");
    const [url, init] = lastCall(fn);
    expect(url.endsWith("/api/runs/r1/quota-resume")).toBe(true);
    expect([undefined, "GET"]).toContain(init?.method);
    expect(res).toEqual({ resume, max_attempts: 3 });
  });

  it("getQuotaResume returns resume null", async () => {
    mockFetch({ resume: null, max_attempts: 3 });
    const res = await api.getQuotaResume("r1");
    expect(res.resume).toBeNull();
    expect(res.max_attempts).toBe(3);
  });

  it("cancelQuotaResume POSTs the cancel route", async () => {
    const fn = mockFetch({ ok: true });
    const res = await api.cancelQuotaResume("r1");
    const [url, init] = lastCall(fn);
    expect(url.endsWith("/api/runs/r1/quota-resume/cancel")).toBe(true);
    expect(init.method).toBe("POST");
    expect(res).toEqual({ ok: true });
  });

  it("encodes the run id in both calls", async () => {
    const fn1 = mockFetch({ resume: null, max_attempts: 3 });
    await api.getQuotaResume("a/b c");
    expect(lastCall(fn1)[0].endsWith("/api/runs/a%2Fb%20c/quota-resume")).toBe(true);
    const fn2 = mockFetch({ ok: true });
    await api.cancelQuotaResume("a/b c");
    expect(lastCall(fn2)[0].endsWith("/api/runs/a%2Fb%20c/quota-resume/cancel")).toBe(true);
  });

  it("rejects cancelQuotaResume on 409 not_pending", async () => {
    mockFetch({ error: "not_pending" }, 409);
    await expect(api.cancelQuotaResume("r1")).rejects.toBeDefined();
  });
});
