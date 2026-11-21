import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";
import { IDEA_MAX_CHARS, ideaProblem } from "../../ui/src/components/queue/QueuePanel";

const KEYS = [
  "queue_ideaTitle",
  "queue_ideaPlaceholder",
  "queue_ideaSend",
  "queue_webSearch",
  "queue_webSearchNote",
  "queue_ideaConfirm",
  "queue_ideaConfirmYes",
  "queue_ideaCancel",
  "queue_ideaRunning",
  "queue_ideaDone",
  "queue_ideaError",
  "queue_ideaTooLong",
  "queue_ideaNeedVi",
] as const;

describe("idea box i18n", () => {
  it("has every new key in vi and en", () => {
    for (const k of KEYS) {
      expect((dicts.vi as Record<string, string>)[k], `vi ${k}`).toBeTruthy();
      expect((dicts.en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
    }
  });
  it("keeps placeholders in both languages", () => {
    for (const l of ["vi", "en"] as const) {
      expect(dicts[l].queue_ideaDone).toContain("{n}");
      expect(dicts[l].queue_ideaTooLong).toContain("{max}");
    }
  });
  it("mentions quota and estimate in the web search note", () => {
    expect(dicts.vi.queue_webSearchNote).toMatch(/ước tính/);
    expect(dicts.en.queue_webSearchNote).toMatch(/estimate/);
  });
});

describe("ideaProblem", () => {
  const labels = { ideaTooLong: "max {max}", ideaNeedVi: "need vi" };
  it("returns empty string for blank input", () => {
    expect(ideaProblem("   ", labels)).toBe("");
  });
  it("rejects too long input", () => {
    expect(ideaProblem("ạ".repeat(IDEA_MAX_CHARS + 1), labels)).toBe(`max ${IDEA_MAX_CHARS}`);
  });
  it("rejects text without Vietnamese diacritics", () => {
    expect(ideaProblem("add a login page", labels)).toBe("need vi");
  });
  it("accepts Vietnamese text", () => {
    expect(ideaProblem("Thêm trang đăng nhập", labels)).toBeNull();
  });
});
