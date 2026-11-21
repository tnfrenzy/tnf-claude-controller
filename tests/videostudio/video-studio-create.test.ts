import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoStudioCreate, validateCreateForm, type CreateForm } from "../../ui/src/components/videostudio/VideoStudioCreate";
import type { VsStyle } from "../../src/core/videostudio/plan-types";

const style = (id: string, name: string, description?: string): VsStyle => ({
  id,
  name,
  builtin: true,
  ...(description ? { description } : {}),
  transition: "fade",
  transitionSec: 0.5,
  shotSec: 4,
  font: "Arial",
  textColor: "#FFFFFF",
  textBox: true,
  gamma: 1,
  visualPrompt: "x",
});

const styles = [style("clean", "Gọn gàng", "Nền sáng, chữ rõ"), style("bold", "Mạnh mẽ")];
const ok: CreateForm = { title: "Video giới thiệu", brief: "Giới thiệu sản phẩm", styleId: "clean", aspect: "16:9" };

describe("validateCreateForm", () => {
  it("returns null for a valid form", () => {
    expect(validateCreateForm(ok)).toBeNull();
  });
  it("rejects a missing or blank name", () => {
    expect(validateCreateForm({ ...ok, title: "" })).toMatch(/tên/i);
    expect(validateCreateForm({ ...ok, title: "   " })).toMatch(/tên/i);
  });
  it("rejects a name over 80 characters and a brief over 4000", () => {
    expect(validateCreateForm({ ...ok, title: "a".repeat(81) })).toMatch(/80/);
    expect(validateCreateForm({ ...ok, brief: "a".repeat(4001) })).toMatch(/4000/);
    expect(validateCreateForm({ ...ok, title: "a".repeat(80), brief: "a".repeat(4000) })).toBeNull();
  });
  it("rejects a form without a style", () => {
    expect(validateCreateForm({ ...ok, styleId: "" })).toMatch(/phong cách/i);
  });
});

describe("VideoStudioCreate static render", () => {
  const render = (initialTab?: "new" | "styles" | "settings") =>
    renderToStaticMarkup(createElement(VideoStudioCreate, { styles, settings: null, onCreated: () => {}, onChanged: () => {}, ...(initialTab ? { initialTab } : {}) }));

  it("shows the three tabs", () => {
    const html = render();
    expect(html).toContain("Dự án mới");
    expect(html).toContain("Phong cách");
    expect(html).toContain("Cài đặt AI");
  });
  it("lists every style name, the aspect ratios and the create button on the new-project tab", () => {
    const html = render();
    expect(html).toContain("Gọn gàng");
    expect(html).toContain("Mạnh mẽ");
    expect(html).toContain("Nền sáng, chữ rõ");
    for (const a of ["16:9", "9:16", "1:1"]) expect(html).toContain(a);
    expect(html).toContain("Tạo");
  });
  it("renders the style manager and the settings tabs", () => {
    expect(render("styles")).toContain("vs-style-manager");
    expect(render("settings")).toContain("vs-settings");
  });
});
