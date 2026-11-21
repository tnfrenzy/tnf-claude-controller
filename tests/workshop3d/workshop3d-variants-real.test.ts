// Real run: synthetic stone photo -> variant store -> real make_material.py (CAD python) -> slab -> merged into the fixture cabin
// -> gltf-validator reports 0 errors. Skipped without the CAD python.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";
import { parseGlb } from "../../src/core/workshop3d/glb.js";
import { createMaterialLibrary } from "../../src/core/workshop3d/material-library.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import { createVariantStore } from "../../src/core/workshop3d/variant-store.js";
import { slabSizeForSlot } from "../../src/core/workshop3d/variants.js";
import type { W3DBrief } from "../../src/core/workshop3d/types.js";

const python = findCadPython();
const REPO = path.resolve(__dirname, "..", "..");
let root: string;

beforeAll(() => {
  if (!python) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-variants-real-"));
  execFileSync(python, [path.join(REPO, "tests", "fixtures", "workshop3d", "gen_stone.py"), path.join(root, "stones")], { timeout: 180_000 });
}, 240_000);
afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!python)("variants with the real material pipeline", () => {
  it("photo + command -> stone slab sized to the floor slot -> valid merged GLB with the photo's textures", async () => {
    const lib = createMaterialLibrary({ dataDir: path.join(root, "data"), python: () => python });
    const store = createW3DStore(path.join(root, "data"));
    const brief: W3DBrief = { title: "Cabin", object: "cabin", params: {}, detail: "high", attachments: [], slots: [{ id: "floor", name: "Đá sàn", type: "material" }, { id: "wall", name: "Vách", type: "material", nodes: ["wall_left", "wall_right", "wall_back"] }] };
    const slug = store.create(brief);
    store.writeFile(slug, "outputs/model.glb", fs.readFileSync(path.join(REPO, "fixtures", "workshop3d-viewer", "model.glb")));
    const variants = createVariantStore({ lib });
    const sd = store.dir(slug);

    const up = lib.stageUpload("marble-white.jpg", fs.readFileSync(path.join(root, "stones", "marble-white.jpg")));
    const opt = variants.addMaterialOption(sd, brief, { command: "đá sàn trắng vân mây", upload: up.upload });
    expect(opt.slot).toBe("floor");
    await lib.idle();
    const ov = variants.overview(sd, brief);
    expect(ov.options[0]).toMatchObject({ state: "ready", slot: "floor" });
    const entry = lib.get(ov.options[0]!.materialId!)!;
    expect(entry.name).toBe("đá sàn trắng vân mây");
    // the slab was made at the slot's size (largest two extents of the floor box, thickness = the smallest)
    const floor = ov.slots.find((s) => s.id === "floor")!.size_mm!;
    expect(entry.size_mm).toEqual(slabSizeForSlot(floor));

    const wall = variants.addMaterialOption(sd, brief, { slot: "wall", command: "vách đá kem", materialId: entry.id });
    variants.startBatch(sd, brief, { floor: [opt.id], wall: [wall.id] });
    await variants.idle();
    const cfg = variants.overview(sd, brief).configs[0]!;
    expect(cfg.state, cfg.error).toBe("done");
    const glb = fs.readFileSync(variants.configFile(sd, cfg.id).abs);
    const { validateBytes } = await import("gltf-validator");
    const report = await validateBytes(new Uint8Array(glb));
    expect(report.issues.numErrors, JSON.stringify(report.issues.messages.slice(0, 5))).toBe(0);
    const g = parseGlb(glb);
    // floor and 3 walls each got their own material copy: 2 materials per slot use, with 3 textures (albedo, normal, MR) each
    expect(g.json.images.length).toBe(6);
    expect(g.json.textures.length).toBe(6);
    console.log(`config GLB ${(glb.length / 1024).toFixed(0)} KB, issues: warnings ${report.issues.numWarnings}`);
  }, 300_000);
});
