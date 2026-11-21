import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const doc = readFileSync(path.resolve(__dirname, "..", "..", "docs", "QUOTA-AUTO-RESUME.md"), "utf8");

function section(from: string, to?: string): string {
  const a = doc.indexOf(from);
  if (a < 0) return "";
  const b = to ? doc.indexOf(to, a + from.length) : -1;
  return b < 0 ? doc.slice(a) : doc.slice(a, b);
}

describe("docs/QUOTA-AUTO-RESUME.md", () => {
  it("mentions the config keys and the autoResume block", () => {
    for (const k of ["quotaEnabled", "quotaMarginSec", "quotaFallbackMin", "maxAttempts", "autoResume"]) {
      expect(doc).toContain(k);
    }
  });

  it("section 6 covers the safety checks", () => {
    expect(doc).toContain("## 6.");
    const s = section("## 6.", "## 7.");
    expect(s.includes("billing-guard") || s.includes("runBillingGuard")).toBe(true);
    expect(s).toContain("claude auth status");
    expect(s).toContain("transcript");
  });

  it("credits claude-auto-resume under MIT", () => {
    expect(doc).toContain("claude-auto-resume");
    expect(doc).toContain("MIT");
  });

  it("has the seven numbered headings", () => {
    for (let i = 1; i <= 7; i++) expect(doc).toContain(`## ${i}. `);
  });

  it("mentions storage and normalized event names", () => {
    for (const k of ["quota_resumes", "pauseUntil", "resets_at"]) expect(doc).toContain(k);
  });

  it("section 1 names real stream fields and the missing fixture", () => {
    expect(doc).toContain("resetsAt");
    expect(doc).toContain("unifiedWindows");
    const s = section("## 1.", "## 2.");
    expect(s.includes("chưa có fixture") || s.includes("chưa kiểm chứng")).toBe(true);
  });

  it("names the billing guard path", () => {
    expect(doc).toContain("src/core/run/billing-guard.ts");
  });
});
