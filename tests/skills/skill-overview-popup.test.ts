import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillOverviewPopup } from "../../ui/src/components/skills/SkillOverviewPopup.js";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `skill ${i}`, state: "passed", badge: "passed" as const, score: i === 0 ? 92 : null, running: false }));
const render = (n: number) =>
  renderToStaticMarkup(createElement(SkillOverviewPopup, { skills: mk(n), onOpenSkill: () => {}, onAdd: () => {}, onClose: () => {} }));

describe("SkillOverviewPopup", () => {
  it("0 skills shows empty line and add button", () => {
    const html = render(0);
    expect(html).toContain("Chưa có skill");
    expect(html).toContain("Thêm tầng huấn luyện");
  });
  it("2 skills show name, status and best score", () => {
    const html = render(2);
    expect(html).toContain("skill 0");
    expect(html).toContain("skill 1");
    expect(html).toContain("Đạt");
    expect(html).toContain("<td>92</td>");
    expect(html).toContain("<td>-</td>");
    expect(html).not.toContain("Chưa có skill");
  });
  it("5 skills hide the add button", () => {
    expect(render(5)).not.toContain("Thêm tầng huấn luyện");
  });
});
