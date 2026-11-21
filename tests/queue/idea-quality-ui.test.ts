import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dicts, I18nContext } from "../../ui/src/i18n.js";
import { commandBadges, criticSummary, hasIdeaMeta, issueKindText, splitStageText } from "../../ui/src/queue/ideaQuality.js";
import { CommandContract, IdeaMetaBox, PendingInterviews } from "../../ui/src/components/queue/IdeaQuality.js";
import type { IdeaMeta } from "../../ui/src/types.js";

const html = (el: ReactElement, lang: "vi" | "en" = "vi") =>
  renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang, t: dicts[lang], setLang: () => {} } }, el));

const meta: IdeaMeta = {
  blueprint: { goal: "Xuất CSV", constraints: ["Không thêm thư viện"], architecture: "src/report.ts", interfaces: [{ owner: "core", name: "buildReport()", description: "dựng CSV" }] },
  criticIssues: [{ kind: "contract", commandId: "ui", note: "consumes lệch tên" }, { kind: "gap", note: "thiếu định dạng ngày" }],
  resplit: true,
  interview: { questions: ["CSV hay PDF?"], answers: ["CSV"], skipped: false },
  warnings: ["Phản biện không đọc được"],
};

describe("idea quality UI", () => {
  it("every iq_ key exists in vi and en with the same placeholders", () => {
    const keys = Object.keys(dicts.vi).filter((k) => k.startsWith("iq_"));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      const vi = (dicts.vi as Record<string, string>)[k]!;
      const en = (dicts.en as Record<string, string>)[k]!;
      expect(en, k).toBeTruthy();
      expect(vi.includes("{n}"), k).toBe(en.includes("{n}"));
    }
  });

  it("helpers: stage text, badges, critic summary, issue kinds", () => {
    const t = dicts.vi;
    expect(splitStageText("critic", t, "x")).toBe(t.iq_stage_critic);
    expect(splitStageText(undefined, t, "mặc định")).toBe("mặc định");
    expect(commandBadges({ auto: "integrate" }, t)).toEqual([t.iq_auto_integrate]);
    expect(commandBadges({ auto: "final-review", kind: "research" }, t)).toEqual([t.iq_auto_review, t.iq_kind_research]);
    expect(commandBadges({}, t)).toEqual([]);
    expect(criticSummary(meta, t)).toBe("Phản biện nêu 2 vấn đề · đã chia lại một lần theo góp ý");
    expect(criticSummary({ criticIssues: [{ kind: "gap", note: "x" }] }, t)).toContain("giữ bản chia đầu");
    expect(criticSummary({}, t)).toBeNull();
    expect(issueKindText("file_conflict", t)).toBe("Trùng tệp");
    expect(hasIdeaMeta({})).toBe(false);
    expect(hasIdeaMeta(meta)).toBe(true);
  });

  it("card contract shows the auto label, uses/provides and acceptance", () => {
    const out = html(createElement(CommandContract, { cmd: { auto: "integrate", consumes: ["buildReport"], produces: ["ReportButton"], acceptance: ["Test qua"] } }));
    expect(out).toContain("Tự thêm: tích hợp");
    expect(out).toContain("buildReport");
    expect(out).toContain("ReportButton");
    expect(out).toContain("Test qua");
    expect(html(createElement(CommandContract, { cmd: {} }))).toBe("");
  });

  it("idea meta box lists critic issues, blueprint and interview answers", () => {
    const out = html(createElement(IdeaMetaBox, { meta }));
    expect(out).toContain("Phản biện nêu 2 vấn đề");
    expect(out).toContain("Hợp đồng lệch");
    expect(out).toContain("consumes lệch tên");
    expect(out).toContain("Xuất CSV");
    expect(out).toContain("buildReport()");
    expect(out).toContain("CSV hay PDF?");
    expect(out).toContain("Phản biện không đọc được");
    expect(html(createElement(IdeaMetaBox, { meta: undefined }))).toBe("");
  });

  it("pending interviews show each question with an answer box and the three actions", () => {
    const out = html(createElement(PendingInterviews, { items: [{ id: "r1", idea: "Xuất báo cáo", questions: ["CSV hay PDF?", "Lọc ngày?"], createdAt: 1, lastError: "hết ngân sách" }], disabled: false, onAnswer: () => {} }));
    expect(out).toContain("Ý tưởng chờ trả lời phỏng vấn (1)");
    expect(out.match(/<textarea/g)).toHaveLength(2);
    expect(out).toContain("Gửi trả lời và chia");
    expect(out).toContain("Bỏ qua, tự quyết");
    expect(out).toContain("Bỏ ý tưởng");
    expect(out).toContain("hết ngân sách");
    const en = html(createElement(PendingInterviews, { items: [{ id: "r1", idea: "x", questions: ["q"], createdAt: 1 }], disabled: true, onAnswer: () => {} }), "en");
    expect(en).toContain("Skip, let the agent decide");
    expect(html(createElement(PendingInterviews, { items: [], disabled: false, onAnswer: () => {} }))).toBe("");
  });

  it("styles keep the new blocks inside narrow screens (wrap long text)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.resolve(__dirname, "..", "..", "ui", "src", "styles.css"), "utf8");
    for (const sel of [".iq-list", ".iq-idea", ".iq-pending-item textarea"]) expect(css).toContain(sel);
    expect(css).toMatch(/\.iq-pending-item textarea \{[^}]*width: 100%/);
  });
});
