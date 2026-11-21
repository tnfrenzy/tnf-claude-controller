/** Deterministic "Kết quả" summary built from data the run already has (no model call). */
import { runActionState } from "./runActions.js";

export type TestStatus = "pass" | "fail" | "unknown";

export interface RunSummaryInput {
  kind: string;
  status: string;
  merged?: boolean;
  verdicts?: { verdict: string }[];
  commits?: unknown[];
  changed_files?: number;
  cost_usd_est?: number;
  duration_ms?: number;
}

export interface RunSummary {
  verdict: "pass" | "fail" | "none";
  commits: number;
  files: number;
  test: TestStatus;
  costUsd: number;
  durationMs: number;
  primary: "commit" | "diff";
}

const PASS_VERDICTS = new Set(["PASS", "PASS_ENV", "APPROVED", "APPROVED_WITH_CONCERNS"]);
const FAIL_VERDICTS = new Set(["FAIL", "NEEDS_REVISION", "BLOCKED"]);

/** Reads the header line of test-result.txt (three possible headers written by run-manager). */
export function parseTestStatus(text: string | null | undefined): TestStatus {
  const t = (text ?? "").trimStart();
  if (!t) return "unknown";
  if (t.startsWith("# Lần chạy test cuối (thành công)")) return "pass";
  if (t.startsWith("# Lần chạy test cuối (thất bại / bị từ chối)")) return "fail";
  return "unknown";
}

export function buildSummary(run: RunSummaryInput, testStatus: TestStatus): RunSummary {
  const last = run.verdicts && run.verdicts.length > 0 ? run.verdicts[run.verdicts.length - 1]!.verdict : "";
  const verdict = PASS_VERDICTS.has(last) ? "pass" : FAIL_VERDICTS.has(last) ? "fail" : "none";
  const state = runActionState({ kind: run.kind, status: run.status, merged: run.merged === true });
  return {
    verdict,
    commits: run.commits?.length ?? 0,
    files: run.changed_files ?? 0,
    test: testStatus,
    costUsd: run.cost_usd_est ?? 0,
    durationMs: run.duration_ms ?? 0,
    primary: state.showCommit && !state.commitDisabled ? "commit" : "diff",
  };
}
