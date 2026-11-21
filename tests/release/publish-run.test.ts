import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, git, isBranchMerged } from "../../src/core/git/git.js";
import { bumpLockJson, bumpPatchJson, planPublish } from "../../src/core/app/publish.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });

describe("publish helpers", () => {
  it("bumpPatchJson keeps CRLF and indent", () => {
    const t = '{\r\n    "name": "x",\r\n    "version": "1.2.3"\r\n}\r\n';
    const r = bumpPatchJson(t)!;
    expect(r.text).toBe('{\r\n    "name": "x",\r\n    "version": "1.2.4"\r\n}\r\n');
    expect(r.previous).toBe("1.2.3");
    expect(bumpPatchJson('{\n\t"version": "0.0.9"\n}')!.text).toBe('{\n\t"version": "0.0.10"\n}');
    expect(bumpPatchJson('{"name":"x"}')).toBeNull();
    expect(bumpPatchJson('{"version":"1.2"}')).toBeNull();
  });
  it("bumpLockJson updates root and packages[\"\"]", () => {
    const lock = '{\n  "name": "x",\n  "version": "1.0.0",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "1.0.0"\n    },\n    "node_modules/a": {\n      "version": "1.0.0"\n    }\n  }\n}\n';
    const out = bumpLockJson(lock, "1.0.0", "1.0.1");
    expect(JSON.parse(out).version).toBe("1.0.1");
    expect(JSON.parse(out).packages[""].version).toBe("1.0.1");
    expect(JSON.parse(out).packages["node_modules/a"].version).toBe("1.0.0");
  });
});

describe("isBranchMerged + publishRun", () => {
  let root: string;
  let repo: string;
  let store: RunStore;
  let manager: RunManager;
  const pkg = '{\n  "name": "x",\n  "version": "1.0.0"\n}\n';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pub-"));
    repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    G(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "package.json"), pkg);
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "init"]);
    G(repo, ["branch", "tnf/p1"]);
    store = new RunStore(path.join(root, "controller.db"));
    store.upsertProject({ name: "rp", repo_path: repo, base_branch: "main", allowed_commands: [] });
    store.createRun({ id: "p1", status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project: "rp", claude_version: null, run_dir: path.join(root, "p1"), kind: "coding", worktree_path: path.join(root, "wt"), branch: "tnf/p1" } as never);
    const config = { workspaceDir: path.join(root, "ws"), worktreesDir: path.join(root, "ws", "worktrees"), dataDir: path.join(root, "data"), defaults: {} } as never;
    manager = new RunManager({ config, store } as never);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mergeIt = () => {
    G(repo, ["checkout", "-q", "tnf/p1"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "f\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "feat"]);
    G(repo, ["checkout", "-q", "main"]);
    G(repo, ["merge", "--no-ff", "-m", "merge", "tnf/p1"]);
  };

  it("isBranchMerged: unmerged, merged, missing", () => {
    G(repo, ["checkout", "-q", "tnf/p1"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "f\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "feat"]);
    G(repo, ["checkout", "-q", "main"]);
    expect(isBranchMerged(repo, "tnf/p1", "main")).toBe(false);
    G(repo, ["merge", "--no-ff", "-m", "merge", "tnf/p1"]);
    expect(isBranchMerged(repo, "tnf/p1", "main")).toBe(true);
    expect(isBranchMerged(repo, "tnf/nope", "main")).toBe(false);
  });

  it("publishes after merge, twice, without tag", () => {
    mergeIt();
    const r = manager.publishRun("p1");
    expect(r.version).toBe("1.0.1");
    expect(r.previous).toBe("1.0.0");
    expect(G(repo, ["log", "-1", "--format=%s"])).toBe("chore(release): 1.0.1");
    expect(manager.publishRun("p1").version).toBe("1.0.2");
    expect(G(repo, ["tag"])).toBe("");
    expect(fs.readFileSync(path.join(repo, "package.json"), "utf8")).toContain('"version": "1.0.2"');
  });

  it("updates package-lock in both places", () => {
    fs.writeFileSync(path.join(repo, "package-lock.json"), '{\n  "name": "x",\n  "version": "1.0.0",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "1.0.0"\n    }\n  }\n}\n');
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "lock"]);
    mergeIt();
    manager.publishRun("p1");
    const lock = JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8"));
    expect(lock.version).toBe("1.0.1");
    expect(lock.packages[""].version).toBe("1.0.1");
  });

  it("refuses when not merged", () => {
    G(repo, ["checkout", "-q", "tnf/p1"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "f\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "feat"]);
    G(repo, ["checkout", "-q", "main"]);
    expect(() => manager.publishRun("p1")).toThrow(/commit vào main/);
    expect(fs.readFileSync(path.join(repo, "package.json"), "utf8")).toBe(pkg);
  });

  it("refuses dirty repo and other branch", () => {
    mergeIt();
    fs.writeFileSync(path.join(repo, "dirty.txt"), "d\n");
    expect(() => manager.publishRun("p1")).toThrow(/chưa commit/);
    expect(fs.readFileSync(path.join(repo, "package.json"), "utf8")).toBe(pkg);
    fs.rmSync(path.join(repo, "dirty.txt"));
    G(repo, ["checkout", "-q", "-b", "other"]);
    expect(() => manager.publishRun("p1")).toThrow(/nhánh/);
  });

  it("refuses missing package.json, broken JSON, missing version", () => {
    mergeIt();
    const pj = path.join(repo, "package.json");
    const set = (t: string | null) => {
      if (t === null) G(repo, ["rm", "-q", "package.json"]);
      else {
        fs.writeFileSync(pj, t);
        G(repo, ["add", "-A"]);
      }
      G(repo, ["commit", "-m", "mod"]);
    };
    set("{ broken");
    expect(() => planPublish(repo)).toThrow(/JSON hỏng/);
    expect(() => manager.publishRun("p1")).toThrow(/JSON hỏng/);
    expect(fs.readFileSync(pj, "utf8")).toBe("{ broken");
    set('{\n  "name": "x"\n}\n');
    expect(() => manager.publishRun("p1")).toThrow(/không có trường version hợp lệ/);
    expect(fs.readFileSync(pj, "utf8")).toBe('{\n  "name": "x"\n}\n');
    set(null);
    expect(() => manager.publishRun("p1")).toThrow(/không phải Node/);
  });
});
