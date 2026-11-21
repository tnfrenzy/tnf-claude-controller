import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_PREVIEW, isCmdShimCommand, pageSlug, splitCommand, validatePreview } from "../../src/core/preview/preview-config.js";

describe("validatePreview", () => {
  it("none / empty -> none", () => {
    expect(validatePreview(undefined)).toEqual(NO_PREVIEW);
    expect(validatePreview({ kind: "none" })).toEqual(NO_PREVIEW);
  });
  it("web: defaults and trimming", () => {
    const c = validatePreview({ kind: "web", startCommand: " npm run dev ", url: "http://localhost:5173", pages: [] });
    expect(c).toEqual({ kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/"], readyTimeoutSec: 60 });
  });
  it("web: rejects remote host, bad pages, empty command, too many pages", () => {
    const ok = { kind: "web", startCommand: "npm run dev", url: "http://localhost:3000", pages: ["/"] };
    expect(() => validatePreview({ ...ok, url: "http://example.com" })).toThrow(/localhost/);
    expect(() => validatePreview({ ...ok, url: "https://localhost:3000" })).toThrow(/http/);
    expect(() => validatePreview({ ...ok, startCommand: "  " })).toThrow(/lệnh/i);
    expect(() => validatePreview({ ...ok, pages: ["login"] })).toThrow(/bắt đầu bằng/);
    expect(() => validatePreview({ ...ok, pages: ["/a/../b"] })).toThrow(/\.\./);
    expect(() => validatePreview({ ...ok, pages: Array.from({ length: 13 }, (_, i) => `/p${i}`) })).toThrow(/12/);
  });
  it("web: rejects shell metacharacters in the start command", () => {
    const mk = (startCommand: string) => ({ kind: "web", startCommand, url: "http://localhost:3000", pages: ["/"] });
    for (const bad of ["npm run dev & calc", "npm run dev | x", 'npm run "dev" > o', "npm run %PATH%", "npm run dev ^ x", "npm run (x)", "npm run dev!"]) {
      expect(() => validatePreview(mk(bad)), bad).toThrow(/ký tự điều khiển/);
    }
    expect(validatePreview(mk("npm run dev -- --port 5173"))).toMatchObject({ startCommand: "npm run dev -- --port 5173" });
    expect(validatePreview(mk(String.raw`node "C:\my app\s.js"`))).toMatchObject({ kind: "web" });
  });
  it("web: the metacharacter rule applies only to cmd shim commands", () => {
    const mk = (startCommand: string) => ({ kind: "web", startCommand, url: "http://localhost:3000", pages: ["/"] });
    expect(() => validatePreview(mk("npm run dev & calc"))).toThrow(/ký tự điều khiển/);
    expect(() => validatePreview(mk("npx.cmd serve & calc"))).toThrow(/ký tự điều khiển/);
    expect(validatePreview(mk(String.raw`"C:\Program Files (x86)\app\x.exe" --a`))).toMatchObject({ kind: "web" });
    expect(isCmdShimCommand("npm")).toBe(true);
    expect(isCmdShimCommand("npmXcmd")).toBe(false);
    expect(isCmdShimCommand("node")).toBe(false);
  });
  it("web: rejects // and %2e path segments", () => {
    const ok = { kind: "web", startCommand: "npm run dev", url: "http://localhost:3000", pages: ["/"] };
    expect(() => validatePreview({ ...ok, pages: ["//evil.example.com/x"] })).toThrow(/\/\//);
    expect(() => validatePreview({ ...ok, pages: ["/a/%2e%2e/b"] })).toThrow(/%2e/);
    expect(() => validatePreview({ ...ok, pages: ["/a/%2E/b"] })).toThrow(/%2e/);
    expect(validatePreview({ ...ok, pages: ["/a%2eb"] })).toMatchObject({ kind: "web" });
  });
  it("desktop: default exists check requires a file, not a directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prevcfg-"));
    try {
      const asDir = path.join(dir, "x.exe");
      fs.mkdirSync(asDir);
      const d = { kind: "desktop", exePath: asDir, windowTitle: "T" };
      expect(() => validatePreview(d)).toThrow(/không tồn tại/);
      const asFile = path.join(dir, "y.exe");
      fs.writeFileSync(asFile, "x");
      expect(validatePreview({ ...d, exePath: asFile })).toMatchObject({ kind: "desktop" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("web: timeout clamps to 5..300 via error", () => {
    const ok = { kind: "web", startCommand: "x", url: "http://127.0.0.1:1", pages: ["/"] };
    expect(() => validatePreview({ ...ok, readyTimeoutSec: 2 })).toThrow(/5/);
    expect(validatePreview({ ...ok, readyTimeoutSec: 120 })).toMatchObject({ readyTimeoutSec: 120 });
  });
  it("desktop: needs absolute ASCII existing .exe and a title", () => {
    const exists = () => true;
    const ok = { kind: "desktop", exePath: "C:\\Windows\\notepad.exe", windowTitle: "Notepad" };
    expect(validatePreview(ok, exists)).toEqual({ kind: "desktop", exePath: "C:\\Windows\\notepad.exe", args: [], windowTitle: "Notepad", settleSec: 3 });
    expect(() => validatePreview({ ...ok, exePath: "notepad.exe" }, exists)).toThrow(/tuyệt đối/);
    expect(() => validatePreview({ ...ok, exePath: "C:\\a\\Tài.exe" }, exists)).toThrow(/ASCII|không dấu/);
    expect(() => validatePreview({ ...ok, exePath: "C:\\a\\b.bat" }, exists)).toThrow(/\.exe/);
    expect(() => validatePreview(ok, () => false)).toThrow(/không tồn tại/);
    expect(() => validatePreview({ ...ok, windowTitle: "" }, exists)).toThrow(/tiêu đề/);
    expect(() => validatePreview({ ...ok, settleSec: 99 }, exists)).toThrow(/30/);
  });
  it("unknown kind throws", () => {
    expect(() => validatePreview({ kind: "x" })).toThrow(/loại/);
  });
});

describe("splitCommand / pageSlug", () => {
  it("splits with quotes", () => {
    expect(splitCommand('npm run dev -- --port 5173')).toEqual(["npm", "run", "dev", "--", "--port", "5173"]);
    expect(splitCommand('node "C:\\my app\\s.js" a')).toEqual(["node", "C:\\my app\\s.js", "a"]);
  });
  it("slugs", () => {
    expect(pageSlug("/")).toBe("home");
    expect(pageSlug("/login")).toBe("login");
    expect(pageSlug("/a/b?x=1")).toBe("a-b-x-1");
  });
});
