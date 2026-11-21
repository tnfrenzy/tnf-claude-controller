import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BATCH_DICTS, batchSummary, categoryLabel, checkFiles, fill, nameFromFile, parseSizeInputs, sizeLabel, type BatchStatus, type LibraryEntry,
} from "../../ui/src/components/workshop3d/batch-logic";
import { slabViewerApi } from "../../ui/src/components/workshop3d/materials-api";
import { popupFromHash } from "../../ui/src/lib/popup";
import { BATCH_CATEGORIES } from "../../src/core/workshop3d/material-library";

const LIM = { upload: 12, imageBytes: 10 * 1024 * 1024 };

describe("batch tab logic", () => {
  it("checks the picked files before upload", () => {
    expect(checkFiles([], LIM)?.key).toBe("mb_err_none");
    expect(checkFiles(Array.from({ length: 13 }, (_, i) => ({ name: `a${i}.jpg`, size: 1 })), LIM)).toEqual({ key: "mb_err_many", vars: { n: "12" } });
    expect(checkFiles([{ name: "a.gif", size: 1 }], LIM)?.key).toBe("mb_err_type");
    expect(checkFiles([{ name: "a.JPG", size: LIM.imageBytes + 1 }], LIM)?.key).toBe("mb_err_big");
    expect(checkFiles([{ name: "G01.jpg", size: 100 }, { name: "x.webp", size: 1 }, { name: "y.PNG", size: 1 }], LIM)).toBeNull();
  });
  it("names, sizes and summaries", () => {
    expect(nameFromFile("Đá Sàn G01.jpg")).toBe("Đá Sàn G01");
    expect(sizeLabel({ w: 1600, d: 1500, h: 20 })).toBe("1600 × 1500 × 20 mm");
    expect(parseSizeInputs("1600", "1500", "20")).toEqual({ w: 1600, d: 1500, h: 20 });
    expect(parseSizeInputs("0", "1500", "20")).toBeNull();
    expect(parseSizeInputs("1600", "1500", "abc")).toBeNull();
    const b = { items: [{ state: "done" }, { state: "failed" }, { state: "running", source: "G03.jpg" }, { state: "queued" }] } as unknown as BatchStatus;
    expect(batchSummary(b)).toEqual({ done: 1, failed: 1, total: 4, running: "G03.jpg" });
    expect(fill("{a}/{b} {c}", { a: "1", b: "2" })).toBe("1/2 {c}");
  });
  it("vi and en have the same keys, non-empty, and a label for every server category", () => {
    const vi = BATCH_DICTS.vi;
    const en = BATCH_DICTS.en;
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
    for (const v of [...Object.values(vi), ...Object.values(en)]) expect(v.trim()).not.toBe("");
    expect(vi.mb_tab).toBe("Tạo hàng loạt");
    for (const c of BATCH_CATEGORIES) {
      expect(categoryLabel(vi, c.id)).not.toBe(c.id);
      expect(categoryLabel(en, c.id)).not.toBe(c.id);
    }
    expect(vi.mb_cost).toMatch(/0 \$/);
  });
  it("the 3D desk reads a library slab through an adapter (slab.glb as the model, preview as the render)", async () => {
    const asked: string[] = [];
    const entry = { id: "g01", name: "G01", source: "G01.jpg", files: ["slab.glb", "preview.png"] } as LibraryEntry;
    const a = slabViewerApi(entry, { file: async (id, n) => { asked.push(`${id}/${n}`); return new Blob(["x"]); } });
    const d = await a.detail();
    expect(d.files).toEqual(["outputs/model.glb"]);
    expect(d.renders).toEqual(["renders/preview.png"]);
    expect(d.snapshot.state).toBe("done");
    await a.file("outputs/model.glb");
    await a.file("renders/preview.png");
    expect(asked).toEqual(["g01/slab.glb", "g01/preview.png"]);
    await expect(a.rebuild()).rejects.toThrow();
  });
  it("#/w3d-batch opens the workshop window on the batch tab", () => {
    expect(popupFromHash("#/w3d-batch")).toMatchObject({ open: "workshop3d", payload: { tab: "batch" } });
  });
  it("the popup registers the tab without touching the shared i18n.ts", () => {
    const src = fs.readFileSync(path.resolve("ui/src/components/workshop3d/Workshop3DPopup.tsx"), "utf8");
    expect(src).toMatch(/"batch"/);
    expect(src).toMatch(/<VariantsPanel /); // the tab is built around a master model
    // the "Thư viện đá" block was removed from the batch tab
    expect(fs.readFileSync(path.resolve("ui/src/components/workshop3d/VariantsPanel.tsx"), "utf8")).not.toMatch(/<MaterialLibraryPanel /);
    expect(fs.readFileSync(path.resolve("ui/src/i18n.ts"), "utf8")).not.toMatch(/mb_tab/);
  });
});
