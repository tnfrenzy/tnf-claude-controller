import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canGrade, roundPhase } from "../../ui/src/skills/skillGenForm";
import { dicts } from "../../ui/src/i18n";
import type { GenState, SkillSession } from "../../ui/src/types";

const sample = { files: [{ format: "docx" as const, name: "sample.docx" }], summary: "s", costUsd: 0.1 };
const gen = (final?: GenState["final"]): GenState => ({ roles: [], repos: [], finder: { status: "idle" }, ...(final ? { final } : {}) });
const sess = (status: SkillSession["status"], rounds: SkillSession["rounds"]) => ({ status, rounds });
const r = (withSample: boolean) => [{ n: 1, startedAt: "t", ...(withSample ? { sample } : {}) }];

describe("roundPhase / canGrade", () => {
  it("covers each status", () => {
    expect(roundPhase(sess("generating", r(false)), gen())).toBe("generating");
    expect(roundPhase(sess("awaiting_score", r(true)), gen())).toBe("ready_to_grade");
    expect(roundPhase(sess("paused", r(false)), gen())).toBe("paused");
    expect(roundPhase(sess("exhausted", r(false)), gen())).toBe("legacy_exhausted");
  });
  it("completed depends on gen.final", () => {
    const c = sess("completed", r(true));
    expect(roundPhase(c, gen({ status: "running" }))).toBe("finalizing");
    expect(roundPhase(c, gen({ status: "idle" }))).toBe("finalizing");
    expect(roundPhase(c, gen({ status: "done" }))).toBe("done");
    expect(roundPhase(c, gen({ status: "failed", error: "x" }))).toBe("final_failed");
    expect(roundPhase(c, gen())).toBe("done");
  });
  it("canGrade", () => {
    expect(canGrade(sess("awaiting_score", r(true)), gen())).toBe(true);
    expect(canGrade(sess("awaiting_score", r(false)), gen())).toBe(true); // legacy session
    expect(canGrade(sess("awaiting_score", [{ n: 1, startedAt: "t", sample }, { n: 2, startedAt: "t" }]), gen())).toBe(false);
    for (const s of ["generating", "paused", "completed", "exhausted"] as const) expect(canGrade(sess(s, r(true)), gen())).toBe(false);
  });
  it("has new i18n keys and api client", () => {
    const keys = ["skillg_generating_round", "skillg_download_docx", "skillg_download_xlsx", "skillg_round_summary", "skillg_continue", "skillg_finalizing", "skillg_retry", "skillg_legacy_exhausted", "skillg_find_github"];
    for (const k of keys) for (const l of ["vi", "en"] as const) expect((dicts[l] as Record<string, string>)[k]?.trim(), `${l}.${k}`).toBeTruthy();
    const api = readFileSync("ui/src/api.ts", "utf8");
    expect(api).toContain("downloadSkillsGenSample");
    expect(api).toContain("skillsGenGenerateSample");
    expect(api).toContain("skillsGenFinalize");
  });
});
