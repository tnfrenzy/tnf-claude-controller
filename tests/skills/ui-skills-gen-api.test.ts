import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../ui/src/api";

function mockFetch(body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

type Call = [string, RequestInit];

afterEach(() => vi.unstubAllGlobals());

describe("skills-gen api client", () => {
  it("skillsGenStart() POSTs the body to /api/skills-gen/sessions", async () => {
    const fn = mockFetch({ version: 1 });
    await api.skillsGenStart({ slug: "demo", brief: "b", maxRounds: 3 });
    const call = fn.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("/api/skills-gen/sessions");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(String(call[1].body))).toEqual({ slug: "demo", brief: "b", maxRounds: 3 });
  });

  it("skillsGenGrade() POSTs score and feedback to .../grade", async () => {
    const fn = mockFetch({ version: 1 });
    await api.skillsGenGrade("demo", { score: 80, feedback: "ok" });
    const call = fn.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("/api/skills-gen/sessions/demo/grade");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(String(call[1].body))).toEqual({ score: 80, feedback: "ok" });
  });

  it("skillsGenFindRoles() POSTs without body to the find-roles step", async () => {
    const fn = mockFetch({ matches: [] });
    const r = await api.skillsGenFindRoles("demo");
    expect(r.matches).toEqual([]);
    const call = fn.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("/api/skills-gen/sessions/demo/steps/find-roles");
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toBeUndefined();
  });

  it("downloadSkillsGenMd() requests the /md route", async () => {
    const fn = mockFetch("# x");
    await api.downloadSkillsGenMd("demo").catch(() => undefined);
    const call = fn.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("/api/skills-gen/sessions/demo/md");
  });

  it("encodes special characters in the slug", async () => {
    const fn = mockFetch({ session: {}, gen: {} });
    await api.skillsGenGet("a b/c");
    const call = fn.mock.calls[0] as unknown as Call;
    expect(call[0]).toBe("/api/skills-gen/sessions/a%20b%2Fc");
    expect(call[1].method).toBeUndefined();
  });
});
