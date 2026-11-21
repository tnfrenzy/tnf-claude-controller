import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContextBlock, CONTEXT_LABEL, projectMemoryPath, projectSlug, type ContextScanConfig } from "../../src/core/run/context-scan.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ctx-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const cfg = (over: Partial<ContextScanConfig> = {}): ContextScanConfig => ({ enabled: true, maxBytes: 1000, files: ["CLAUDE.md", "README.md"], ...over });

function trySymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

describe("buildContextBlock", () => {
  it("returns empty text when no file exists", () => {
    const wt = tmp();
    const r = buildContextBlock({ worktree: wt, cfg: cfg() });
    expect(r.text).toBe("");
    expect(r.loaded).toEqual([]);
  });
  it("loads CLAUDE.md (not assumed auto-loaded) and README with the reference-data label", () => {
    const wt = tmp();
    fs.writeFileSync(path.join(wt, "CLAUDE.md"), "Quy tắc dự án: dùng pnpm.", "utf8");
    fs.writeFileSync(path.join(wt, "README.md"), "# App", "utf8");
    const r = buildContextBlock({ worktree: wt, cfg: cfg() });
    expect(r.text).toContain(CONTEXT_LABEL);
    expect(r.text).toContain("dùng pnpm");
    expect(r.loaded.map((f) => f.name)).toEqual(["CLAUDE.md", "README.md"]);
  });
  it("truncates large files to maxBytes (total too)", () => {
    const wt = tmp();
    fs.writeFileSync(path.join(wt, "CLAUDE.md"), "a".repeat(5000), "utf8");
    fs.writeFileSync(path.join(wt, "README.md"), "b".repeat(5000), "utf8");
    const r = buildContextBlock({ worktree: wt, cfg: cfg({ maxBytes: 300 }) });
    const total = r.loaded.reduce((n, f) => n + f.bytes, 0);
    expect(total).toBeLessThanOrEqual(300);
    expect(r.loaded).toHaveLength(1);
    expect(r.loaded[0]!.bytes).toBe(300);
  });
  it("loads project memory.md first", () => {
    const wt = tmp();
    const data = tmp();
    const mem = projectMemoryPath(data, "demo");
    fs.mkdirSync(path.dirname(mem), { recursive: true });
    fs.writeFileSync(mem, "MEMORY-MARKER: build bằng npm run build", "utf8");
    fs.writeFileSync(path.join(wt, "README.md"), "# App", "utf8");
    const r = buildContextBlock({ worktree: wt, memoryPath: mem, memoryRoot: path.join(data, "projects"), cfg: cfg() });
    expect(r.text).toContain("MEMORY-MARKER");
    expect(r.loaded[0]!.name).toContain("memory.md");
  });
  it("enabled=false gives an empty block", () => {
    const wt = tmp();
    fs.writeFileSync(path.join(wt, "README.md"), "# App", "utf8");
    expect(buildContextBlock({ worktree: wt, cfg: cfg({ enabled: false }) }).text).toBe("");
  });
  it("ignores .. and absolute paths that leave the worktree", () => {
    const base = tmp();
    const wt = path.join(base, "wt");
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(base, "secret.txt"), "SECRET", "utf8");
    const r = buildContextBlock({ worktree: wt, cfg: cfg({ files: ["../secret.txt", path.join(base, "secret.txt")] }) });
    expect(r.text).toBe("");
  });
  it("ignores symlinks/junctions that escape the worktree (skipped with a note when they cannot be created)", () => {
    const base = tmp();
    const wt = path.join(base, "wt");
    fs.mkdirSync(wt);
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "README.md"), "SECRET", "utf8");
    if (!trySymlink(outside, path.join(wt, "docs"))) {
      console.warn("symlink/junction not creatable here; skipping escape check");
      return;
    }
    const r = buildContextBlock({ worktree: wt, cfg: cfg({ files: ["docs/README.md"] }) });
    expect(r.text).toBe("");
  });
  it("memory path outside the memory root (symlink) is ignored", () => {
    const base = tmp();
    const root = path.join(base, "projects");
    fs.mkdirSync(path.join(root, "x"), { recursive: true });
    const outside = path.join(base, "elsewhere.md");
    fs.writeFileSync(outside, "SECRET", "utf8");
    const mem = path.join(root, "x", "memory.md");
    try {
      fs.symlinkSync(outside, mem, "file");
    } catch {
      console.warn("file symlink not creatable here; skipping");
      return;
    }
    const wt = tmp();
    expect(buildContextBlock({ worktree: wt, memoryPath: mem, memoryRoot: root, cfg: cfg() }).text).toBe("");
  });
});

describe("projectSlug / projectMemoryPath", () => {
  it("keeps plain names and hashes anything that could be a path", () => {
    expect(projectSlug("my-app_1.2")).toBe("my-app_1.2");
    for (const bad of ["..", "../x", "a/b", "a\\b", "C:\\x", "con me", "x.", "", ".hidden"]) {
      const s = projectSlug(bad);
      expect(s).toMatch(/^p-[0-9a-f]{16}$/);
    }
  });
  it("never escapes <dataDir>/projects", () => {
    const data = path.resolve("/tmp/data");
    for (const name of ["..", "../../etc", "a/../../b", "x\\..\\y"]) {
      const p = projectMemoryPath(data, name);
      expect(path.relative(path.join(data, "projects"), p).startsWith("..")).toBe(false);
    }
  });
});
