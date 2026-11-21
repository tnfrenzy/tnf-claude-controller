import type { QueueCommand } from "./queue-store.js";
import { DEFAULT_QUEUE_MAX_BUDGET_USD } from "../app/config.js";

/** Shown next to every cost figure: values are client-side estimates, not invoices. */
export const ESTIMATE_NOTE = "Ước tính (total_cost_usd phía client), không phải hóa đơn.";

/**
 * Size multipliers applied to the average cost of recent coding runs
 * (or to the per-run default budget when there is no history).
 * Size 1 = small command (about half of an average run), size 2 = full run.
 */
export const SIZE_FACTOR: Record<1 | 2, number> = { 1: 0.5, 2: 1 };

/** Fallback per-run budget when defaults.maxBudgetUsd is invalid (mirrors defaults.coding.maxBudgetUsd). */
const FALLBACK_RUN_BUDGET_USD = 3;

export interface BudgetCommand {
  id: string;
  project: string;
  size: 1 | 2;
  status: QueueCommand["status"];
  estCostUsd: number;
}

export interface CommandCostEstimate {
  estimateUsd: number;
  upperBoundUsd: number;
  basis: "history" | "default";
  note: string;
}

export interface GroupCostEstimate {
  totalEstimateUsd: number;
  totalUpperBoundUsd: number;
  count: number;
  note: string;
}

export interface BudgetState {
  canOpenNew: boolean;
  reached: boolean;
  spentUsd: number;
  maxBudgetUsd: number | null;
  remainingUsd: number | null;
  message: string;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function validPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Vietnamese money format, e.g. 1,5 -> "$1,50". */
export function fmtUsd(n: number): string {
  return "$" + n.toFixed(2).replace(".", ",");
}

/**
 * Estimate one command: average of recent coding run costs (finite, > 0) times the size factor,
 * or defaults.maxBudgetUsd times the size factor when there is no history.
 * Clamped to [0, per-run budget], which is also reported as the upper bound.
 */
export function estimateCommandCost(
  cmd: { size: 1 | 2 },
  history: readonly number[] | undefined,
  defaults: { maxBudgetUsd?: number } | undefined,
): CommandCostEstimate {
  const upper = validPositive(defaults?.maxBudgetUsd) ? defaults.maxBudgetUsd : FALLBACK_RUN_BUDGET_USD;
  const factor = SIZE_FACTOR[cmd.size] ?? SIZE_FACTOR[1];
  const valid = (history ?? []).filter(validPositive);
  const hasHistory = valid.length > 0;
  const base = hasHistory ? valid.reduce((a, b) => a + b, 0) / valid.length : upper;
  const est = Math.min(Math.max(base * factor, 0), upper);
  return {
    estimateUsd: round4(est),
    upperBoundUsd: round4(upper),
    basis: hasHistory ? "history" : "default",
    note: ESTIMATE_NOTE,
  };
}

/** Sum estimates and upper bounds for a parallel group. */
export function estimateGroupCost(
  items: readonly { estimateUsd: number; upperBoundUsd: number }[] | undefined,
): GroupCostEstimate {
  let est = 0;
  let upper = 0;
  const list = items ?? [];
  for (const it of list) {
    if (Number.isFinite(it.estimateUsd) && it.estimateUsd > 0) est += it.estimateUsd;
    if (Number.isFinite(it.upperBoundUsd) && it.upperBoundUsd > 0) upper += it.upperBoundUsd;
  }
  return {
    totalEstimateUsd: round4(est),
    totalUpperBoundUsd: round4(upper),
    count: list.length,
    note: ESTIMATE_NOTE,
  };
}

const COUNTED_STATUSES: ReadonlySet<string> = new Set(["đã commit", "đã gộp", "đang chạy", "lỗi"]);

/**
 * Estimated spend of the queue: finished and running commands plus replan runs.
 * A failed ("lỗi") run still counts when estCostUsd > 0, because it consumed quota.
 * Pending, approved and skipped commands are ignored.
 */
export function queueSpent(
  commands: readonly Pick<BudgetCommand, "status" | "estCostUsd">[] | undefined,
  replanCosts?: readonly number[],
): number {
  let total = 0;
  for (const c of commands ?? []) {
    if (COUNTED_STATUSES.has(c.status) && validPositive(c.estCostUsd)) total += c.estCostUsd;
  }
  for (const r of replanCosts ?? []) {
    if (validPositive(r)) total += r;
  }
  return round4(total);
}

/**
 * Budget ceiling check. At or over the ceiling no NEW command may be opened,
 * but commands already running finish normally (this function never cancels anything).
 */
export function budgetState(spentUsd: number | undefined, maxBudgetUsd: number | null | undefined): BudgetState {
  const spent = validPositive(spentUsd) ? spentUsd : 0;
  if (maxBudgetUsd === null) {
    // Explicit null = no ceiling: new commands may always be opened.
    return {
      canOpenNew: true,
      reached: false,
      spentUsd: round4(spent),
      maxBudgetUsd: null,
      remainingUsd: null,
      message: `Không giới hạn ngân sách hàng đợi (đã tiêu ước tính ${fmtUsd(spent)}). ${ESTIMATE_NOTE}`,
    };
  }
  const max = validPositive(maxBudgetUsd) ? maxBudgetUsd : DEFAULT_QUEUE_MAX_BUDGET_USD;
  const spentCents = Math.round(spent * 100);
  const maxCents = Math.round(max * 100);
  const reached = spentCents >= maxCents;
  const remaining = Math.max(0, (maxCents - spentCents) / 100);
  const message = reached
    ? `Đã chạm trần ngân sách hàng đợi: đã tiêu ước tính ${fmtUsd(spent)} / ${fmtUsd(max)}. ` +
      `Không mở lệnh mới; các lệnh đang chạy vẫn được chạy nốt. ${ESTIMATE_NOTE}`
    : `Còn lại ước tính ${fmtUsd(remaining)} (đã tiêu ước tính ${fmtUsd(spent)} / ${fmtUsd(max)}). ${ESTIMATE_NOTE}`;
  return {
    canOpenNew: !reached,
    reached,
    spentUsd: round4(spent),
    maxBudgetUsd: max,
    remainingUsd: remaining,
    message,
  };
}
