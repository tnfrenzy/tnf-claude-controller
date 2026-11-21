import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSession, gradeRound, attachSample, upgradeSession, UPGRADE_DEFAULT_NOTE } from "../../src/core/roles/skill-session.js";
import { buildSamplePrompt } from "../../src/core/skill-workshop/sample-steps.js";

const sample = { files: [{ format: "docx" as const, name: "sample.docx" }], summary: "s", costUsd: 0 };
function completed() {
  let s = createSession({ brief: "b", agents: [], now: "t0" });
  s = attachSample(s, { n: 1, sample, now: "t1" });
  return gradeRound(s, { score: 100, feedback: "", now: "t2" });
}

describe("upgradeSession", () => {
  it("reopens a completed session with a new generating round", () => {
    const s = upgradeSession(completed(), { note: "  thêm bảng so sánh ", now: "t3" });
    expect(s.status).toBe("generating");
    expect(s.rounds).toHaveLength(2);
    expect(s.rounds[1]).toMatchObject({ n: 2, feedbackIn: "thêm bảng so sánh" });
    expect(s.rounds[0]!.score).toBe(100);
  });
  it("uses a default note and refuses a session that is not completed", () => {
    expect(upgradeSession(completed(), { note: "", now: "t3" }).rounds[1]!.feedbackIn).toBe(UPGRADE_DEFAULT_NOTE);
    expect(() => upgradeSession(createSession({ brief: "b", agents: [], now: "t0" }), { note: "", now: "t1" })).toThrow();
  });
  it("puts the upgrade direction in the sample prompt", () => {
    const p = buildSamplePrompt({ brief: "b", agents: [], round: 2, feedbackHistory: [], upgradeNote: "thêm bảng so sánh" });
    expect(p).toContain("NÂNG CẤP");
    expect(p).toContain("thêm bảng so sánh");
  });
});

describe("training room survives closing", () => {
  it("tower popup reopens the server session and offers the upgrade button", () => {
    const popup = readFileSync("ui/src/components/skills/SkillFloorPopup.tsx", "utf8");
    expect(popup).toContain("skillsGenGet");
    expect(popup).toContain("resumeSlug");
    const form = readFileSync("ui/src/components/skills/GenerativeTrainForm.tsx", "utf8");
    expect(form).toContain("skillsGenUpgrade");
    expect(form).toContain('t("skillg_upgrade")');
  });
});
