// Blender interior light / metal clamp rules (tools/workshop3d/blender/w3d_blight.py, pure Python, no bpy).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";

const python = findCadPython();
const dir = path.resolve("tools/workshop3d/blender");

function py(expr: string): unknown {
  const code = `import json, sys; sys.path.insert(0, sys.argv[1]); import w3d_blight as L; print(json.dumps(${expr}))`;
  return JSON.parse(execFileSync(python!, ["-c", code, dir], { encoding: "utf8" }).trim());
}

describe.skipIf(!python)("w3d_blight.py", () => {
  it("clamps non-mirror metals and leaves non-metals alone", () => {
    expect(py("L.clamp_metal(1, 0.05)")).toEqual([0.92, 0.18]);
    expect(py("L.clamp_metal(1, 0.3)")).toEqual([0.92, 0.3]);
    expect(py("L.clamp_metal(0, 0.05)")).toEqual([0, 0.05]);
  });
  it("interior light power follows the cabin floor area and height, hidden ceiling panel seen by glossy only without mirrors", () => {
    type Light = { name: string; energy: number; glossy: boolean; up: boolean; z: number };
    const small = py("L.interior_lights(1.5, 1.6, 2.2, True)") as Light[];
    const big = py("L.interior_lights(2.0, 2.6, 2.2, True)") as Light[];
    const tall = py("L.interior_lights(2.0, 2.6, 3.0, False)") as Light[];
    expect(small.map((l) => l.name)).toEqual(["fill", "fill_up"]);
    expect(big[0]!.energy / small[0]!.energy).toBeCloseTo((2 * 2.6) / (1.5 * 1.6), 1);
    expect(tall[0]!.energy).toBeGreaterThan(big[0]!.energy);
    expect(small[0]!.glossy).toBe(true);
    expect(tall[0]!.glossy).toBe(false);
    expect(small[1]!.up).toBe(true);
    expect(small[1]!.glossy).toBe(false);
    expect(small[1]!.energy).toBeCloseTo(small[0]!.energy * 0.35, 0);
  });
});

describe("Blender scene uses the rules", () => {
  const bs = fs.readFileSync(path.join(dir, "w3d_bscene.py"), "utf8");
  it("every non-mirror metal path goes through clamp_metal, mirrors keep Metallic 1", () => {
    expect(bs).toMatch(/def plain_mat[\s\S]{0,80}L\.clamp_metal/);
    expect(bs).toMatch(/metal, rough = L\.clamp_metal\(1\.0, rough\)/);
    expect(bs).toMatch(/def mirror_mat[\s\S]{0,700}b\.inputs\["Metallic"\]\.default_value = 1\.0/);
  });
  it("interior lights are hidden from the camera", () => {
    expect(bs).toMatch(/L\.interior_lights\(/);
    expect(bs).toMatch(/lo\.visible_camera = False/);
    expect(fs.readFileSync(path.join(dir, "render_view.py"), "utf8")).toMatch(/glossy_ok=not S\.has_mirror\(spec, objs\)/);
  });
});
