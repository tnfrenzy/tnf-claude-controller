import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fillTemplate, loadKit, validateKit, type Design3dKit } from "../../src/core/design3d/design3d-kit.js";

const ROOT = path.resolve(__dirname, "..", "..");
const ROLES = ["cad-modeler", "elevator-3d-designer", "model-3d-reviewer", "render-presenter"];
const CATALOG = new Set([...ROLES, "other-role"]);

function tpl(over: Record<string, unknown> = {}, id = "t1"): Record<string, unknown> {
  return {
    id,
    label: "Mẫu",
    prompt: "Rộng {{width}} sâu {{depth}} cao {{height}} vật liệu {{material}}",
    formats: ["step"],
    ...over,
  };
}
function kitRaw(templates: unknown[] = [tpl({}, "a"), tpl({}, "b"), tpl({}, "c"), tpl({}, "d")], roles: unknown = ROLES) {
  return { roles, templates };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-kit-"));
  fs.mkdirSync(path.join(dir, "config"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("shipped config/design3d-kit.json", () => {
  it("loads and validates against the real role catalog", () => {
    const kit = loadKit(ROOT);
    expect(kit.roles).toEqual(ROLES);
    expect(kit.templates.length).toBeGreaterThanOrEqual(4);
    expect(kit.templates.length).toBeLessThanOrEqual(6);
  });
  it("fills every shipped template with valid params", () => {
    const kit = loadKit(ROOT);
    for (const t of kit.templates) {
      const out = fillTemplate(kit, t.id, { width: 1400, depth: "1600", height: 2300, material: "Kính cường lực" });
      expect(out.prompt).not.toMatch(/\{\{|\}\}/);
      expect(out.prompt).toContain("1400");
      expect(out.prompt).toContain("Kính cường lực");
      expect(out.formats).toEqual(t.formats);
    }
  });
});

describe("validateKit", () => {
  it("accepts a valid kit", () => {
    expect(validateKit(kitRaw(), CATALOG).roles).toEqual(ROLES);
  });
  it("rejects a role missing from the catalog", () => {
    expect(() => validateKit(kitRaw(undefined, [...ROLES, "ghost-role"]), CATALOG)).toThrow(/ghost-role/);
    expect(() => validateKit(kitRaw(), new Set(["cad-modeler"]))).toThrow(/không có trong danh mục/);
  });
  it("rejects bad role ids, duplicates and empty roles", () => {
    expect(() => validateKit(kitRaw(undefined, ["Bad Id"]), CATALOG)).toThrow(/id vai/);
    expect(() => validateKit(kitRaw(undefined, ["cad-modeler", "cad-modeler"]), CATALOG)).toThrow(/trùng/);
    expect(() => validateKit(kitRaw(undefined, []), CATALOG)).toThrow(/roles/);
  });
  it("rejects empty or unknown formats", () => {
    const four = (over: Record<string, unknown>) => [tpl(over, "a"), tpl({}, "b"), tpl({}, "c"), tpl({}, "d")];
    expect(() => validateKit(kitRaw(four({ formats: [] })), CATALOG)).toThrow(/định dạng/);
    expect(() => validateKit(kitRaw(four({ formats: ["obj"] })), CATALOG)).toThrow(/định dạng lạ/);
    expect(() => validateKit(kitRaw(four({ formats: ["step", "step"] })), CATALOG)).toThrow(/trùng/);
  });
  it("rejects wrong template count and prompt placeholder problems", () => {
    expect(() => validateKit(kitRaw([tpl({}, "a")]), CATALOG)).toThrow(/templates/);
    const four = (over: Record<string, unknown>) => [tpl(over, "a"), tpl({}, "b"), tpl({}, "c"), tpl({}, "d")];
    expect(() => validateKit(kitRaw(four({ prompt: "chỉ {{width}}" })), CATALOG)).toThrow(/thiếu chỗ điền/);
    expect(() => validateKit(kitRaw(four({ prompt: "{{width}}{{depth}}{{height}}{{material}}{{color}}" })), CATALOG)).toThrow(/tham số lạ/);
    expect(() => validateKit(kitRaw(four({ prompt: "x".repeat(2001) })), CATALOG)).toThrow(/prompt/);
  });
});

describe("loadKit errors", () => {
  it("reports a roles-catalog.json that is not an array", () => {
    fs.writeFileSync(path.join(dir, "config", "design3d-kit.json"), JSON.stringify(kitRaw()));
    fs.writeFileSync(path.join(dir, "config", "roles-catalog.json"), JSON.stringify({ roles: [] }));
    expect(() => loadKit(dir)).toThrow(/Danh mục vai phải là một mảng/);
  });
  it("reports missing and invalid kit files separately", () => {
    fs.writeFileSync(path.join(dir, "config", "roles-catalog.json"), "[]");
    expect(() => loadKit(dir)).toThrow(/Không đọc được/);
    fs.writeFileSync(path.join(dir, "config", "design3d-kit.json"), "{not json");
    expect(() => loadKit(dir)).toThrow(/không phải JSON/);
  });
});

describe("fillTemplate", () => {
  const kit: Design3dKit = validateKit(kitRaw(), CATALOG);
  const ok = { width: 1100, depth: 1400, height: 2200, material: "Inox 304" };

  it("fills numbers, numeric strings and accented material", () => {
    const out = fillTemplate(kit, "a", { ...ok, width: "1100", material: "Kính cường lực" });
    expect(out.prompt).toBe("Rộng 1100 sâu 1400 cao 2200 vật liệu Kính cường lực");
    expect(out.formats).toEqual(["step"]);
  });
  it("rejects unknown template", () => {
    expect(() => fillTemplate(kit, "nope", ok)).toThrow(/Không có mẫu/);
  });
  it("rejects missing and extra params", () => {
    const { material: _m, ...missing } = ok;
    expect(() => fillTemplate(kit, "a", missing)).toThrow(/Thiếu tham số 'material'/);
    expect(() => fillTemplate(kit, "a", { ...ok, color: "red" })).toThrow(/Tham số lạ/);
  });
  it("rejects odd dimensions", () => {
    expect(() => fillTemplate(kit, "a", { ...ok, width: 12.5 })).toThrow(/width/);
    expect(() => fillTemplate(kit, "a", { ...ok, width: -5 })).toThrow(/width/);
    expect(() => fillTemplate(kit, "a", { ...ok, width: "12.5" })).toThrow(/width/);
    expect(() => fillTemplate(kit, "a", { ...ok, depth: "1e3" })).toThrow(/depth/);
    expect(() => fillTemplate(kit, "a", { ...ok, height: 0 })).toThrow(/height/);
    expect(() => fillTemplate(kit, "a", { ...ok, height: 20001 })).toThrow(/height/);
    expect(() => fillTemplate(kit, "a", { ...ok, width: null })).toThrow(/width/);
  });
  it("rejects odd materials", () => {
    for (const m of ["inox; rm -rf", "{{width}}", "a\nb", "<b>", "", "x".repeat(41)]) {
      expect(() => fillTemplate(kit, "a", { ...ok, material: m })).toThrow(/material/);
    }
    expect(() => fillTemplate(kit, "a", { ...ok, material: 5 })).toThrow(/material/);
  });
});
