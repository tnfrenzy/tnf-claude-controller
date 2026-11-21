import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachPicker, formatFileSize } from "../../ui/src/components/common/AttachPicker";
import { AddSkillFloorForm } from "../../ui/src/pages/AddSkillFloorForm";

const noop = () => undefined;
const render = (files: { name: string; size: number }[]) =>
  renderToStaticMarkup(createElement(AttachPicker, { label: "L", files, onAdd: noop, onRemove: noop }));

describe("AttachPicker", () => {
  it("formats sizes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
  it("warns for binary files only", () => {
    expect(render([{ name: "a.dwg", size: 10 }])).toContain("Agent chỉ đọc được văn bản/JSON/CSV");
    expect(render([{ name: "a.txt", size: 10 }])).not.toContain("Agent chỉ đọc được");
  });
  it("shows a remove button with aria-label", () => {
    expect(render([{ name: "a.txt", size: 10 }])).toContain('aria-label="Xóa tệp: a.txt"');
  });
});

describe("AddSkillFloorForm attachments", () => {
  it("has two add-file buttons per pair (2 pairs = 4)", () => {
    const html = renderToStaticMarkup(createElement(AddSkillFloorForm, { onDone: noop }));
    expect((html.match(/>Thêm tệp</g) ?? []).length).toBe(4);
  });
});

describe("layout (static CSS check; real 375/1280 px is a manual QA step)", () => {
  const src = [
    readFileSync("ui/src/components/common/AttachPicker.tsx", "utf8"),
    readFileSync("ui/src/pages/AddSkillFloorForm.tsx", "utf8")
  ].join("\n");
  it("picker rows wrap and can shrink", () => {
    const picker = readFileSync("ui/src/components/common/AttachPicker.tsx", "utf8");
    expect(picker).toContain('flexWrap: "wrap"');
    expect(picker).toContain("minWidth: 0");
  });
  it("no fixed pixel width above 340", () => {
    for (const m of src.matchAll(/\b(?:width|minWidth)\s*:\s*(\d+)\b/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(340);
    }
  });
});
