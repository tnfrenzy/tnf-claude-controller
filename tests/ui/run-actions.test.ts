import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";
import { runActionState } from "../../ui/src/run/runActions";

describe("runActionState", () => {
  it("done coding, not merged: commit enabled, publish disabled with hint", () => {
    const s = runActionState({ kind: "coding", status: "done", merged: false });
    expect(s).toEqual({ showCommit: true, commitDisabled: false, showPublish: true, publishDisabled: true, publishNeedsMerge: true });
  });
  it("merged undefined behaves like not merged", () => {
    const s = runActionState({ kind: "coding", status: "done" });
    expect(s.publishDisabled).toBe(true);
    expect(s.commitDisabled).toBe(false);
  });
  it("merged true: commit locked, publish enabled", () => {
    const s = runActionState({ kind: "coding", status: "done", merged: true });
    expect(s.commitDisabled).toBe(true);
    expect(s.publishDisabled).toBe(false);
    expect(s.publishNeedsMerge).toBe(false);
  });
  it("running, failed or research: nothing shown", () => {
    for (const r of [{ kind: "coding", status: "running" }, { kind: "coding", status: "error" }, { kind: "research", status: "done" }]) {
      const s = runActionState(r);
      expect(s.showCommit).toBe(false);
      expect(s.showPublish).toBe(false);
    }
  });
  it("commit hidden when the worktree is gone, publish stays", () => {
    const s = runActionState({ kind: "coding", status: "done", merged: true }, false);
    expect(s.showCommit).toBe(false);
    expect(s.showPublish).toBe(true);
  });
  it("vi and en have the new keys", () => {
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const k of ["release_btn", "publish_btn", "publish_need_merge", "publish_confirm1", "publish_confirm2", "publish_yes2", "publish_done"]) expect(d[k]).toBeTruthy();
    }
    expect(dicts.vi.release_btn).toBe("Commit vào main");
    expect(dicts.vi.publish_need_merge).toBe("Hãy commit vào main trước");
  });
});
