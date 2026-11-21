import { describe, expect, it } from "vitest";
import { appWindowArgs, locateBrowser } from "../../src/core/app/browser-locator.js";

const fake = (...paths: string[]) => (p: string) => paths.includes(p);

describe("locateBrowser", () => {
  it("prefers edge when both are in PATH", () => {
    const r = locateBrowser({ PATH: "C:\\a;C:\\b" }, "win32", fake("C:\\a\\chrome.exe", "C:\\b\\msedge.exe"));
    expect(r).toEqual({ kind: "edge", path: "C:\\b\\msedge.exe" });
  });
  it("finds chrome alone in PATH", () => {
    const r = locateBrowser({ PATH: "C:\\a;C:\\b" }, "win32", fake("C:\\a\\chrome.exe"));
    expect(r).toEqual({ kind: "chrome", path: "C:\\a\\chrome.exe" });
  });
  it("finds edge in ProgramFiles(x86)", () => {
    const p = "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe";
    const r = locateBrowser({ PATH: "C:\\a", "ProgramFiles(x86)": "C:\\PF86" }, "win32", fake(p));
    expect(r).toEqual({ kind: "edge", path: p });
  });
  it("finds chrome in LOCALAPPDATA", () => {
    const p = "C:\\L\\Google\\Chrome\\Application\\chrome.exe";
    const r = locateBrowser({ PATH: "", LOCALAPPDATA: "C:\\L" }, "win32", fake(p));
    expect(r).toEqual({ kind: "chrome", path: p });
  });
  it("returns null when nothing exists", () => {
    expect(locateBrowser({ PATH: "C:\\a;C:\\b" }, "win32", fake())).toBeNull();
  });
  it("returns null on non-windows", () => {
    expect(locateBrowser({ PATH: "/usr/bin" }, "linux", () => true)).toBeNull();
  });
});

describe("appWindowArgs", () => {
  it("builds three args", () => {
    const a = appWindowArgs("http://127.0.0.1:4800/#token=x", "/data");
    expect(a).toHaveLength(3);
    expect(a[0]).toBe("--app=http://127.0.0.1:4800/#token=x");
    expect(a[1]).toBe("--window-size=1280,860");
    expect(a[2]).toMatch(/^--user-data-dir=.*app-profile$/);
  });
});
