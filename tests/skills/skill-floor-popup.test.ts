import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SkillFloorView, chooseSkillBranch } from "../../ui/src/components/skills/SkillFloorPopup.js";
import { I18nContext, dicts } from "../../ui/src/i18n.js";

const setLang = () => {};
function render(props: Partial<Parameters<typeof SkillFloorView>[0]>): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { lang: "vi", t: dicts.vi, setLang } },
      createElement(SkillFloorView, { slug: "s", state: "idle", paused: false, rounds: [], costUsdEstimate: 0, ...props }),
    ),
  );
}

describe("SkillFloorView awaiting_score", () => {
  it("shows grading UI and file links", () => {
    const h = render({ state: "awaiting_score", rounds: [{ n: 1, errors: [], costUsdEstimate: 0.1 }], roundFiles: [{ name: "sample-1.md", size: 10 }] });
    expect(h).toContain("chờ bạn chấm");
    expect(h).toContain("Gửi điểm");
    expect(h).toContain("/rounds/1/files/sample-1.md");
  });
});

describe("SkillFloorView results tab", () => {
  const two = [
    { n: 1, score: 50, errors: [], costUsdEstimate: 0.1 },
    { n: 2, score: 80, errors: [], costUsdEstimate: 0.1 },
  ];
  it("lists files of every round, marks best", () => {
    const h = render({
      initialTab: "results", rounds: two, bestRound: 2,
      resultFiles: { 1: [{ name: "a-r1.md", size: 1 }], 2: [{ name: "b-r2.md", size: 2 }] },
    });
    expect(h).toContain("a-r1.md");
    expect(h).toContain("b-r2.md");
    expect(h).toContain("Mở");
    expect(h).toContain("Tải về");
    expect(h).toContain("Vòng 2 · tốt nhất");
    expect(h).not.toContain("Vòng 1 · tốt nhất");
  });
  it("shows empty message", () => {
    expect(render({ initialTab: "results", rounds: [] })).toContain("Chưa có tệp đầu ra");
    expect(render({ initialTab: "results", rounds: two, resultFiles: {} })).toContain("Chưa có tệp đầu ra");
  });
  it("awaiting_score defaults to results tab", () => {
    const h = render({ state: "awaiting_score", rounds: [{ n: 1, errors: [], costUsdEstimate: 0 }], resultFiles: { 1: [{ name: "z.md", size: 1 }] } });
    expect(h).toContain("skill-results");
    expect(h).not.toContain("skill-pass-line");
  });
  it("idle renders overview with chart", () => {
    const h = render({ state: "idle", rounds: two });
    expect(h).toContain("skill-pass-line");
    expect(h).not.toContain("skill-results");
  });
});

describe("SkillFloorView", () => {
  it("empty shows message and cost estimate", () => {
    const h = render({});
    expect(h).toContain("Chưa có vòng huấn luyện nào");
    expect(h).toContain("ước tính");
  });
  it("one round has svg and pass line", () => {
    const h = render({ rounds: [{ n: 1, score: 60, errors: ["lỗi A"], costUsdEstimate: 0.1 }], costUsdEstimate: 0.1 });
    expect(h).toContain("<svg");
    expect(h).toContain("skill-pass-line");
    expect(h).toContain("Đạt 90");
    expect(h).toContain("lỗi A");
  });
  it("lists errors of the latest round only", () => {
    const h = render({
      rounds: [
        { n: 1, score: 50, errors: ["lỗi cũ"], costUsdEstimate: 0.1 },
        { n: 2, score: 70, errors: ["lỗi mới 1", "lỗi mới 2"], costUsdEstimate: 0.2 },
      ],
      bestScore: 70,
      bestRound: 2,
      costUsdEstimate: 0.3,
    });
    expect(h).toContain("lỗi mới 1");
    expect(h).toContain("lỗi mới 2");
    expect(h).not.toContain("lỗi cũ");
    expect(h).toContain("Vòng 1");
    expect(h).toContain("Vòng 2");
  });
  it("no numeric width above 375", () => {
    const h = render({ rounds: [{ n: 1, score: 60, errors: [], costUsdEstimate: 0 }] });
    for (const m of h.matchAll(/width[:=]"?(\d+)(?:px)?/g)) expect(Number(m[1])).toBeLessThanOrEqual(375);
  });
  const rs = [{ n: 1, score: 60, errors: [], costUsdEstimate: 0.1 }];
  const btn = (h: string, label: string) => {
    const m = new RegExp(`<button[^>]*>${label}</button>`).exec(h);
    expect(m).not.toBeNull();
    return m![0].includes("disabled");
  };
  it("buttons per state", () => {
    let h = render({ state: "trial", rounds: rs });
    expect(btn(h, "Dừng")).toBe(false);
    expect(btn(h, "Huấn luyện thêm")).toBe(true);
    expect(btn(h, "Quay lại bản tốt nhất")).toBe(true);
    h = render({ state: "trial", paused: true, rounds: rs });
    expect(btn(h, "Tiếp tục")).toBe(false);
    expect(btn(h, "Dừng")).toBe(true);
    h = render({ state: "awaiting_approval", rounds: rs });
    expect(btn(h, "Duyệt và lưu")).toBe(false);
    expect(btn(h, "Huấn luyện thêm")).toBe(true);
    h = render({ state: "passed", rounds: rs });
    expect(btn(h, "Huấn luyện thêm")).toBe(false);
    expect(btn(h, "Tải zip")).toBe(false);
    h = render({ state: "failed_max_rounds", rounds: rs });
    expect(btn(h, "Tiếp tục")).toBe(false);
    h = render({ state: "stopped", rounds: rs });
    expect(btn(h, "Quay lại bản tốt nhất")).toBe(false);
    h = render({ state: "idle" });
    expect(btn(h, "Huấn luyện thêm")).toBe(false);
    expect(btn(h, "Tải zip")).toBe(true);
    expect(btn(h, "Duyệt và lưu")).toBe(true);
  });
  it("busy disables every button", () => {
    const h = render({ state: "passed", rounds: rs, busy: true });
    expect(btn(h, "Huấn luyện thêm")).toBe(true);
  });
  it("delete button locked only while running and not paused", () => {
    expect(btn(render({ state: "trial", rounds: rs }), "Xóa skill")).toBe(true);
    expect(btn(render({ state: "composing", rounds: rs }), "Xóa skill")).toBe(true);
    expect(btn(render({ state: "trial", paused: true, rounds: rs }), "Xóa skill")).toBe(false);
    expect(btn(render({ state: "idle" }), "Xóa skill")).toBe(false);
    expect(btn(render({ state: "awaiting_approval", rounds: rs }), "Xóa skill")).toBe(false);
  });
  it("App wires onDeleted to reloadSkills", () => {
    const src = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
    expect(src).toContain("onDeleted={reloadSkills}");
  });
  it("awaiting_user chooses the form branch", () => {
    expect(chooseSkillBranch("awaiting_user", false, false)).toBe("form");
    expect(chooseSkillBranch("trial", false, true)).toBe("view");
  });
  it("App uses SkillFloorPopup", () => {
    const src = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
    expect(src).toContain('import { SkillFloorPopup }');
    expect(src).toContain("<SkillFloorPopup");
  });
  it("all skill_floor_* keys exist in vi and en", () => {
    const keys = Object.keys(dicts.vi).filter((k) => k.startsWith("skill_floor_"));
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(Object.keys(dicts.en)).toContain(k);
  });
});
