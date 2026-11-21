import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GenerativeTrainForm } from "../../ui/src/components/skills/GenerativeTrainForm.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";

const SRC = readFileSync(new URL("../../ui/src/components/skills/GenerativeTrainForm.tsx", import.meta.url), "utf8");
const html = renderToStaticMarkup(
  createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, createElement(GenerativeTrainForm, { onDone: () => {} })),
);

describe("GenerativeTrainForm input stage", () => {
  it("renders brief, name, max rounds fields and start button", () => {
    expect(html).toContain('id="skillg-description"');
    expect(html).toContain('id="skillg-title"');
    expect(html).toContain('id="skillg-max-rounds"');
    expect(html).toContain("Bắt đầu tạo skill");
  });
  it("source has the start flow and error codes", () => {
    for (const k of ["createSkill", "skillsGenStart", "skillsGenFindRoles", "skillsGenCreateAgents", "skillsGenFindGithub", "session_exists", "skill_exists", "validateMaxRounds"]) {
      expect(SRC).toContain(k);
    }
  });
  it("part 2 source and static render", () => {
    for (const k of ["skillsGenGet", "isFinderBusy", "clearInterval", "gen.roles", "gen.repos", "session.agents", "finder.error"]) {
      expect(SRC).toContain(k);
    }
    expect(html).not.toContain("Vai ưu tiên");
    expect(html).not.toContain("Agent được tạo");
  });
  it("part 3 grading and download", () => {
    for (const k of ["skillsGenGrade", "validateScore", "downloadSkillsGenMd", "canDownload", "skill_missing_md"]) {
      expect(SRC).toContain(k);
    }
    expect(html).not.toContain("Tải skill");
    expect(html).not.toContain("Huấn luyện tiếp");
  });
  it("fits 375 px and wraps", () => {
    for (const m of SRC.matchAll(/(?:width|minWidth)\s*[:=]\s*\{?\s*(\d+)/g)) expect(Number(m[1])).toBeLessThanOrEqual(375);
    expect(SRC).toMatch(/flexWrap|overflowWrap/);
  });
});
