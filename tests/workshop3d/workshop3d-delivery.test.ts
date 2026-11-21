import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { deliveryDir, syncDelivery, titleSlug } from "../../src/core/workshop3d/delivery.js";

describe("delivery folder", () => {
  it("makes an ASCII folder name from a Vietnamese title", () => {
    expect(titleSlug("Cabin thang máy khách inox vàng Đẹp")).toBe("cabin-thang-may-khach-inox-vang-dep");
    expect(titleSlug("???")).toBe("mo-hinh");
    expect(deliveryDir("D:/out", "2026-x", "Cabin")).toBe(path.join("D:/out", "workshop3d", "2026-x-cabin"));
  });

  it("mirrors the deliverables, skips working files, copies once", () => {
    const s = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-del-s-"));
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-del-d-"));
    for (const f of ["outputs/model.glb", "outputs/.build-ok", "outputs/parts/p1.step", "outputs/trinh-bay/index.html", "renders/hq/a.png", "renders/quick.png", "REPORT.md"]) {
      fs.mkdirSync(path.dirname(path.join(s, f)), { recursive: true });
      fs.writeFileSync(path.join(s, f), "x");
    }
    expect(syncDelivery(s, d)).toBe(4);
    expect(fs.existsSync(path.join(d, "model.glb"))).toBe(true);
    expect(fs.existsSync(path.join(d, "trinh-bay", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(d, "anh-blender", "a.png"))).toBe(true);
    expect(fs.existsSync(path.join(d, ".build-ok"))).toBe(false);
    expect(fs.existsSync(path.join(d, "parts"))).toBe(false);
    expect(syncDelivery(s, d)).toBe(0);
  });
});
