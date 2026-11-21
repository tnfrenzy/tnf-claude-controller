import { describe, expect, it } from "vitest";
import { HINT_KEYS, getRunHint } from "../../ui/src/run/runHints.js";

const err = (error: string) => getRunHint({ status: "error", error });

describe("getRunHint", () => {
  it("returns null when the run did not fail", () => {
    expect(getRunHint({ status: "done", error: null })).toBeNull();
    expect(getRunHint({ status: "done", error: "CẢNH BÁO: repo gốc thay đổi trong lúc run" })).toBeNull();
  });
  it("max_turns -> resume", () => {
    const h = err("max_turns: hết lượt")!;
    expect(h.actions).toEqual(["resume"]);
    expect(h.titleKey).toBe("hint.maxTurns.title");
    expect(h.technical).toBe("max_turns: hết lượt");
  });
  it("max_budget -> raise_budget + resume", () => {
    expect(err("max_budget: vượt")!.actions).toEqual(["raise_budget", "resume"]);
  });
  it("result_error -> rerun", () => {
    expect(err("result_error: x")!.actions).toEqual(["rerun"]);
  });
  it("subagent_interrupted -> resume", () => {
    expect(err("subagent_interrupted: bị cắt")!.actions).toEqual(["resume"]);
  });
  it("billing guard -> contact_support", () => {
    const h = err("Cờ --bare bị cấm ở chế độ subscription: nó không dùng đăng nhập thuê bao")!;
    expect(h.actions).toEqual(["contact_support"]);
    expect(h.titleKey).toBe("hint.billing.title");
  });
  it("repo changed alone -> contact_support + rerun", () => {
    expect(err("CẢNH BÁO: repo gốc thay đổi trong lúc run (xem repo-check.txt).")!.actions).toEqual(["contact_support", "rerun"]);
  });
  it("prefix kept when the repo warning is appended, plus contact_support", () => {
    const s = "max_turns: hết lượt\nCẢNH BÁO: repo gốc thay đổi trong lúc run (xem repo-check.txt).";
    const h = err(s)!;
    expect(h.titleKey).toBe("hint.maxTurns.title");
    expect(h.actions).toEqual(["resume", "contact_support"]);
    expect(h.technical).toBe(s);
  });
  it("unknown prefix-less strings fall to generic", () => {
    for (const s of ["Tiến trình kết thúc không rõ lý do.", "weird stderr tail"]) {
      const h = err(s)!;
      expect(h.titleKey).toBe("hint.generic.title");
      expect(h.actions).toEqual(["rerun", "contact_support"]);
      expect(h.technical).toBe(s);
    }
  });
  it("only returns keys listed in HINT_KEYS", () => {
    for (const s of ["max_turns", "max_budget", "result_error", "subagent_interrupted", "Chưa đăng nhập Claude Code", "repo gốc thay đổi", "?"]) {
      const h = err(s)!;
      expect(HINT_KEYS).toContain(h.titleKey);
      expect(HINT_KEYS).toContain(h.bodyKey);
    }
  });
});
