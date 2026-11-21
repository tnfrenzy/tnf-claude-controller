import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVsStore } from "../../src/core/videostudio/store.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-dur-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("store setAssetDuration", () => {
  it("cap nhat duration va bao loi khi thieu tep", () => {
    const store = createVsStore(dir);
    const p = store.create({ title: "T", brief: "", styleId: "clean", aspect: "16:9" });
    const a = store.addAsset(p.slug, "a.mp4", Buffer.from("x"));
    expect(a.duration).toBeNull();
    store.setAssetDuration(p.slug, a.rel, 3.5);
    expect(store.listAssets(p.slug)[0]?.duration).toBe(3.5);
    expect(() => store.setAssetDuration(p.slug, "assets/none.mp4", 1)).toThrow(/Không tìm thấy/);
    expect(store.dir(p.slug)).toBe(path.join(dir, "videostudio", p.slug));
  });
});
