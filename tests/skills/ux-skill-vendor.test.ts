import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "vendor-ux-skill.mjs");
const skillDir = path.join(repoRoot, "config", "skills", "ui-ux-pro-max");
const present = fs.existsSync(path.join(skillDir, "SKILL.md"));

async function loadScript() {
  return await import(/* @vite-ignore */ "file:///" + scriptPath.replace(/\\/g, "/"));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("ux-skill vendor script (luon chay)", () => {
  it("script ton tai va danh sach cho phep khong chua ten bi cam", async () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const m = await loadScript();
    for (const f of m.REQUIRED_FILES as string[]) {
      const base = path.posix.basename(f);
      expect(m.FORBIDDEN_NAMES).not.toContain(base);
      for (const re of m.FORBIDDEN_PATTERNS as RegExp[]) expect(re.test(base)).toBe(false);
    }
    expect(m.REFERENCED_NOT_COPIED).toContain("google-fonts.csv");
  });

  it("patchSkillMd khong de sot CLAUDE_PLUGIN_ROOT hay .claude/skills/ui-ux-pro-max", async () => {
    const m = await loadScript();
    const out = m.patchSkillMd(
      "run ${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py and ${CLAUDE_PLUGIN_ROOT}/x and .claude/skills/ui-ux-pro-max/data",
    ) as string;
    expect(out).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(out).not.toContain(".claude/skills/ui-ux-pro-max");
    expect(out).toContain("config/skills/ui-ux-pro-max/scripts/search.py");
  });

  it("thieu mot tep trong --src -> exit khac 0 va nem ten tep thieu", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ux-vendor-test-"));
    const dest = path.join(tmp, "out");
    const r = spawnSync("node", [scriptPath, "--src", tmp, "--dest", dest], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Thieu tep bat buoc");
    expect(r.stderr).toContain("SKILL.md");
    expect(fs.existsSync(dest)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe.skipIf(!present)("ux-skill vendor: du lieu da vendor (SKIP neu chua chay Task 4)", () => {
  it("SKILL.md, LICENSE MIT, khong con CLAUDE_PLUGIN_ROOT, khong con duong dan .claude long", () => {
    const md = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(md).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(md).not.toContain(".claude/skills/ui-ux-pro-max");
    expect(fs.readFileSync(path.join(skillDir, "LICENSE"), "utf8")).toMatch(/MIT/);
  });

  it("moi tep bat buoc ton tai, dung luong <= 1.3 MB, khong co tep bi cam", async () => {
    const m = await loadScript();
    for (const f of m.REQUIRED_FILES as string[]) expect(fs.existsSync(path.join(skillDir, f)), f).toBe(true);
    const files = walk(skillDir);
    const total = files.reduce((s, f) => s + fs.statSync(f).size, 0);
    expect(total).toBeLessThanOrEqual(1.3 * 1024 * 1024);
    for (const f of files) {
      const base = path.basename(f);
      expect(m.FORBIDDEN_NAMES).not.toContain(base);
      for (const re of m.FORBIDDEN_PATTERNS as RegExp[]) expect(re.test(base)).toBe(false);
    }
  });

  const py = spawnSync("python", ["--version"], { encoding: "utf8" });
  it.skipIf(py.status !== 0)("search.py chay that: design-system --persist ghi MASTER.md, khong ghi vao cwd", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "ux-out-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ux-cwd-"));
    const r = spawnSync(
      "python",
      ["-X", "utf8", "-I", path.join(skillDir, "scripts", "search.py"), "saas dashboard", "--design-system", "--persist", "-p", "Test", "--output-dir", out],
      { cwd, encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(0);
    const ds = path.join(out, "design-system");
    const slugs = fs.readdirSync(ds);
    expect(slugs.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(ds, slugs[0], "MASTER.md"))).toBe(true);
    expect(fs.readdirSync(cwd)).toEqual([]);
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
