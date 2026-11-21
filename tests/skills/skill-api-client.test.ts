import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../ui/src/api";

function mockFetch(body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("skills api client", () => {
  it("skills() GETs /api/skills", async () => {
    const fn = mockFetch({ skills: [] });
    const r = await api.skills();
    expect(r.skills).toEqual([]);
    const call = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/skills");
    expect(call[1].method).toBeUndefined();
  });

  it("createSkill() POSTs JSON body", async () => {
    const fn = mockFetch({ meta: { slug: "a" }, files: {} });
    await api.createSkill({ title: "A", goal: "g", files: { "SKILL.md": "x" } });
    const call = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/skills");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(String(call[1].body))).toEqual({ title: "A", goal: "g", files: { "SKILL.md": "x" } });
  });

  it("startSkill() POSTs to /api/skills/:slug/start", async () => {
    const fn = mockFetch({});
    await api.startSkill("my skill", { passScore: 90, maxRounds: 5 });
    const call = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/skills/my%20skill/start");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(String(call[1].body))).toEqual({ passScore: 90, maxRounds: 5 });
  });

  it("deleteSkill() DELETEs /api/skills/:slug with encoded slug", async () => {
    const fn = mockFetch({ ok: true });
    const r = await api.deleteSkill("a b/c");
    expect(r).toEqual({ ok: true });
    const call = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0].endsWith("/api/skills/a%20b%2Fc")).toBe(true);
    expect(call[1].method).toBe("DELETE");
  });
});
