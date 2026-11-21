/** `tnf cleanup`: plan, preview, confirm, then remove old coding worktrees (logic and formatting only). */
import readline from "node:readline";
import { parseArgs } from "node:util";
import type { ControllerConfig } from "./core/app/config.js";
import type { RunStore } from "./core/run/run-store.js";
import { buildCleanupPlan, DEFAULT_CLEANUP_DAYS, parseOlderThan } from "./core/git/cleanup-plan.js";
import {
  executeCleanup,
  type CleanupRunResult,
  type CleanupSkipReason,
  type ExecuteDeps,
  type PlanDeps,
} from "./core/git/worktree-cleanup.js";

const DEFAULT_DAYS = DEFAULT_CLEANUP_DAYS;

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = Number.isFinite(n) && n > 0 ? n : 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function skipReasonLabel(reason: CleanupSkipReason, days: number = DEFAULT_DAYS, detail?: string): string {
  switch (reason) {
    case "active": return "đang chạy";
    case "no_worktree": return "không có worktree";
    case "no_branch": return "không có nhánh";
    case "no_project": return "không tìm thấy project/repo";
    case "too_recent": return `chưa đủ ${days} ngày`;
    case "shared_worktree": return "worktree dùng chung với run chưa đủ điều kiện";
    case "outside_worktrees_dir": return "worktree nằm ngoài thư mục worktrees";
    case "missing": return "thư mục worktree không còn";
    case "uncommitted": return "còn thay đổi chưa commit";
    case "unmerged": return "nhánh chưa gộp vào nhánh gốc";
    case "status_unknown": return "không đọc được trạng thái git";
    case "error": return detail ? `lỗi: ${detail}` : "lỗi";
    default: return String(reason);
  }
}

export { parseOlderThan };

export interface CleanupContext {
  config: Pick<ControllerConfig, "workspaceDir" | "worktreesDir">;
  store: Pick<RunStore, "listRuns" | "getProject">;
  now?: number;
  confirm?: (question: string) => Promise<boolean>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  planDeps?: Partial<PlanDeps> | undefined;
  executeDeps?: Partial<ExecuteDeps> | undefined;
}

/** Reads one stdin line; yes/y/có = true; everything else, including EOF, = false. */
function defaultConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(v);
    };
    rl.on("close", () => finish(false));
    rl.question(question + " ", (answer) => finish(["y", "yes", "có"].includes(answer.trim().toLowerCase())));
  });
}

export async function runCleanupCommand(args: string[], ctx: CleanupContext): Promise<number> {
  const out = ctx.out ?? ((l: string) => console.log(l));
  const err = ctx.err ?? ((l: string) => console.error(l));
  const confirm = ctx.confirm ?? defaultConfirm;
  const parsed = parseArgs({ args, options: { "older-than": { type: "string" }, "dry-run": { type: "boolean" } }, strict: false });
  const days = parseOlderThan(parsed.values["older-than"]);
  if (days === null) {
    err("Giá trị --older-than không hợp lệ: cần số nguyên từ 1 trở lên (số ngày).");
    return 2;
  }
  const dryRun = parsed.values["dry-run"] === true;
  const now = ctx.now ?? Date.now();

  try {
    const { plan, executeOpts } = await buildCleanupPlan({ config: ctx.config, store: ctx.store, days, now, planDeps: ctx.planDeps });

    out(`Sẽ dọn: ${plan.candidates.reduce((n, c) => n + c.runIds.length, 0)} run (${plan.candidates.length} worktree) · dung lượng ước tính ${formatBytes(plan.totalBytes)}`);
    for (const c of plan.candidates) out(`  ${c.runIds.join(", ")}  ${c.worktreePath}  (${formatBytes(c.estimatedBytes)})`);
    out(`Bỏ qua (${plan.skipped.length}):`);
    for (const s of plan.skipped) out(`  ${s.runId}  ${skipReasonLabel(s.reason, days, s.detail)}`);

    const baseOpts = { ...executeOpts, ...(ctx.executeDeps ? { deps: ctx.executeDeps } : {}) };
    const preview = await executeCleanup({ ...baseOpts, dryRun: true });
    if (preview.inboxRemoved.length > 0) out(`Thư mục inbox-staging cũ: ${preview.inboxRemoved.join(", ")}`);

    if (dryRun) {
      printResults(out, preview.results);
      out("(chạy thử, không xóa gì)");
      return 0;
    }
    if (plan.candidates.length === 0 && preview.inboxRemoved.length === 0) {
      out("Không có gì để dọn.");
      return 0;
    }
    const q = `Xóa ${plan.candidates.length} worktree (~${formatBytes(plan.totalBytes)}) và ${preview.inboxRemoved.length} thư mục inbox-staging cũ? Nhánh tnf/<run-id> được giữ lại. Gõ y để xác nhận [y/N]:`;
    if (!(await confirm(q))) {
      out("Đã hủy, không xóa gì.");
      return 0;
    }
    const real = await executeCleanup({ ...baseOpts, dryRun: false });
    printResults(out, real.results);
    if (real.inboxRemoved.length > 0) out(`Đã xóa ${real.inboxRemoved.length} thư mục inbox-staging cũ.`);
    return real.results.some((r) => r.status === "failed") ? 1 : 0;
  } catch (e) {
    err(`Lỗi khi dọn worktree: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

function printResults(out: (l: string) => void, results: CleanupRunResult[]): void {
  const count = (s: CleanupRunResult["status"]) => results.filter((r) => r.status === s).length;
  for (const r of results) out(`  ${r.runId}  ${r.status}${r.error ? ` (${r.error})` : r.detail ? ` (${r.detail})` : ""}`);
  out(`Kết quả: ${count("removed")} đã xóa, ${count("dry-run")} sẽ xóa, ${count("failed")} lỗi, ${count("skipped")} bỏ qua.`);
}
