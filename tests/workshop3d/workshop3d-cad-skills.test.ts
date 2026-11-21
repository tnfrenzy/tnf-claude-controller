import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { CAD_SKILLS_DIR, MAX_SKILLS, cadSkillsText, loadCadSkills, pickCadSkills } from "../../src/core/workshop3d/cad-skills.js";
import { buildPrompt as promptFor } from "../../src/core/workshop3d/prompts.js";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";

describe("cad skills library", () => {
  const skills = loadCadSkills();

  it("loads the shipped skills with keywords", () => {
    expect(skills.length).toBeGreaterThanOrEqual(5);
    for (const s of skills) {
      expect(s.keywords.length, s.id).toBeGreaterThan(0);
      expect(s.text, s.id).toContain("```python");
    }
  });

  it("picks by accent-insensitive keywords, best first, at most MAX_SKILLS", () => {
    const hay = "Cabin có vòm cổng, cột Ionic, sàn đá ghép hoa văn ngôi sao, trần có đèn downlight, vách inox sọc xen kẽ gương";
    const got = pickCadSkills(hay, skills);
    expect(got.length).toBeLessThanOrEqual(MAX_SKILLS);
    expect(got.length).toBeGreaterThan(0);
    expect(pickCadSkills("hộp đựng bút", skills)).toEqual([]);
    expect(cadSkillsText("hoa van san da ghep", skills)).toContain("san-hoa-van");
  });

  it("puts skills and lessons into the cad-modeler prompt only", () => {
    const ctxBase = { brief: { title: "t", object: "cabin", params: { w: 1100 }, detail: "standard", attachments: [] }, round: 0, skills: "### vom-cot\nmẫu", lessons: "- 2026-11-13: lỗi" } as never;
    const p = promptFor("cad-modeler", ctxBase);
    expect(p).toContain("Mẫu dựng đã kiểm chứng");
    expect(p).toContain("Bài học từ các lần dựng trước");
    expect(promptFor("material-artist", ctxBase)).not.toContain("Mẫu dựng đã kiểm chứng");
  });

  const py = findCadPython(process.env, null);
  it.skipIf(!py)("every shipped snippet really runs with the CAD python", () => {
    const script = `
import re, glob, math, sys
import cadquery as cq
def box(w, d, h, x=0.0, y=0.0, z=0.0):
    return cq.Workplane("XY").box(w, d, h, centered=(True, True, False)).translate((x, y, z))
def split_panels(length, count, gap):
    return (length - (count - 1) * gap) / count
n = 0
for f in sorted(glob.glob(sys.argv[1] + "/*.md")):
    code = re.search(r"\`\`\`python\\n(.*?)\`\`\`", open(f, encoding="utf-8").read(), re.S).group(1)
    g = dict(cq=cq, math=math, box=box, split_panels=split_panels)
    exec(code, g)
    for m in re.finditer(r"^# TEST: (.*)$", code, re.M):
        assert eval(m.group(1), g).val().Volume() > 0, f
        n += 1
print("tests", n)
`;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w3d-skill-")), "check.py");
    fs.writeFileSync(file, script);
    const r = spawnSync(py!, [file, CAD_SKILLS_DIR], { encoding: "utf8", timeout: 170000 });
    expect(r.stderr || "").not.toMatch(/Traceback/);
    expect(r.stdout).toMatch(/tests \d+/);
  }, 180000);
});
