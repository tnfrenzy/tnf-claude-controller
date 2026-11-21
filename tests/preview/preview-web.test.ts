import path from "node:path";
import { describe, expect, it } from "vitest";
import { captureWeb, edgeScreenshotArgs, waitReady, type WebDeps } from "../../src/core/preview/preview-web.js";

const cfg = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/login"], readyTimeoutSec: 5 } as const;

function deps(over: Partial<WebDeps> = {}): { d: WebDeps; calls: string[]; killed: number[]; shots: string[] } {
  const calls: string[] = [], killed: number[] = [], shots: string[] = [];
  let spawned = false;
  const d: WebDeps = {
    browserPath: "C:\\edge.exe",
    spawnServer: (cmd, args, o) => { spawned = true; calls.push(`spawn ${cmd} ${args.join(" ")} @${o.cwd}`); return { pid: 77, onExit: () => undefined, log: () => ["vite ready"] }; },
    killTree: (pid) => { killed.push(pid); },
    probe: async () => (spawned ? 200 : null),
    runBrowser: async (_e, args) => { const f = args.find((a) => a.startsWith("--screenshot="))!.slice(13); shots.push(path.basename(f)); return { code: 0, timedOut: false }; },
    sleep: async () => undefined,
    fileOk: () => true,
    tmpProfile: () => "C:\\tmp\\p",
    rmDir: () => undefined,
    ...over,
  };
  return { d, calls, killed, shots };
}

describe("edgeScreenshotArgs", () => {
  it("builds headless args", () => {
    const a = edgeScreenshotArgs("C:\\p", 375, 812, "C:\\o\\x.png", "http://localhost:5173/");
    expect(a).toContain("--headless");
    expect(a).toContain("--window-size=375,812");
    expect(a).toContain("--screenshot=C:\\o\\x.png");
    expect(a).toContain("--user-data-dir=C:\\p");
    expect(a[a.length - 1]).toBe("http://localhost:5173/");
  });
});

describe("waitReady", () => {
  it("true when probe answers < 500", async () => {
    expect(await waitReady("http://x", 1000, { probe: async () => 404, sleep: async () => undefined }, () => false)).toBe(true);
  });
  it("false on server error / unreachable until timeout", async () => {
    let t = 0;
    const sleep = async (ms: number) => { t += ms; };
    expect(await waitReady("http://x", 2000, { probe: async () => (t > 5000 ? 200 : null), sleep }, () => false)).toBe(false);
  });
  it("false at once when the server already exited", async () => {
    expect(await waitReady("http://x", 60000, { probe: async () => null, sleep: async () => undefined }, () => true)).toBe(false);
  });
});

describe("captureWeb", () => {
  it("captures every page at both widths and kills the server", async () => {
    const { d, calls, killed, shots } = deps();
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toBeNull();
    expect(shots).toEqual(["home-375.png", "home-1280.png", "login-375.png", "login-1280.png"]);
    expect(r.shots.every((s) => s.ok)).toBe(true);
    expect(calls[0]).toBe("spawn npm run dev @D:\\wt");
    expect(killed).toEqual([77]);
  });
  it("reports a clear error and kills the server when it never gets ready", async () => {
    const { d, killed } = deps({ probe: async () => null });
    const r = await captureWeb({ ...cfg, readyTimeoutSec: 5 }, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toMatch(/máy chủ/i);
    expect(r.logTail).toEqual(["vite ready"]);
    expect(r.shots).toEqual([]);
    expect(killed).toEqual([77]);
  });
  it("marks a shot not ok when the browser times out or leaves no file", async () => {
    const { d } = deps({ runBrowser: async () => ({ code: null, timedOut: true }), fileOk: () => false });
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.shots.every((s) => !s.ok)).toBe(true);
  });
  it("refuses when another server already answers at the url, without spawning or shooting", async () => {
    const { d, calls, shots } = deps({ probe: async () => 404 });
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toBe("Đã có máy chủ khác đang chạy ở http://localhost:5173; hãy tắt nó trước khi chụp.");
    expect(r.shots).toEqual([]);
    expect(calls).toEqual([]);
    expect(shots).toEqual([]);
  });
  it("gives the dev server an env without API billing variables, plus BROWSER and PORT", async () => {
    const saved = { k: process.env["ANTHROPIC_API_KEY"], t: process.env["ANTHROPIC_AUTH_TOKEN"] };
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    process.env["ANTHROPIC_AUTH_TOKEN"] = "tok-test";
    try {
      let seen: NodeJS.ProcessEnv | null = null;
      const { d } = deps({ spawnServer: (_c, _a, o) => { seen = o.env; return { pid: 77, onExit: () => undefined, log: () => [] }; } });
      // probe: null before spawn (so it is allowed), 200 after.
      let spawned = false;
      const d2: WebDeps = { ...d, spawnServer: (c, a, o) => { spawned = true; return d.spawnServer(c, a, o); }, probe: async () => (spawned ? 200 : null) };
      await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d2);
      expect(seen).not.toBeNull();
      const env = seen as unknown as NodeJS.ProcessEnv;
      expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain("ANTHROPIC_API_KEY");
      expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain("ANTHROPIC_AUTH_TOKEN");
      expect(env["BROWSER"]).toBe("none");
      expect(env["PORT"]).toBe("5173");
    } finally {
      if (saved.k === undefined) delete process.env["ANTHROPIC_API_KEY"]; else process.env["ANTHROPIC_API_KEY"] = saved.k;
      if (saved.t === undefined) delete process.env["ANTHROPIC_AUTH_TOKEN"]; else process.env["ANTHROPIC_AUTH_TOKEN"] = saved.t;
    }
  });
  it("errors without a browser, before starting the server", async () => {
    const { d, calls } = deps({ browserPath: null });
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toMatch(/Edge|Chrome/);
    expect(calls).toEqual([]);
  });
});
