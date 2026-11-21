import fs from "node:fs";
import path from "node:path";

/**
 * Text served by GET /api/runs/:id/report: report.md when present, else the run's result text.
 * Returns null when both are empty.
 */
export function resolveReportText(runDir: string, resultText: string | null | undefined): string | null {
  const file = path.resolve(runDir, "report.md");
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return fs.readFileSync(file, "utf8");
  if (typeof resultText === "string" && resultText.trim() !== "") return resultText;
  return null;
}
