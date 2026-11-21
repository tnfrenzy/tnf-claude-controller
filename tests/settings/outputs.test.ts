import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultOutputDir, explorerArgs, resolveInside, syncRunOutputs, validateOutputDir } from "../../src/core/app/outputs.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import type { ControllerConfig } from "../../src/core/app/config.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-out-"));

describe("validateOutputDir", () => {
  it("creates an absolute ASCII dir", () => {
    const d = path.join(tmp(), "outputs");
    expect(validateOutputDir(d)).toBe(path.resolve(d));
    expect(fs.statSync(d).isDirectory()).toBe(true);
  });
  it("rejects relative, non-ASCII and dotdot paths", () => {
    expect(() => validateOutputDir("rel/dir")).toThrow(/tuyệt đối/);
    expect(() => validateOutputDir(path.join(tmp(), "Tài liệu"))).toThrow(/ASCII|không dấu/);
    expect(() => validateOutputDir(tmp() + "/a/../b")).toThrow(/\.\./);
    expect(() => validateOutputDir(42)).toThrow();
  });
});

describe("resolveInside / explorerArgs / defaultOutputDir", () => {
  it("blocks traversal", () => {
    const base = tmp();
    expect(resolveInside(base, "a/b.txt")).toBe(path.join(base, "a", "b.txt"));
    expect(resolveInside(base, "../x")).toBeNull();
  });
  it("builds explorer args", () => {
    expect(explorerArgs("D:\\o\\r1", false)).toEqual(["D:\\o\\r1"]);
    expect(explorerArgs("D:\\o\\r1\\a b.docx", true)).toEqual(['/select,"D:\\o\\r1\\a b.docx"']);
  });
  it("defaults under the workspace", () => {
    expect(defaultOutputDir("D:\\ws")).toBe(path.join("D:\\ws", "outputs"));
  });
});

describe("syncRunOutputs", () => {
  it("copies artifacts, is idempotent, keeps sources", () => {
    const run = tmp();
    const out = tmp();
    fs.mkdirSync(path.join(run, "notes"));
    fs.writeFileSync(path.join(run, "report.md"), "R");
    fs.writeFileSync(path.join(run, "notes", "a.md"), "A");
    const arts = [{ rel_path: "report.md" }, { rel_path: "notes/a.md" }];
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(2);
    expect(fs.readFileSync(path.join(out, "r1", "notes", "a.md"), "utf8")).toBe("A");
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(0);
    fs.writeFileSync(path.join(run, "report.md"), "R2");
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(1);
    expect(fs.existsSync(path.join(run, "report.md"))).toBe(true);
  });
  it("never mirrors run bookkeeping (stream.jsonl, system-prompt.md)", () => {
    const run = tmp();
    const out = tmp();
    for (const f of ["report.md", "stream.jsonl", "system-prompt.md"]) fs.writeFileSync(path.join(run, f), f);
    const arts = [{ rel_path: "report.md" }, { rel_path: "stream.jsonl" }, { rel_path: "system-prompt.md" }];
    expect(syncRunOutputs(run, out, "r2", arts)).toBe(1);
    expect(fs.readdirSync(path.join(out, "r2"))).toEqual(["report.md"]);
  });
  it("skips a file whose copy fails and still copies the others", () => {
    const run = tmp();
    const out = tmp();
    fs.writeFileSync(path.join(run, "a.md"), "A");
    fs.writeFileSync(path.join(run, "b.md"), "B");
    fs.writeFileSync(path.join(run, "c.md"), "C");
    fs.mkdirSync(path.join(out, "r1", "b.md"), { recursive: true }); // destination is a directory: copyFileSync throws
    const arts = [{ rel_path: "a.md" }, { rel_path: "b.md" }, { rel_path: "c.md" }];
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(2);
    expect(fs.readFileSync(path.join(out, "r1", "a.md"), "utf8")).toBe("A");
    expect(fs.readFileSync(path.join(out, "r1", "c.md"), "utf8")).toBe("C");
  });
  it("never copies a run-dir mcp.json (secrets), even a stale one", () => {
    const run = tmp();
    const out = tmp();
    const store = new RunStore(path.join(tmp(), "s.db"));
    fs.writeFileSync(path.join(run, "report.md"), "R");
    fs.writeFileSync(path.join(run, "mcp.json"), '{"mcpServers":{"x":{"env":{"K":"SECRET"}}}}');
    const arts = store.scanArtifacts("r1", run);
    expect(arts.map((a) => a.rel_path)).toEqual(["report.md"]);
    expect(syncRunOutputs(run, out, "r1", store.getArtifacts("r1"))).toBe(1);
    expect(fs.existsSync(path.join(out, "r1", "mcp.json"))).toBe(false);
    store.close();
  });
  it("ignores artifacts that escape the run dir", () => {
    const run = tmp();
    const out = tmp();
    expect(syncRunOutputs(run, out, "r1", [{ rel_path: "../../etc/x" }])).toBe(0);
  });
});

describe("RunManager output helpers", () => {
  let root: string;
  let store: RunStore;
  let mgr: RunManager;
  let calls: Array<{ dir: string; select?: string }>;
  beforeAll(() => {
    root = tmp();
    fs.mkdirSync(path.join(root, "data"));
    store = new RunStore(path.join(root, "x.db"));
    calls = [];
    const config = { dataDir: path.join(root, "data"), workspaceDir: path.join(root, "ws") } as unknown as ControllerConfig;
    mgr = new RunManager({ config, store, skipBillingGuard: true, openPath: (a) => { calls.push(a); } });
  });
  afterAll(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("syncs artifacts, opens via injected hook, refuses escaping rel", () => {
    const runDir = path.join(root, "run1");
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, "report.md"), "R");
    store.createRun({ id: "run1", status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project: "p", claude_version: null, run_dir: runDir, kind: "research" } as never);
    store.scanArtifacts("run1", runDir);
    const out = path.join(root, "outputs");
    expect(mgr.setOutputDir(out)).toBe(path.resolve(out));
    expect(mgr.outputDir()).toBe(path.resolve(out));
    expect(mgr.syncOutputs("run1")).toBe(1);
    expect(fs.readFileSync(path.join(out, "run1", "report.md"), "utf8")).toBe("R");
    expect(fs.existsSync(path.join(runDir, "report.md"))).toBe(true);

    const file = mgr.openOutput("run1", "report.md");
    expect(calls.at(-1)).toEqual({ dir: path.join(out, "run1"), select: file });
    mgr.openOutput("run1");
    expect(calls.at(-1)).toEqual({ dir: path.join(out, "run1") });
    expect(() => mgr.openOutput("run1", "../../x")).toThrow();
    expect(() => mgr.openOutput("nope")).toThrow(/Không tìm thấy/);
  });

  it("saveOutputFile validates group and name", () => {
    const f = mgr.saveOutputFile("skills/demo", "a.txt", Buffer.from("x"));
    expect(fs.readFileSync(f, "utf8")).toBe("x");
    expect(calls.at(-1)?.select).toBe(f);
    expect(() => mgr.saveOutputFile("../evil", "a.txt", Buffer.from("x"))).toThrow(/Nhóm/);
    expect(() => mgr.saveOutputFile("ok", "..\\a.txt", Buffer.from("x"))).toThrow();
  });
});
