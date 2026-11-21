import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoStudioCreate } from "../../ui/src/components/videostudio/VideoStudioCreate";
import { BRIEF_SECONDS, VIDEO_TEMPLATES, applyTemplate, composeBrief, emptyBrief, hasPlaceholders, pointLines } from "../../ui/src/videostudio/briefTemplates";
import { buildDirectorPrompt } from "../../src/core/videostudio/agent";
import { validateStyle } from "../../src/core/videostudio/styles";
import type { VsStyle } from "../../src/core/videostudio/plan-types";

const read = (rel: string) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("composeBrief", () => {
  it("always states tone, target length and language; leaves out empty optional fields", () => {
    const b = composeBrief(emptyBrief());
    expect(b).toContain("Giọng điệu:");
    expect(b).toContain("Thời lượng mục tiêu: khoảng 30 giây");
    expect(b).toContain("Ngôn ngữ lời dẫn và chữ trên video: tiếng Việt");
    expect(b).not.toContain("Chủ đề");
    expect(b).not.toContain("Ý chính");
    expect(b).not.toContain("Kêu gọi hành động");
  });

  it("lists the key points in order, strips bullets and numbers, and keeps at most 12", () => {
    expect(pointLines("- Một\n2. Hai\n  * Ba\n\n  \n• Bốn")).toEqual(["Một", "Hai", "Ba", "Bốn"]);
    const many = Array.from({ length: 20 }, (_, i) => `Ý ${i + 1}`).join("\n");
    expect(pointLines(many)).toHaveLength(12);
    const b = composeBrief({ ...emptyBrief(), goal: "G", audience: "A", points: "- Một\n- Hai", cta: "Gọi ngay", notes: "Dùng màu xanh" });
    expect(b).toContain("Chủ đề / mục tiêu: G");
    expect(b).toContain("Người xem: A");
    expect(b).toContain("Ý chính (theo thứ tự):\n- Một\n- Hai");
    expect(b).toContain("Kêu gọi hành động ở cuối: Gọi ngay");
    expect(b).toContain("Ghi chú thêm: Dùng màu xanh");
  });

  it("every template stays under the brief limit and uses a known length", () => {
    expect(VIDEO_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const t of VIDEO_TEMPLATES) {
      const f = applyTemplate(t);
      expect(composeBrief(f).length, t.id).toBeLessThan(4000);
      expect(BRIEF_SECONDS as readonly number[], t.id).toContain(f.seconds);
      expect(f.goal.length, t.id).toBeGreaterThan(0);
      expect(pointLines(f.points).length, t.id).toBeGreaterThanOrEqual(3);
      expect(["16:9", "9:16", "1:1"]).toContain(t.aspect);
    }
  });

  it("flags template placeholders that are still in [brackets]", () => {
    expect(hasPlaceholders(applyTemplate(VIDEO_TEMPLATES[0]!))).toBe(true);
    expect(hasPlaceholders({ ...emptyBrief(), goal: "Giới thiệu bếp từ" })).toBe(false);
  });
});

describe("built-in styles", () => {
  const styles = JSON.parse(read("config/video-styles.json")) as VsStyle[];

  it("includes the product, tutorial and promo styles that the quick templates point to", () => {
    const ids = styles.map((s) => s.id);
    for (const t of VIDEO_TEMPLATES) expect(ids, t.id).toContain(t.styleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every style validates and says what it is good for", () => {
    for (const s of styles) {
      expect(validateStyle(s).ok, s.id).toBe(true);
      expect(String(s.description), s.id).toContain("Phù hợp");
    }
  });
});

describe("director and editor prompts", () => {
  const roles = JSON.parse(read("config/roles-videostudio.json")) as Record<string, { systemPrompt: string }>;

  it("keep the safety rules and add the craft rules", () => {
    for (const k of ["video-director", "video-editor"]) {
      const p = roles[k]!.systemPrompt;
      expect(p).toContain("chỉ có quyền đọc");
      expect(p).toContain("không tin cậy");
      expect(p).toContain("```json");
    }
    const d = roles["video-director"]!.systemPrompt;
    for (const phrase of ["3 đến 5 giây", "shotSec", "không quá 7 từ", "3 từ mỗi giây", "tiếng Anh", "Không bịa"]) expect(d, phrase).toContain(phrase);
    expect(roles["video-editor"]!.systemPrompt).toContain("giữ nguyên phong cách");
  });

  it("the director request spells out structure, length, narration and scene prompts", () => {
    const p = buildDirectorPrompt({
      description: "Chủ đề: bếp từ",
      width: 1920,
      height: 1080,
      style: { shotSec: 3, transition: "fade", visualPrompt: "clean" },
      assets: [],
    });
    expect(p).toContain("Bố cục");
    expect(p).toContain("thời lượng mục tiêu");
    expect(p).toContain("3 từ mỗi giây");
    expect(p).toContain("tiếng Anh");
    // the existing contract stays
    expect(p).toContain("1920x1080");
    expect(p).toContain("không tin cậy");
  });
});

describe("create form static render", () => {
  const styles = [{ id: "product-showcase", name: "Giới thiệu sản phẩm", builtin: true, transition: "fade", transitionSec: 0.5, shotSec: 3, font: "Segoe UI", textColor: "#ffffff", textBox: true, visualPrompt: "x" }] as VsStyle[];
  const html = renderToStaticMarkup(createElement(VideoStudioCreate, { styles, settings: null, onCreated: () => {}, onChanged: () => {} }));

  it("shows the quick templates and the structured fields", () => {
    for (const t of VIDEO_TEMPLATES) expect(html).toContain(t.name);
    for (const label of ["Chủ đề / mục tiêu", "Người xem", "Giọng điệu", "Thời lượng mục tiêu", "Ngôn ngữ lời dẫn", "Ý chính", "Kêu gọi hành động", "Xem nội dung gửi cho AI"]) expect(html).toContain(label);
    for (const n of BRIEF_SECONDS) expect(html).toContain(`${n} giây`);
  });
});
