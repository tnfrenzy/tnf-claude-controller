import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { TEMPLATES, scaffoldFiles, scaffoldProject, type TemplateId } from "../../src/core/app/project-scaffold.js";
import { runGit } from "../../src/core/git/git.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sc-"));
}

describe("project scaffold", () => {
  it("has the four templates", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["web", "api", "script", "blank"]);
  });

  it("every template carries the shared rule files", () => {
    for (const t of TEMPLATES) {
      const f = scaffoldFiles({ name: "demo", template: t.id, goal: "Mục tiêu thử", parentDir: "/x" });
      for (const k of ["CLAUDE.md", "README.md", "docs/HANDOVER.md", "docs/features.md", ".gitignore"]) expect(f[k], `${t.id}:${k}`).toBeTruthy();
      expect(f["CLAUDE.md"]).toContain("Mục tiêu thử");
      expect(f["CLAUDE.md"]).toContain("không bao giờ `git push`".replace("không", "Không"));
    }
  });

  it("creates the folder, git repo with one commit, and the memory file", () => {
    const root = tmp();
    const r = scaffoldProject({ name: "demo-web", template: "web", goal: "Thử" }, { defaultParent: path.join(root, "projects"), dataDir: path.join(root, "data") });
    expect(r.dir).toBe(path.join(root, "projects", "demo-web"));
    expect(fs.existsSync(path.join(r.dir, "CLAUDE.md"))).toBe(true);
    expect(runGit(r.dir, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe("1");
    expect(runGit(r.dir, ["log", "-1", "--format=%an"]).stdout.trim()).toBe("TNF Agent");
    expect(fs.readFileSync(r.memoryPath, "utf8")).toContain("Thử");
  });

  it("rejects bad names, relative parents and a non-empty folder", () => {
    const root = tmp();
    const o = { defaultParent: path.join(root, "p"), dataDir: path.join(root, "d") };
    expect(() => scaffoldProject({ name: "Tên có dấu", template: "blank" }, o)).toThrow(/Tên môi trường/);
    expect(() => scaffoldProject({ name: "ok", template: "blank", parentDir: "relative/x" }, o)).toThrow(/tuyệt đối/);
    scaffoldProject({ name: "dup", template: "blank" }, o);
    expect(() => scaffoldProject({ name: "dup", template: "blank" }, o)).toThrow(/không trống/);
  });

  // The generated code must really run: its own tests are executed with node --test.
  for (const id of ["web", "api", "script"] as TemplateId[]) {
    it(`generated ${id} template passes its own tests`, () => {
      const root = tmp();
      const r = scaffoldProject({ name: "gen-" + id, template: id }, { defaultParent: path.join(root, "p"), dataDir: path.join(root, "d") });
      const run = spawnSync(process.execPath, ["--test"], { cwd: r.dir, encoding: "utf8", timeout: 60_000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    }, 90_000);
  }
});
