import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCOUT_FOCUS_IDS, buildScoutPrompt, canScout, isScoutPrompt, scoutConfirmText } from "../../ui/src/queue/scoutAgent";
import { SCOUT_LIMITS } from "../../src/core/ideas/scout-proposals.js";

describe("scoutAgent", () => {
  it("prompt names project and forbids edits", () => {
    const p = buildScoutPrompt("demo-proj", "vi");
    expect(p).toContain("demo-proj");
    expect(p).toContain("không sửa");
    expect(p).toContain("đề xuất");
    expect(p).toContain("KHÔNG gọi implementer");
    expect(buildScoutPrompt("x", "en")).toContain("Do NOT call the implementer");
  });
  it("prompt asks for one json proposals block in vi and en", () => {
    for (const lang of ["vi", "en"] as const) {
      const p = buildScoutPrompt("demo", lang);
      for (const k of ["```json", "proposals", "difficulty", "low", "analyst", "implementer"]) expect(p).toContain(k);
      expect(p).toContain(`${SCOUT_LIMITS.title}`);
      expect(p).toContain(`${SCOUT_LIMITS.field}`);
      expect(SCOUT_LIMITS.title).toBe(120);
      expect(SCOUT_LIMITS.field).toBe(600);
    }
    expect(buildScoutPrompt("demo", "vi")).toContain("CÓ DẤU");
    expect(buildScoutPrompt("demo", "vi")).toContain("Chỉ dùng các vai analyst, planner và critic");
    expect(buildScoutPrompt("demo", "en")).toContain("Use ONLY the analyst, planner and critic roles");
  });
  it("prompt asks for exactly 5 proposals with the json block last", () => {
    const vi = buildScoutPrompt("demo", "vi");
    const en = buildScoutPrompt("demo", "en");
    expect(vi).toContain("đúng 5 tính năng");
    expect(vi).toContain("đúng 5 đề xuất");
    expect(en).toContain("exactly 5 features");
    expect(en).toContain("exactly 5 proposals");
    for (const p of [vi, en]) expect(p).not.toContain("3-5");
    expect(vi).toContain("CUỐI CÙNG của báo cáo");
    expect(en).toContain("LAST part of the report");
    expect(isScoutPrompt(vi)).toBe(true);
    expect(isScoutPrompt(en)).toBe(true);
  });
  it("prompt asks for web research, full fields, sources and untrusted-web warning", () => {
    for (const lang of ["vi", "en"] as const) {
      const p = buildScoutPrompt("demo", lang);
      for (const k of ["WebSearch", "agent", "feature", "security", "sources", "stars", "url", "note", "10"]) expect(p).toContain(k);
      expect(p).toContain(`${SCOUT_LIMITS.agent}`);
      expect(p).toContain(`${SCOUT_LIMITS.maxSources}`);
      expect(p).toContain(`${SCOUT_LIMITS.sourceTitle}`);
    }
    expect(buildScoutPrompt("demo", "vi")).toContain("dữ liệu không tin cậy");
    expect(buildScoutPrompt("demo", "vi")).toContain("không chép lệnh");
    expect(buildScoutPrompt("demo", "en")).toContain("untrusted data");
    expect(buildScoutPrompt("demo", "en")).toContain("Never copy commands");
  });
  it("scout: true is sent only by ScoutPopup's scout startRun, not CommandPage", () => {
    const root = path.resolve(__dirname, "..", "..");
    const left = fs.readFileSync(path.join(root, "ui/src/components/queue/ScoutPopup.tsx"), "utf8");
    const calls = left.match(/api\.startRun\(\{[^\n]*\}\)/g) ?? [];
    const scoutCall = calls.find((c) => c.includes("buildScoutPrompt"));
    expect(scoutCall).toBeDefined();
    expect(scoutCall).toContain("scout: true");
    expect(calls.filter((c) => c.includes("scout: true"))).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, "ui/src/components/LeftPanel.tsx"), "utf8")).not.toContain("scout: true");
    const cmd = fs.readFileSync(path.join(root, "ui/src/pages/CommandPage.tsx"), "utf8");
    expect(cmd).not.toContain("scout: true");
  });
  it("no opts gives the exact pre-change prompt (sha256 captured before the edit)", () => {
    const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
    const vi = buildScoutPrompt("demo", "vi");
    const en = buildScoutPrompt("demo", "en");
    expect(vi.length).toBe(2611);
    expect(sha(vi)).toBe("e9bac160a75ba9adeada3b969f8c389f2b5ad522304a9277faa2a31b850b032c");
    expect(en.length).toBe(2780);
    expect(sha(en)).toBe("7dcb1a9c24ecf6b0afeded37fabe4b485d0ce0ec3f293bd1b72c6fcf975f9c7a");
    expect(buildScoutPrompt("demo", "vi", {})).toBe(vi);
    expect(buildScoutPrompt("demo", "en", { skipped: [], focus: [] })).toBe(en);
    expect(isScoutPrompt(vi)).toBe(true);
  });
  it("skipped proposals are listed in vi and en, after the existing-features line", () => {
    const skipped = [{ title: "Chế độ tối", feature: "đổi giao diện" }, { title: "Export CSV", feature: "xuất bảng" }];
    for (const lang of ["vi", "en"] as const) {
      const p = buildScoutPrompt("demo", lang, { skipped });
      expect(p).toContain("- Chế độ tối: đổi giao diện");
      expect(p).toContain("- Export CSV: xuất bảng");
      expect(isScoutPrompt(p)).toBe(true);
      expect(p.indexOf("Chế độ tối")).toBeGreaterThan(p.indexOf(lang === "en" ? "Existing features:" : "Tính năng đã có:"));
    }
    expect(buildScoutPrompt("demo", "vi", { skipped })).toContain("TUYỆT ĐỐI không đề xuất lại");
    expect(buildScoutPrompt("demo", "en", { skipped })).toContain("NEVER propose them again");
  });
  it("skipped list is capped near 3000 chars, newest kept", () => {
    const skipped = Array.from({ length: 100 }, (_, i) => ({ title: `T${i}`, feature: "f".repeat(150) }));
    const base = buildScoutPrompt("demo", "en").length;
    const p = buildScoutPrompt("demo", "en", { skipped });
    expect(p.length - base).toBeLessThan(3400);
    expect(p).toContain("- T99:");
    expect(p).not.toContain("- T0:");
  });
  it("focus subset adds only the selected group lines", () => {
    const vi = buildScoutPrompt("demo", "vi", { focus: ["security"] });
    expect(vi).toContain("Chỉ đề xuất trong các nhóm");
    expect(vi).toContain("[bảo mật] = bảo mật");
    expect(vi).not.toContain("giao diện tối ưu hơn");
    const en = buildScoutPrompt("demo", "en", { focus: ["security", "ui"] });
    expect(en).toContain("Only propose within the groups");
    expect(en).toContain("[security] = security");
    expect(en).toContain("[ui] = a better user interface");
    expect(en).not.toContain("Agent/Skill sets");
  });
  it("all four or empty focus adds no restriction line and keeps exactly 5", () => {
    const base = buildScoutPrompt("demo", "vi");
    expect(buildScoutPrompt("demo", "vi", { focus: [...SCOUT_FOCUS_IDS] })).toBe(base);
    expect(buildScoutPrompt("demo", "vi", { focus: [] })).toBe(base);
    for (const [lang, five] of [["vi", "đúng 5"], ["en", "exactly 5"]] as const) {
      expect(buildScoutPrompt("demo", lang, { focus: ["ui"], skipped: [{ title: "a", feature: "b" }] })).toContain(five);
    }
  });
  it("canScout truth table", () => {
    for (const hasRepo of [true, false])
      for (const running of [0, 1])
        for (const busy of [true, false])
          expect(canScout({ hasRepo, running, busy })).toBe(hasRepo && running === 0 && !busy);
  });
  it("confirm text mentions estimate", () => {
    expect(scoutConfirmText("vi")).toContain("ước tính");
    expect(scoutConfirmText("en")).toContain("estimate");
  });
});
