import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import { QueueStore } from "../../src/core/queue/queue-store.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

let tmp: string;
let store: RunStore;
let mgr: RunManager;
let n = 0;

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });

/** Real repo on `main` + worktree on tnf/<id>, with a project row and a finished coding run. */
function setup(extra: { project?: string } = {}) {
  const id = `rel${++n}`;
  const repo = path.join(tmp, `repo-${id}`);
  fs.mkdirSync(repo);
  G(repo, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "README.md"), "hi\n");
  G(repo, ["add", "-A"]);
  G(repo, ["commit", "-m", "init"]);
  const wt = path.join(tmp, `wt-${id}`);
  G(repo, ["worktree", "add", "-b", `tnf/${id}`, wt]);
  const project = extra.project ?? `p-${id}`;
  store.upsertProject({ name: project, repo_path: repo, base_branch: "main", allowed_commands: [] });
  store.createRun({ id, status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project, claude_version: null, run_dir: path.join(tmp, id), kind: "coding", worktree_path: wt, branch: `tnf/${id}` } as never);
  return { id, repo, wt, project };
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-"));
  store = new RunStore(path.join(tmp, "x.db"));
  mgr = new RunManager({ config: {} as unknown as ControllerConfig, store, skipBillingGuard: true });
});
afterAll(() => {
  store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("releaseRun", () => {
  it("commits leftovers (excluding node_modules) and merges into base; repo stays clean", () => {
    const s = setup();
    fs.writeFileSync(path.join(s.wt, "feature.js"), "x\n");
    fs.mkdirSync(path.join(s.wt, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(s.wt, "node_modules", "x", "index.js"), "y\n");
    const r = mgr.releaseRun(s.id);
    expect(r.committed).toBe(true);
    expect(r.merged).toBe(true);
    expect(r.base).toBe("main");
    expect(fs.existsSync(path.join(s.repo, "feature.js"))).toBe(true);
    const files = G(s.repo, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(files).toContain("feature.js");
    expect(files).not.toContain("node_modules/");
    expect(G(s.repo, ["status", "--porcelain"])).toBe("");
  });

  it("refuses when the target repo is dirty, with no side effects", () => {
    const s = setup();
    fs.writeFileSync(path.join(s.wt, "a.txt"), "a\n");
    fs.writeFileSync(path.join(s.repo, "dirty.txt"), "d\n");
    expect(() => mgr.releaseRun(s.id)).toThrow(/chưa commit/);
    expect(G(s.wt, ["status", "--porcelain"])).toContain("a.txt");
  });

  it("refuses when the target repo is on another branch", () => {
    const s = setup();
    G(s.repo, ["checkout", "-b", "other"]);
    fs.writeFileSync(path.join(s.wt, "a.txt"), "a\n");
    expect(() => mgr.releaseRun(s.id)).toThrow(/nhánh "other"/);
    expect(G(s.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("other");
    expect(G(s.wt, ["status", "--porcelain"])).toContain("a.txt");
  });

  it("aborts on conflict and leaves the repo clean", () => {
    const s = setup();
    fs.writeFileSync(path.join(s.wt, "README.md"), "from run\n");
    fs.writeFileSync(path.join(s.repo, "README.md"), "from main\n");
    G(s.repo, ["commit", "-am", "main change"]);
    expect(() => mgr.releaseRun(s.id)).toThrow(/xung đột/);
    expect(G(s.repo, ["status", "--porcelain"])).toBe("");
  });

  it("refuses active runs, research runs and deleted projects", () => {
    const s = setup();
    (mgr as unknown as { active: Map<string, unknown> }).active.set(s.id, {});
    expect(() => mgr.releaseRun(s.id)).toThrow(/đang được/);
    (mgr as unknown as { active: Map<string, unknown> }).active.delete(s.id);

    store.createRun({ id: "res1", status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: path.join(tmp, "res1") } as never);
    expect(() => mgr.releaseRun("res1")).toThrow(/lập trình/);

    store.deleteProject(s.project);
    expect(() => mgr.releaseRun(s.id)).toThrow(/đã bị xóa|Không tìm thấy project/);
  });

  it("marks every committed queue command on the same idea branch as merged", () => {
    const s = setup();
    const q = new QueueStore(path.join(tmp, "qdata"));
    (mgr as unknown as { queueStoreCache: QueueStore }).queueStoreCache = q;
    q.addCommands(
      s.project,
      [
        { id: "c1", title: "Một", body: "b" },
        { id: "c2", title: "Hai", body: "b" },
        { id: "c3", title: "Khác", body: "b" },
      ],
      { hasRepo: true },
    );
    const commit = (id: string, runId: string, branch: string) => {
      q.transition(s.project, id, "đã duyệt");
      q.transition(s.project, id, "đang chạy", { runId });
      q.transition(s.project, id, "đã commit", { branch });
    };
    commit("c1", "other-run-1", `tnf/${s.id}`);
    commit("c2", s.id, `tnf/${s.id}`);
    commit("c3", "other-run-3", "tnf/elsewhere");
    fs.writeFileSync(path.join(s.wt, "f.txt"), "f\n");
    mgr.releaseRun(s.id);
    const by = Object.fromEntries(q.list(s.project).map((c) => [c.id, c.status]));
    expect(by.c1).toBe("đã gộp");
    expect(by.c2).toBe("đã gộp");
    expect(by.c3).toBe("đã commit");
  });
});
