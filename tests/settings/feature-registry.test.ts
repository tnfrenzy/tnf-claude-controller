import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendFeature, featuresPromptBlock, readFeatures } from "../../src/core/app/feature-registry.js";
import { QueueStore } from "../../src/core/queue/queue-store.js";
import { buildSplitterPrompt } from "../../src/core/ideas/queue-split.js";

describe("feature registry", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-feat-"));
  it("creates the file with a header, appends lines and skips duplicates", () => {
    const d = dir();
    expect(appendFeature(d, "p1", { title: "Thêm lệnh version", ref: "c1" })).toBe(true);
    expect(appendFeature(d, "p1", { title: "  thêm LỆNH version ", ref: "c2" })).toBe(false);
    expect(appendFeature(d, "p1", { title: "Xuất báo cáo" })).toBe(true);
    const text = readFeatures(d, "p1");
    expect(text).toContain("# Tính năng đã có");
    expect(text.match(/^- \[/gm)).toHaveLength(2);
    expect(featuresPromptBlock(d, "p1")).toContain("Xuất báo cáo");
    expect(featuresPromptBlock(d, "none")).toBe("");
  });
  it("splitter prompt carries the features block", () => {
    const p = buildSplitterPrompt({ idea: "thêm cache", webSearch: false, features: "- [2026-11-03] Thêm lệnh version" });
    expect(p).toContain("KHÔNG tạo lệnh cho tính năng nào đã nằm trong danh sách");
    expect(p).toContain("Thêm lệnh version");
  });
  it("a command reaching đã commit is recorded", () => {
    const d = dir();
    const q = new QueueStore(d);
    q.addCommands("proj", [{ id: "a1", title: "Thêm nút xóa", body: "Làm nút xóa ý tưởng", ideaTitle: "Hàng đợi" }], { hasRepo: true });
    q.transition("proj", "a1", "đã duyệt");
    q.transition("proj", "a1", "đang chạy");
    q.transition("proj", "a1", "đã commit");
    expect(readFeatures(d, "proj")).toContain("Hàng đợi: Thêm nút xóa");
  });
});
