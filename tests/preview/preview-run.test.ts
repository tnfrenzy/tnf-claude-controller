import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServerSpawn, previewChildEnv, runPreview, type PreviewDeps } from "../../src/core/preview/preview.js";
import type { DesktopDeps } from "../../src/core/preview/preview-desktop.js";
import type { WebDeps } from "../../src/core/preview/preview-web.js";

const webCfg = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/login"], readyTimeoutSec: 5 } as const;
const deskCfg = { kind: "desktop", exePath: "C:\\a\\app.exe", args: ["--x"], windowTitle: "My App", settleSec: 3 } as const;
const ctx = { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined };

function webDeps(over: Partial<WebDeps> = {}): WebDeps {
  let spawned = false;
  return {
    browserPath: "C:\\edge.exe",
    spawnServer: () => (spawned = true, { pid: 77, onExit: () => undefined, log: () => ["vite ready"] }),
    killTree: () => undefined,
    probe: async () => (spawned ? 200 : null),
    runBrowser: async () => ({ code: 0, timedOut: false }),
    sleep: async () => undefined,
    fileOk: () => true,
    tmpProfile: () => "C:\\tmp\\p",
    rmDir: () => undefined,
    ...over,
  };
}

function desktopDeps(over: Partial<DesktopDeps> = {}): DesktopDeps {
  return {
    helperExe: async () => "C:\\d\\preview-capture.exe",
    spawnApp: () => ({ pid: 55, onExit: () => undefined, log: () => [] }),
    killTree: () => undefined,
    closeApp: async () => undefined,
    runHelper: async () => ({ code: 0, stderr: "", timedOut: false }),
    sleep: async () => undefined,
    fileOk: () => true,
    ...over,
  };
}

function deps(w: Partial<WebDeps> = {}, d: Partial<DesktopDeps> = {}): PreviewDeps {
  return { web: webDeps(w), desktop: desktopDeps(d) };
}

describe("runPreview", () => {
  it("web ok -> status ok, timestamps from now()", async () => {
    let t = 1000;
    const now = () => (t += 10);
    const j = await runPreview(webCfg, ctx, deps(), now);
    expect(j).toMatchObject({ kind: "web", status: "ok", error: null });
    expect(j.started_at).toBe(1010);
    expect(j.finished_at).toBeGreaterThan(j.started_at);
    expect(j.shots).toHaveLength(4);
  });

  it("partial when some shots failed", async () => {
    const j = await runPreview(webCfg, ctx, deps({ fileOk: (f: string) => path.basename(f) !== "login-375.png" }));
    expect(j.status).toBe("partial");
    expect(j.shots.filter((s) => s.ok)).toHaveLength(3);
    expect(j.error).toBeNull();
  });

  it("error when the capture reports an error", async () => {
    const j = await runPreview(webCfg, ctx, deps({ probe: async () => null }));
    expect(j.status).toBe("error");
    expect(j.error).toMatch(/máy chủ/i);
    expect(j.log_tail).toEqual(["vite ready"]);
  });

  it("error when no shot succeeded and no error was reported", async () => {
    const j = await runPreview(webCfg, ctx, deps({ fileOk: () => false }));
    expect(j.status).toBe("error");
    expect(j.error).toBe("Không chụp được ảnh nào.");
  });

  it("desktop ok", async () => {
    const j = await runPreview(deskCfg, ctx, deps());
    expect(j).toMatchObject({ kind: "desktop", status: "ok", error: null, log_tail: [] });
    expect(j.shots[0]?.file).toBe("window.png");
  });

  it("kind none throws", async () => {
    await expect(runPreview({ kind: "none" }, ctx, deps())).rejects.toThrow();
  });

  it("converts a thrown web exception into status error with the message", async () => {
    const j = await runPreview(webCfg, ctx, deps({ spawnServer: () => { throw new Error("spawn npm ENOENT"); } }));
    expect(j.status).toBe("error");
    expect(j.error).toMatch(/ENOENT/);
    expect(j.error).toMatch(/Không/);
    expect(j.shots).toEqual([]);
  });

  it("converts a thrown desktop exception into status error with the message", async () => {
    const j = await runPreview(deskCfg, ctx, deps({}, { spawnApp: () => { throw new Error("spawn C:\\a\\app.exe ENOENT"); } }));
    expect(j.kind).toBe("desktop");
    expect(j.status).toBe("error");
    expect(j.error).toMatch(/app\.exe ENOENT/);
  });
});

describe("buildServerSpawn", () => {
  it("wraps npm-like shims (also .cmd) in cmd.exe with separate args", () => {
    expect(buildServerSpawn("npm", ["run", "dev"])).toEqual({ exe: "cmd.exe", args: ["/d", "/s", "/c", "npm", "run", "dev"] });
    expect(buildServerSpawn("npm.cmd", ["run", "dev"]).exe).toBe("cmd.exe");
    expect(buildServerSpawn("YARN", ["dev"]).exe).toBe("cmd.exe");
  });
  it("rejects shell metacharacters before going through cmd.exe", () => {
    expect(() => buildServerSpawn("npm", ["run", "dev", "&", "calc"])).toThrow(/ký tự điều khiển/);
    expect(() => buildServerSpawn("npx.cmd", ["x|y"])).toThrow(/ký tự điều khiển/);
    expect(() => buildServerSpawn("npm", ["%PATH%"])).toThrow(/ký tự điều khiển/);
  });
  it("spawns other programs directly", () => {
    expect(buildServerSpawn("node", ["server.js"])).toEqual({ exe: "node", args: ["server.js"] });
    const exe = String.raw`C:\Program Files (x86)\app\x.exe`;
    expect(buildServerSpawn(exe, ["--a"])).toEqual({ exe, args: ["--a"] });
  });
});

describe("previewChildEnv", () => {
  it("drops API billing variables and applies extras", () => {
    const env = previewChildEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", PATH: "p" }, { PORT: "1" });
    expect(env).toEqual({ PATH: "p", PORT: "1" });
  });
});
