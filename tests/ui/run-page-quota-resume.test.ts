import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../ui/src/pages/RunPage.tsx", import.meta.url), "utf8");

describe("RunPage quota resume wiring", () => {
  it("imports the countdown component", () => {
    expect(src).toContain('import { QuotaResumeCountdown } from "../components/run/QuotaResumeCountdown"');
  });

  it("fetches the resume only for error runs, before the early return", () => {
    const hook = src.indexOf("api.getQuotaResume(id)");
    const early = src.indexOf("if (!run) {");
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(early);
    expect(src).toContain('run?.status !== "error"');
    expect(src).toContain("[id, run?.status, run?.updated_at]");
  });

  it("cancels via the API, then hides the block and reports", () => {
    const start = src.indexOf("const cancelResume");
    const body = src.slice(start, src.indexOf("if (!run) {", start));
    expect(body).toContain("api.cancelQuotaResume(id)");
    expect(body).toContain("setResume(null)");
    expect(body).toContain("t.qr_cancelled");
    expect(body).toContain("t.qr_cancel_failed");
  });

  it("renders only for pending, with attempt text and queue hint", () => {
    expect(src).toContain('resume?.status === "pending"');
    expect(src).toContain('replace("{n}"');
    expect(src).toContain('replace("{max}"');
    expect(src).toContain("String(resume.attempt)");
    expect(src).toContain("String(maxAttempts)");
    expect(src).toContain('resume.kind === "queue"');
    expect(src).toContain("t.qr_cancel_queue_hint");
  });
});
