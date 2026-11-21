import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";

const KEYS = [
  "qr_title",
  "qr_countdown",
  "qr_resumes_at",
  "qr_cancel",
  "qr_cancelled",
  "qr_attempt",
  "qr_queue_paused",
  "qr_cancel_failed",
  "qr_cancel_queue_hint",
] as const;

const LANGS = ["vi", "en"] as const;

function text(lang: (typeof LANGS)[number], key: string): unknown {
  return (dicts[lang] as Record<string, unknown>)[key];
}

describe("qr_* i18n keys", () => {
  for (const lang of LANGS) {
    for (const key of KEYS) {
      it(`${lang}.${key} is a non-empty string`, () => {
        const v = text(lang, key);
        expect(typeof v).toBe("string");
        expect((v as string).trim().length).toBeGreaterThan(0);
      });
    }

    it(`${lang}.qr_attempt has {n} and {max}`, () => {
      const v = text(lang, "qr_attempt") as string;
      expect(v).toContain("{n}");
      expect(v).toContain("{max}");
    });

    for (const key of ["qr_countdown", "qr_resumes_at", "qr_queue_paused"]) {
      it(`${lang}.${key} has {time}`, () => {
        expect(text(lang, key) as string).toContain("{time}");
      });
    }
  }

  it("qr_cancel_queue_hint mentions the queue", () => {
    expect(text("vi", "qr_cancel_queue_hint") as string).toMatch(/hàng đợi/i);
    expect(text("en", "qr_cancel_queue_hint") as string).toMatch(/queue/i);
  });
});
