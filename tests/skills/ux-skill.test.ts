import { describe, it, expect } from "vitest";
import { UX_SKILL_NAME, MAX_UX_BLOCK_BYTES, wantsUxSkill, stripUxSkill, buildUxSkillBlock, appendUxBlock, applyUxSkill } from "../../src/core/roles/ux-skill.js";

const block = buildUxSkillBlock({ skillDir: "C:\\repo\\config\\skills\\ui-ux-pro-max", notesDir: "C:\\runs\\r1\\notes" });
const roles = () => ({ implementer: { prompt: "BASE" }, qa: { prompt: "QA" } });

describe("wantsUxSkill", () => {
  it("matches accented and unaccented keywords", () => {
    expect(wantsUxSkill("Sửa giao diện trang chủ", [], "coding")).toBe(true);
    expect(wantsUxSkill("doi man hinh login", [], "coding")).toBe(true);
    expect(wantsUxSkill("Đăng nhập dashboard", [], "coding")).toBe(true);
  });
  it("is false for non-UI prompts, research kind, empty prompt", () => {
    expect(wantsUxSkill("fix the database migration", [], "coding")).toBe(false);
    expect(wantsUxSkill("build the quiz", [], "coding")).toBe(false);
    expect(wantsUxSkill("redesign the UI", [], "research")).toBe(false);
    expect(wantsUxSkill("", [], "coding")).toBe(false);
  });
  it("explicit skill wins for coding", () => {
    expect(wantsUxSkill("", [UX_SKILL_NAME], "coding")).toBe(true);
  });
});

describe("stripUxSkill", () => {
  it("keeps other skills", () => {
    expect(stripUxSkill(["a", UX_SKILL_NAME, "b"])).toEqual(["a", "b"]);
  });
});

describe("buildUxSkillBlock", () => {
  it("has required flags and fallback", () => {
    expect(block).toContain("-X utf8 -I");
    expect(block).toContain("--design-system");
    expect(block).toContain("--persist");
    expect(block).toContain("--output-dir");
    expect(block).toContain("py -3");
    expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(MAX_UX_BLOCK_BYTES);
  });
  it("every command line has --output-dir", () => {
    const cmds = block.split("\n").filter((l) => /search\.py/.test(l) && /--design-system/.test(l));
    expect(cmds.length).toBeGreaterThan(0);
    for (const l of cmds) expect(l).toContain("--output-dir");
  });
});

describe("appendUxBlock", () => {
  it("does not mutate the input", () => {
    const r = roles();
    const out = appendUxBlock(r, "X");
    expect(r.implementer.prompt).toBe("BASE");
    expect(out.implementer.prompt).toBe("BASE\n\nX");
  });
  it("returns roles unchanged without implementer", () => {
    const r = { qa: { prompt: "QA" } };
    expect(appendUxBlock(r, "X")).toBe(r);
  });
});

describe("applyUxSkill", () => {
  const base = { skills: [UX_SKILL_NAME, "s"], kind: "coding", repoRoot: "C:\\repo", runDir: "C:\\runs\\r1" };
  it("applies when the script exists", () => {
    const o = applyUxSkill({ ...base, roles: roles(), prompt: "làm lại giao diện", exists: () => true });
    expect(o.applied).toBe(true);
    expect(o.roles.implementer!["prompt"]).toContain("--persist");
    expect(o.skills).toEqual(["s"]);
  });
  it("keeps roles when the script is missing", () => {
    const r = roles();
    const o = applyUxSkill({ ...base, roles: r, prompt: "giao diện", exists: () => false });
    expect(o.applied).toBe(false);
    expect(o.roles).toBe(r);
    expect(o.skills).toEqual(["s"]);
  });
  it("leaves the prompt identical for non-UI runs", () => {
    const r = roles();
    const o = applyUxSkill({ ...base, skills: [], roles: r, prompt: "fix parser bug", exists: () => true });
    expect(o.applied).toBe(false);
    expect(o.roles.implementer!["prompt"]).toBe("BASE");
  });
});
