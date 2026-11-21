import { afterEach, describe, expect, it, vi } from "vitest";
import { api, skillZipPath } from "../../ui/src/api";

function mockFetch(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("skill training api", () => {
  it("trainSkill posts config body to encoded slug", async () => {
    const f = mockFetch(200, { ok: true });
    await api.trainSkill("a b", { passScore: 90, maxRounds: 3, costCapUsd: 2 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/skills/a%20b/train");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ passScore: 90, maxRounds: 3, costCapUsd: 2 });
  });

  it("resume, pause, stop, approve, restore-best use POST on the right path", async () => {
    const f = mockFetch(200, { ok: true });
    await api.resumeSkill("s1");
    await api.pauseSkill("s1");
    await api.stopSkill("s1");
    await api.approveSkill("s1");
    await api.restoreBestSkill("s1");
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual([
      "/api/skills/s1/resume",
      "/api/skills/s1/pause",
      "/api/skills/s1/stop",
      "/api/skills/s1/approve",
      "/api/skills/s1/restore-best"
    ]);
    expect(calls.every((c) => c[1].method === "POST")).toBe(true);
  });

  it("rethrows server message on error", async () => {
    mockFetch(409, { error: "already_running", message: "Đang huấn luyện" });
    await expect(api.restoreBestSkill("s1")).rejects.toThrow("Đang huấn luyện");
  });

  it("zip path is correct", () => {
    expect(skillZipPath("x y")).toBe("/api/skills/x%20y/zip");
  });
});
