// REAL Blender on a tiny hollow cabin (tests/fixtures/workshop3d/tiny-cabin.glb); skipped when Blender is not installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { W3D_BLENDER_DEFAULTS } from "../../src/core/app/config.js";
import { BLENDER_GLB, exportBlenderGlb, findBlender, readHqManifest, renderHq } from "../../src/core/workshop3d/blender.js";
import { isBlank, pngStats } from "../../src/core/workshop3d/png.js";
import { initialSnapshot } from "../../src/core/workshop3d/state.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";

const blender = findBlender();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-blender-real-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MATERIALS = {
  materials: {
    san_da: { color: [0.35, 0.05, 0.03], metallic: 0, roughness: 0.2, texture: { kind: "granite", scale: 60, angle: 0 } },
    tran: { color: [0.9, 0.9, 0.9], metallic: 0, roughness: 0.6 },
    vach_sau: { color: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.3, texture: { kind: "hairline", scale: 40, angle: 0 } },
    vach_trai: { color: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.3, texture: { kind: "hairline", scale: 40, angle: 0 } },
    vach_phai_guong: { color: [0.95, 0.96, 0.97], metallic: 1, roughness: 0.03 },
    canh_cua: { color: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.25, texture: { kind: "brushed", scale: 40, angle: 0 } },
    cop_tam: { color: [0.7, 0.7, 0.72], metallic: 1, roughness: 0.3 },
    den_tran: { color: [1, 1, 1], metallic: 0, roughness: 0.5, emissive: [1, 0.97, 0.9] },
  },
};

describe.skipIf(!blender)("real Blender (skipped without Blender)", () => {
  it("renders two interior views of a tiny cabin, checkpoints them and exports a valid GLB", async () => {
    const store = createW3DStore(tmp);
    const slug = store.create({ title: "Tiny", object: "cabin", params: {}, detail: "standard", attachments: [] }, initialSnapshot({}));
    const dir = store.dir(slug);
    fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, "../fixtures/workshop3d/tiny-cabin.glb"), path.join(dir, "outputs", "model.glb"));
    fs.writeFileSync(path.join(dir, "materials.json"), JSON.stringify(MATERIALS));
    const cfg = { ...W3D_BLENDER_DEFAULTS, width: 160, height: 120, samples: 4, device: "cpu" as const, perImageTimeoutSec: 300, views: ["door", "cop"] };
    const r = await renderHq(store, slug, cfg, { blender, libraryDir: null, polyhavenDir: null }, { profile: "final" });
    expect(r.failed).toEqual([]);
    expect(r.files).toEqual(["renders/hq/door.png", "renders/hq/cop.png"]);
    for (const f of r.files) {
      const st = pngStats(fs.readFileSync(path.join(dir, f)))!;
      expect(st).not.toBeNull();
      expect(isBlank(st)).toBe(false);
    }
    // no Poly Haven folder: the procedural fallback is used and said so
    expect(r.warnings.join(" ")).toMatch(/Poly Haven|HDRI/);
    expect(Object.keys(readHqManifest(dir)!.views)).toEqual(["door", "cop"]);
    const g = await exportBlenderGlb(store, slug, cfg, { blender, libraryDir: null, polyhavenDir: null });
    expect(g.warning ?? null).toBeNull();
    expect(g.ok).toBe(true);
    expect(fs.statSync(path.join(dir, BLENDER_GLB)).size).toBeGreaterThan(1000);
  }, 900_000);
});
