import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setToken } from "../../ui/src/api";

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const preview = {
  kind: "role",
  id: "x",
  name: "X",
  description: "d",
  prompt: "p",
  tools: ["Read"],
  droppedTools: [],
  dangerKeywords: [],
  warnings: [],
  license: null,
  licenseOk: null,
  blocked: null,
};

describe("api.importLibraryMd", () => {
  it("POSTs the JSON body to /api/library/import with token and JSON headers", async () => {
    setToken("tok123");
    const fn = mockFetch({ preview });
    const body = { text: "x", dryRun: true };
    await api.importLibraryMd(body);
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/api/library/import")).toBe(true);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-controller-token"]).toBe("tok123");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("returns the parsed response untouched", async () => {
    setToken("tok123");
    const role = { id: "x", name: "X" };
    mockFetch({ preview, role }, 201);
    const res = await api.importLibraryMd({ text: "y", as: "role", id: "x", filename: "x.md" });
    expect(res).toEqual({ preview, role });
  });
});
