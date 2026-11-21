import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveReportText } from "../../src/core/run/report-text.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "report-fallback-"));
}

describe("resolveReportText", () => {
  it("returns report.md when present", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "report.md"), "# Bao cao", "utf8");
    expect(resolveReportText(dir, "ket qua")).toBe("# Bao cao");
  });

  it("falls back to result_text when report.md is missing", () => {
    expect(resolveReportText(tmpDir(), "ket qua run")).toBe("ket qua run");
  });

  it("returns null when both are empty", () => {
    const dir = tmpDir();
    expect(resolveReportText(dir, null)).toBeNull();
    expect(resolveReportText(dir, "   ")).toBeNull();
  });

  it("is used by the report endpoint", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "server", "http.ts"), "utf8");
    expect(src).toContain("resolveReportText(run.run_dir, run.result_text)");
  });
});
