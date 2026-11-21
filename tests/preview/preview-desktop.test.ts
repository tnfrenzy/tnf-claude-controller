import { describe, expect, it } from "vitest";
import { captureDesktop, compileHelper, cscPath, type DesktopDeps } from "../../src/core/preview/preview-desktop.js";

const cfg = { kind: "desktop", exePath: "C:\\a\\app.exe", args: ["--x"], windowTitle: "My App", settleSec: 3 } as const;
function deps(over: Partial<DesktopDeps> = {}) {
  const log: string[] = [];
  const d: DesktopDeps = {
    helperExe: async () => "C:\\d\\preview-capture.exe",
    spawnApp: (e, a) => { log.push(`spawn ${e} ${a.join(" ")}`); return { pid: 55, onExit: () => undefined, log: () => [] }; },
    killTree: (p) => { log.push(`kill ${p}`); },
    closeApp: async (p) => { log.push(`close ${p}`); },
    runHelper: async (_e, a) => { log.push(`helper ${a.join("|")}`); return { code: 0, stderr: "", timedOut: false }; },
    sleep: async (ms) => { log.push(`sleep ${ms}`); },
    fileOk: () => true,
    ...over,
  };
  return { d, log };
}

describe("captureDesktop", () => {
  it("launches, waits settle time, captures, closes", async () => {
    const { d, log } = deps();
    const r = await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toBeNull();
    expect(r.shots).toEqual([{ file: "window.png", label: "My App", width: 0, ok: true }]);
    expect(log[0]).toBe("spawn C:\\a\\app.exe --x");
    expect(log).toContain("sleep 3000");
    expect(log.find((l) => l.startsWith("helper"))).toBe("helper --title|My App|--pid|55|--out|D:\\out\\window.png");
    expect(log[log.length - 1]).toBe("close 55");
  });
  it("maps helper exit codes to Vietnamese messages and still closes the app", async () => {
    for (const [code, re] of [[2, /không thấy cửa sổ/i], [3, /rỗng/i], [4, /lỗi/i]] as const) {
      const { d, log } = deps({ runHelper: async () => ({ code, stderr: "boom", timedOut: false }) });
      const r = await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d);
      expect(r.error).toMatch(re);
      expect(r.shots).toEqual([]);
      expect(log[log.length - 1]).toBe("close 55");
    }
  });
  it("reports a helper compile failure without launching the app", async () => {
    const { d, log } = deps({ helperExe: async () => { throw new Error("Không biên dịch được helper chụp cửa sổ."); } });
    const r = await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toMatch(/biên dịch/);
    expect(log).toEqual([]);
  });
  it("reports timeout", async () => {
    const { d } = deps({ runHelper: async () => ({ code: null, stderr: "", timedOut: true }) });
    expect((await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d)).error).toMatch(/quá thời gian/);
  });
});

describe("compileHelper / cscPath", () => {
  it("fails clearly without csc", () => {
    expect(() => compileHelper("a.cs", "a.exe", () => ({ code: 0, stderr: "" }), null)).toThrow(/csc/i);
  });
  it("throws on a compiler error with its message", () => {
    expect(() => compileHelper("a.cs", "a.exe", () => ({ code: 1, stderr: "error CS1002" }), "C:\\csc.exe")).toThrow(/CS1002/);
  });
  it("finds csc under WINDIR", () => {
    expect(cscPath({ WINDIR: "C:\\Windows" }, () => true)).toBe("C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe");
    expect(cscPath({ WINDIR: "C:\\Windows" }, () => false)).toBeNull();
  });
});
