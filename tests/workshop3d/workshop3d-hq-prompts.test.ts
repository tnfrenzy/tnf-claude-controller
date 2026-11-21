// visual-reviewer modes (geometry / final) and the `views` of final-review issues.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrompt, REVIEW_FINAL_TEXT, REVIEW_GEOMETRY_TEXT } from "../../src/core/workshop3d/prompts.js";
import { parseVerdict } from "../../src/core/workshop3d/role-output.js";
import { promptCtx } from "../../src/core/workshop3d/runner-helpers.js";

const brief = { title: "Cabin", object: "cabin", params: {}, detail: "standard" as const, attachments: [] };

describe("visual-reviewer modes", () => {
  it("geometry mode tells the reviewer to ignore everything the fast renderer gets wrong", () => {
    const p = buildPrompt("visual-reviewer", { ...promptCtx({ brief, renders: ["D:/s/renders/a.png"], reviewMode: "geometry" }), round: 1 });
    expect(p).toContain(REVIEW_GEOMETRY_TEXT);
    for (const w of ["phản chiếu gương", "ánh sáng", "độ chói", "texture", "màu sắc nền"]) expect(REVIEW_GEOMETRY_TEXT).toContain(w);
    expect(REVIEW_GEOMETRY_TEXT).toMatch(/KHÔNG nêu issue target material hoặc render/);
  });
  it("final mode judges everything and asks for the views of each material / render issue", () => {
    const p = buildPrompt("visual-reviewer", { ...promptCtx({ brief, renders: ["D:/s/renders/hq/door.png"], reviewMode: "final" }), round: 1 });
    expect(p).toContain(REVIEW_FINAL_TEXT);
    expect(REVIEW_FINAL_TEXT).toMatch(/likeness/);
    expect(REVIEW_FINAL_TEXT).toMatch(/views/);
    expect(p).toContain("renders/hq/door.png");
  });
  it("full mode (no Blender) prompt is unchanged", () => {
    const p = buildPrompt("visual-reviewer", { ...promptCtx({ brief, renders: ["D:/s/a.png"], reviewMode: "full" }), round: 0 });
    expect(p).not.toContain(REVIEW_GEOMETRY_TEXT);
    expect(p).not.toContain(REVIEW_FINAL_TEXT);
  });
  it("the role prompt knows about the review modes", () => {
    const roles = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/roles-design3d.json"), "utf8"));
    expect(roles["visual-reviewer"].prompt).toContain("CHẾ ĐỘ HÌNH HỌC");
    expect(roles["visual-reviewer"].prompt).toContain('"views"');
  });
});

describe("parseVerdict views", () => {
  const text = (issues: unknown[]) => "```json\n" + JSON.stringify({ scores: { beauty: 6, detail: 6, proportion: 6 }, ok: false, issues }) + "\n```";
  it("keeps valid view names (deduplicated), drops bad ones", () => {
    const r = parseVerdict(text([{ target: "material", text: "gương mờ", views: ["door", "door", "../x", "cop", 3] }]));
    expect(r.ok && r.value.issues[0]).toEqual({ target: "material", text: "gương mờ", views: ["door", "cop"] });
  });
  it("issues without views stay as before", () => {
    const r = parseVerdict(text([{ target: "geometry", text: "thiếu COP" }]));
    expect(r.ok && r.value.issues[0]).toEqual({ target: "geometry", text: "thiếu COP" });
  });
});
