// tests/workshop3d-roles.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { W3D_ROLES_FILE, loadW3DRoles } from "../../src/core/workshop3d/roles.js";
import { WORKSHOP3D_ROLES } from "../../src/core/workshop3d/types.js";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";
import { checkScript } from "../../src/core/workshop3d/script-check.js";

const realPython = findCadPython();

describe("config/roles-design3d.json", () => {
  const roles = loadW3DRoles(W3D_ROLES_FILE);
  it("defines exactly the nine roles", () => {
    expect(Object.keys(roles).sort()).toEqual([...WORKSHOP3D_ROLES].sort());
  });
  it("every role is read-only and has a Vietnamese-reply instruction", () => {
    for (const id of WORKSHOP3D_ROLES) {
      expect(roles[id].tools).toEqual(["Read"]);
      expect(roles[id].prompt).toMatch(/Vietnamese/);
      expect(roles[id].prompt).toMatch(/untrusted/i);
    }
  });
  it("names the output contract each parser expects", () => {
    expect(roles["cad-modeler"].prompt).toMatch(/```python/);
    expect(roles["cad-modeler"].prompt).toMatch(/OUTPUT_DIR|sys\.argv\[1\]/);
    expect(roles["cad-modeler"].prompt).toMatch(/parts\//);
    for (const id of ["tiep-nhan-3d", "art-director", "detail-planner", "material-artist", "render-director", "visual-reviewer", "ar-optimizer"] as const) {
      expect(roles[id].prompt).toMatch(/```json/);
    }
    expect(roles["visual-reviewer"].prompt).toMatch(/beauty/);
    expect(roles["detail-planner"].prompt).toMatch(/bbox_mm/);
  });
  it("detail-planner: bbox_mm is the OUTER box of all parts, not the clear size", () => {
    const p = roles["detail-planner"].prompt;
    expect(p).toMatch(/OUTER bounding box of ALL parts/);
    for (const w of ["frames", "sills", "protrusions", "not the clear"]) expect(p).toContain(w);
    expect(p).not.toMatch(/Overall dimensions must match the brief params exactly/);
  });
  it("cad-modeler: PARAMS keys = brief params keys, safe fillets, the Assembly export line, every plan id gets an STL", () => {
    const p = roles["cad-modeler"].prompt;
    expect(p).toMatch(/PARAMS keys must be the brief params keys verbatim/);
    expect(p).toMatch(/try\/except/);
    expect(p).toMatch(/thinner than 3 mm/);
    expect(p).not.toMatch(/every exposed edge gets a fillet/);
    expect(p).toContain('assy.export(os.path.join(OUTPUT_DIR, "model.step"))');
    expect(p).toMatch(/never pass a cq\.Assembly to cq\.exporters\.export/i);
    expect(p).toMatch(/EVERY part id/);
  });
  it("render-director asks for interior views of hollow objects; visual-reviewer treats an unseen part as a render issue", () => {
    const r = roles["render-director"].prompt;
    expect(r).toMatch(/interior view/i);
    expect(r).toMatch(/below half of the smallest horizontal dimension/);
    expect(r).not.toMatch(/all four sides/);
    const v = roles["visual-reviewer"].prompt;
    expect(v).toMatch(/not visible from any camera is a render issue/);
    expect(v).toMatch(/do not demand geometry changes for parts that simply are not in view/);
  });
  it("material-artist names the texture kinds and the mirror/lamp/stone/hairline defaults; render-director the camera rules", () => {
    const m = roles["material-artist"].prompt;
    for (const k of ["hairline", "brushed", "granite", "marble", "wood", "fabric", "library"]) expect(m).toContain(k);
    expect(m).toMatch(/roughness 0\.02/);
    // the Blender step tells a glass mirror (roughness <= 0.01) from mirror stainless (0.02 to 0.08): w3d_bscene.mirror_kind
    expect(m).toMatch(/true glass mirror = the same with roughness 0/);
    expect(m).toMatch(/0\.02 to 0\.08 renders mirror stainless/);
    expect(m).toMatch(/red \[0\.45, 0\.14, 0\.11\], black \[0\.05, 0\.05, 0\.055\]/);
    expect(m).toMatch(/0 = lines and grain run vertically/);
    expect(m).toMatch(/every lamp must have emissive/);
    const r = roles["render-director"].prompt;
    expect(r).toMatch(/optional target \(a part id/);
    expect(r).toMatch(/never stands inside a wall/);
    expect(r).toMatch(/ALSO adds every interior view/);
  });
  it("ar-optimizer reads the numbers that build.json really has", () => {
    const p = roles["ar-optimizer"].prompt;
    for (const k of ["triangles", "glbBytes", "parts", "texturePx", "textures"]) expect(p).toContain(k);
  });
  it.skipIf(!realPython)("the cad-modeler skeleton passes the script guard (real python)", async () => {
    const p = roles["cad-modeler"].prompt;
    const blocks = [...p.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1]!);
    const skeleton = blocks[blocks.length - 1]!;
    expect(skeleton).toContain("assy = cq.Assembly()");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-skel-"));
    try {
      const f = path.join(dir, "model.py");
      fs.writeFileSync(f, skeleton, "utf8");
      const r = await checkScript(f, { python: realPython });
      expect(r, r.errors.join("\n")).toEqual({ ok: true, errors: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects a file missing a role or with a writing tool", () => {
    expect(() => loadW3DRoles("tests/fixtures/does-not-exist.json")).toThrow();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-roles-"));
    try {
      const good = JSON.parse(fs.readFileSync(W3D_ROLES_FILE, "utf8")) as Record<string, { tools: string[] }>;
      const missing = { ...good };
      delete missing["art-director"];
      const f1 = path.join(dir, "missing.json");
      fs.writeFileSync(f1, JSON.stringify(missing));
      expect(() => loadW3DRoles(f1)).toThrow(/art-director/);
      const writing = { ...good, "cad-modeler": { ...good["cad-modeler"]!, tools: ["Write"] } };
      const f2 = path.join(dir, "writing.json");
      fs.writeFileSync(f2, JSON.stringify(writing));
      expect(() => loadW3DRoles(f2)).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
