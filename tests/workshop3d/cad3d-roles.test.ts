import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFile, fold, readCatalog, searchCatalog } from "../../src/core/roles/role-catalog.js";
import { SAFE_AGENT_TOOLS, validateExtraAgents } from "../../src/core/run/extras.js";

const SHIPPED = readCatalog(catalogFile(path.resolve(__dirname, "..", "..")));
const IDS = ["elevator-3d-designer", "cad-modeler", "model-3d-reviewer", "render-presenter"];
const ROLES = SHIPPED.filter((r) => IDS.includes(r.id));
// Company and competitor names, spelled in pieces so the names themselves are not in the repo.
const BANNED = ["tn" + "f", "b" + "ke", "bach " + "khoa", "ot" + "is", "ko" + "ne", "schind" + "ler", "mitsu" + "bishi"];

describe("3D/CAD roles in the shipped catalog", () => {
  it("has all four ids", () => {
    expect(ROLES.map((r) => r.id).sort()).toEqual([...IDS].sort());
  });

  it("has no duplicate ids in the whole catalog", () => {
    expect(new Set(SHIPPED.map((r) => r.id)).size).toBe(SHIPPED.length);
  });

  it("uses only safe tools, never Bash, and passes validateExtraAgents", () => {
    for (const r of ROLES) {
      const tools = r.tools ?? [];
      expect(tools).not.toContain("Bash");
      for (const t of tools) expect(SAFE_AGENT_TOOLS as readonly string[]).toContain(t);
      expect(() => validateExtraAgents({ [r.id]: { description: r.description, prompt: r.prompt, tools: r.tools } }, [])).not.toThrow();
    }
  });

  it("keeps the reviewer read-only", () => {
    const rev = ROLES.find((r) => r.id === "model-3d-reviewer");
    expect(rev?.tools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("respects prompt and description length limits", () => {
    for (const r of ROLES) {
      expect(r.prompt.length).toBeGreaterThan(0);
      expect(r.prompt.length).toBeLessThanOrEqual(4000);
      expect(r.description.length).toBeGreaterThanOrEqual(1);
      expect(r.description.length).toBeLessThanOrEqual(300);
    }
  });

  it("finds elevator-3d-designer first among the 3D roles by unaccented 'thang may'", () => {
    const found = searchCatalog(SHIPPED, "thang may");
    expect(found.map((r) => r.id)).toContain("elevator-3d-designer");
    const mine = found.filter((r) => IDS.includes(r.id));
    expect(mine).toHaveLength(4);
    expect(mine[0]?.id).toBe("elevator-3d-designer");
  });

  it("tags every role with 3d, cad, thang may and mau san pham", () => {
    for (const r of ROLES) {
      const tags = r.tags.map(fold);
      for (const t of ["3d", "cad", "thang may", "mau san pham"]) expect(tags).toContain(t);
    }
  });

  it("makes cad-modeler write STEP, STL, GLB in mm", () => {
    const p = ROLES.find((r) => r.id === "cad-modeler")?.prompt ?? "";
    for (const w of ["STEP", "STL", "GLB", "mm", "OUTPUT_DIR"]) expect(p).toContain(w);
  });

  it("marks missing values as needing user confirmation in the elevator designer", () => {
    const p = ROLES.find((r) => r.id === "elevator-3d-designer")?.prompt ?? "";
    expect(p).toContain("cần người dùng xác nhận");
    expect(p).not.toMatch(/EN\s*81/i);
  });

  it("has no brand words in name, description or tags", () => {
    for (const r of ROLES) {
      const text = fold([r.name, r.description, ...r.tags].join(" "));
      for (const b of BANNED) expect(text).not.toContain(b);
    }
  });
});
