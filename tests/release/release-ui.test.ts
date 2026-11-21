import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { RELCFG_I18N_KEYS, RELEASE_I18N_KEYS, formatCommandLine, formatTargets, nextReleasePhase } from "../../ui/src/settings/releaseFlow.js";

describe("release UI helpers", () => {
  it("formats command lines, quoting arguments with spaces", () => {
    expect(formatCommandLine(["git", "commit", "-m", "chore(release): 1.0.1"])).toBe('git commit -m "chore(release): 1.0.1"');
    expect(formatCommandLine(["git", "push", "origin", "main"])).toBe("git push origin main");
  });

  it("formats targets", () => {
    expect(formatTargets(undefined)).toEqual([]);
    expect(formatTargets({ remote: "origin", deploy: "u@h:/srv", url: "https://example.com" }).map((x) => x.key)).toEqual(["remote", "deploy", "url"]);
  });

  it("walks idle -> dryrun -> confirm1 -> confirm2 -> running -> idle, cancel anywhere", () => {
    let p = nextReleasePhase("idle", "start");
    expect(p).toBe("dryrun");
    p = nextReleasePhase(p, "confirm");
    expect(p).toBe("dryrun");
    p = nextReleasePhase(p, "preview_ok");
    expect(p).toBe("confirm1");
    p = nextReleasePhase(p, "confirm");
    expect(p).toBe("confirm2");
    p = nextReleasePhase(p, "confirm");
    expect(p).toBe("running");
    expect(nextReleasePhase(p, "finish")).toBe("idle");
    expect(nextReleasePhase("confirm2", "cancel")).toBe("idle");
    expect(nextReleasePhase("idle", "confirm")).toBe("idle");
  });

  it("new keys exist in both vi and en", () => {
    for (const k of RELEASE_I18N_KEYS) {
      expect((dicts.vi as Record<string, string>)[k], `vi ${k}`).toBeTruthy();
      expect((dicts.en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
    }
    for (const k of RELCFG_I18N_KEYS) {
      expect((dicts.vi as Record<string, string>)[k], `vi ${k}`).toBeTruthy();
      expect((dicts.en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
    }
    expect(dicts.vi.relcfg_cancel_warning).toContain("script có thể đang giữ khóa deploy trên máy chủ, có thể chặn các lần deploy sau 40 phút");
    expect(dicts.vi.release_hint).not.toMatch(/Không push, không tạo tag\.$/);
  });
});
