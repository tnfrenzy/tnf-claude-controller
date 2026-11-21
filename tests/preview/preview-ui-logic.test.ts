import { describe, expect, it } from "vitest";
import { canStart, configToForm, formToConfig, groupShots, hasShellMeta, previewTabVisible, runBlocksPreview, shotCacheKey, splitCommand } from "../../ui/src/run/preview";
import type { PreviewStateView } from "../../ui/src/api";

const idle: PreviewStateView = { status: "idle", step: null, result: null };

describe("preview ui logic", () => {
  it("groups shots by label in first-seen order, narrow first", () => {
    const g = groupShots([
      { file: "a-1280.png", label: "/", width: 1280, ok: true },
      { file: "b-1280.png", label: "/login", width: 1280, ok: true },
      { file: "a-375.png", label: "/", width: 375, ok: true },
      { file: "b-375.png", label: "/login", width: 375, ok: false },
    ]);
    expect(g.map((x) => x.label)).toEqual(["/", "/login"]);
    expect(g[0].items.map((s) => s.width)).toEqual([375, 1280]);
    expect(g[1].items.map((s) => s.file)).toEqual(["b-375.png", "b-1280.png"]);
  });

  it("shot cache key changes with each capture", () => {
    expect(shotCacheKey("r", "a-375.png", 1)).not.toBe(shotCacheKey("r", "a-375.png", 2));
    expect(shotCacheKey("r", "a-375.png", 1)).toBe(shotCacheKey("r", "a-375.png", 1));
    expect(shotCacheKey("r", "a.png", null)).toBe("r:a.png:0");
  });

  it("tab visible only for coding runs with a project", () => {
    expect(previewTabVisible(true, "p")).toBe(true);
    expect(previewTabVisible(false, "p")).toBe(false);
    expect(previewTabVisible(true, null)).toBe(false);
  });

  it("canStart needs idle-ish state and permission", () => {
    expect(canStart(idle, true)).toBe(true);
    expect(canStart(idle, false)).toBe(false);
    expect(canStart({ ...idle, status: "running" }, true)).toBe(false);
    expect(canStart({ ...idle, status: "error" }, true)).toBe(true);
    expect(canStart(idle, true, true)).toBe(false);
  });

  it("run status blocks only web captures", () => {
    expect(runBlocksPreview("running", "web")).toBe(true);
    expect(runBlocksPreview("queued", "web")).toBe(true);
    expect(runBlocksPreview("done", "web")).toBe(false);
    expect(runBlocksPreview("running", "desktop")).toBe(false);
    expect(runBlocksPreview(undefined, "web")).toBe(false);
  });

  it("hasShellMeta matches the server rule", () => {
    expect(hasShellMeta("npm run dev & calc")).toBe(true);
    expect(hasShellMeta('npm run "dev"')).toBe(false);
    expect(hasShellMeta('"C:\\Program Files (x86)\\a\\x.exe" --a')).toBe(false);
    expect(hasShellMeta("node server.js && x")).toBe(false);
    expect(splitCommand('node "a b" c')).toEqual(["node", "a b", "c"]);
  });

  it("web form drops blank lines and empty numbers", () => {
    expect(formToConfig({ ...configToForm({ kind: "none" }), kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pagesText: "/\n\n/login\n" }))
      .toEqual({ kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/login"] });
  });

  it("round-trips web and desktop", () => {
    const web = { kind: "web" as const, startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/a"], readyTimeoutSec: 30 };
    expect(formToConfig(configToForm(web))).toEqual(web);
    const desk = { kind: "desktop" as const, exePath: "C:\\x\\app.exe", args: ["--a", "b"], windowTitle: "App", settleSec: 3 };
    expect(formToConfig(configToForm(desk))).toEqual(desk);
    expect(formToConfig(configToForm({ kind: "none" }))).toEqual({ kind: "none" });
  });

  it("desktop form omits empty settleSec and empty title", () => {
    const f = { ...configToForm({ kind: "none" }), kind: "desktop" as const, exePath: "a.exe", argsText: "\n x \n", windowTitle: "", settleSec: "" };
    expect(formToConfig(f)).toEqual({ kind: "desktop", exePath: "a.exe", args: ["x"], windowTitle: "" });
  });
});
