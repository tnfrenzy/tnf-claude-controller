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

function hdr(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

afterEach(() => vi.unstubAllGlobals());

describe("videostudio api client", () => {
  it("videoStudioList GETs /api/videostudio with token", async () => {
    setToken("tok123");
    const f = mockFetch({ projects: [] });
    expect(await api.videoStudioList()).toEqual({ projects: [] });
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio");
    expect(init.method).toBeUndefined();
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });

  it("videoStudioCreate POSTs the JSON input", async () => {
    setToken("tok123");
    const f = mockFetch({ slug: "s" });
    const input = { title: "T", brief: "B", styleId: "x", aspect: "16:9" as const };
    await api.videoStudioCreate(input);
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(hdr(init)["content-type"]).toBe("application/json");
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });

  it("videoStudioGet and videoStudioDelete encode the slug", async () => {
    setToken("tok123");
    let f = mockFetch({});
    await api.videoStudioGet("a b");
    expect(lastCall(f)[0]).toBe("/api/videostudio/a%20b");
    f = mockFetch({ ok: true });
    await api.videoStudioDelete("a b");
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/a%20b");
    expect(init.method).toBe("DELETE");
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });

  it("videoStudioFile fetches a Blob from the file route with the token", async () => {
    setToken("tok123");
    const f = vi.fn(async () => new Response(new Blob(["abc"])));
    vi.stubGlobal("fetch", f);
    const b = await api.videoStudioFile("a b", "x/y.mp4");
    expect(await b.text()).toBe("abc");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/videostudio/a%20b/file?path=x%2Fy.mp4");
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });

  it("videoStudioDownload fetches with the token and triggers a download", async () => {
    setToken("tok123");
    const f = vi.fn(async () => new Response(new Blob(["abc"])));
    vi.stubGlobal("fetch", f);
    const a = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const doc = { createElement: vi.fn(() => a), body: { appendChild: vi.fn(), removeChild: vi.fn() } };
    vi.stubGlobal("document", doc);
    const create = vi.fn(() => "blob:u");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(function () {}, { createObjectURL: create, revokeObjectURL: revoke }));
    await api.videoStudioDownload("a b", "x/y.mp4", "out.mp4");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/videostudio/a%20b/file?path=x%2Fy.mp4");
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
    expect(doc.createElement).toHaveBeenCalledWith("a");
    expect(a.download).toBe("out.mp4");
    expect(a.click).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it("videoStudioUpload sends the File as binary with encoded name and token", async () => {
    setToken("tok123");
    const f = mockFetch({ rel: "assets/v.mp4" });
    const file = new File(["data"], "tên video.mp4");
    expect(await api.videoStudioUpload("a b", file)).toEqual({ rel: "assets/v.mp4" });
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/a%20b/assets");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(file);
    expect(hdr(init)["content-type"]).toBe("application/octet-stream");
    expect(hdr(init)["x-file-name"]).toBe(encodeURIComponent("tên video.mp4"));
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });

  it("videoStudioUpload throws ApiError on a JSON error", async () => {
    setToken("tok123");
    mockFetch({ message: "xấu", error: "bad" }, 400);
    const err = await api.videoStudioUpload("s", new File(["d"], "a.mp4")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("xấu");
  });

  it("videoStudioSavePlan PUTs { plan }", async () => {
    setToken("tok123");
    const f = mockFetch({ plan: {} });
    const plan = { a: 1 } as never;
    await api.videoStudioSavePlan("a b", plan);
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/a%20b/plan");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ plan });
  });

  it.each([
    ["videoStudioGeneratePlan", "generate"],
    ["videoStudioNarrate", "narrate"],
    ["videoStudioRender", "render"],
  ] as const)("%s POSTs {} to /%s", async (fn, seg) => {
    setToken("tok123");
    const f = mockFetch({ ok: true });
    await api[fn]("a b");
    const [url, init] = lastCall(f);
    expect(url).toBe(`/api/videostudio/a%20b/${seg}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(hdr(init)["content-type"]).toBe("application/json");
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });

  it("videoStudioEditSegment POSTs the input", async () => {
    setToken("tok123");
    const f = mockFetch({ ok: true });
    await api.videoStudioEditSegment("a b", { start: 1, end: 2.5, instruction: "đổi" });
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/a%20b/edit-segment");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ start: 1, end: 2.5, instruction: "đổi" });
  });

  it("styles: list, save, delete", async () => {
    setToken("tok123");
    let f = mockFetch({ styles: [] });
    await api.videoStudioStyles();
    expect(lastCall(f)[0]).toBe("/api/videostudio/styles");
    f = mockFetch({ style: {} });
    const style = { id: "s1" } as never;
    await api.videoStudioSaveStyle(style);
    let [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/styles");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(style);
    f = mockFetch({ ok: true });
    await api.videoStudioDeleteStyle("a b");
    [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/styles/a%20b");
    expect(init.method).toBe("DELETE");
  });

  it("settings: get and put", async () => {
    setToken("tok123");
    let f = mockFetch({ settings: {} });
    await api.videoStudioSettings();
    expect(lastCall(f)[0]).toBe("/api/videostudio/settings");
    f = mockFetch({ settings: {} });
    const input = { ffmpegPath: "x" } as never;
    await api.videoStudioSettingsPut(input);
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/videostudio/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(hdr(init)["x-controller-token"]).toBe("tok123");
  });
});

describe("videostudio api client: response shapes of the server", () => {
  it("videoStudioStyles accepts the server's bare array, the wrapped form and garbage", async () => {
    setToken("tok123");
    mockFetch([{ id: "a" }, { id: "b" }]);
    expect((await api.videoStudioStyles()).styles.map((s) => s.id)).toEqual(["a", "b"]);
    mockFetch({ styles: [{ id: "c" }] });
    expect((await api.videoStudioStyles()).styles.map((s) => s.id)).toEqual(["c"]);
    mockFetch({ nope: true });
    expect((await api.videoStudioStyles()).styles).toEqual([]);
  });

  it("videoStudioSettings and videoStudioSettingsPut wrap the server's bare object", async () => {
    setToken("tok123");
    mockFetch({ ffmpegFound: true });
    expect((await api.videoStudioSettings()).settings.ffmpegFound).toBe(true);
    mockFetch({ ffmpegFound: false });
    expect((await api.videoStudioSettingsPut({} as never)).settings.ffmpegFound).toBe(false);
  });

  it("videoStudioGet turns the flat server answer into { project, plan, assets }", async () => {
    setToken("tok123");
    mockFetch({ slug: "p1", title: "T", state: "draft", plan: null, assets: [{ rel: "assets/a.png" }] });
    const d = await api.videoStudioGet("p1");
    expect(d.project).toMatchObject({ slug: "p1", title: "T", state: "draft" });
    expect("plan" in d.project).toBe(false);
    expect(d.plan).toBeNull();
    expect(d.assets).toHaveLength(1);
    mockFetch({ slug: "p2" });
    const e = await api.videoStudioGet("p2");
    expect(e.plan).toBeNull();
    expect(e.assets).toEqual([]);
  });

  it("videoStudioCreate returns { slug } from the created project; videoStudioSavePlan wraps the saved plan", async () => {
    setToken("tok123");
    mockFetch({ slug: "new-1", title: "x" }, 201);
    expect(await api.videoStudioCreate({ title: "x", brief: "", styleId: "a", aspect: "16:9" })).toEqual({ slug: "new-1" });
    mockFetch({ video: [] });
    expect(await api.videoStudioSavePlan("p", { video: [] } as never)).toEqual({ plan: { video: [] } });
  });
});
