import { ESTIMATE_NOTE, fmtUsd } from "../queue/queue-budget.js";
import { blockedByFailure } from "../queue/queue-engine.js";
import type { QueueCommand } from "../queue/queue-store.js";
import type { RunRecord } from "../run/run-store.js";

export interface PeriodSummaryInput {
  /** Epoch ms, inclusive. */
  from: number;
  /** Epoch ms, inclusive; unbounded when omitted. */
  to?: number;
  runs: Pick<RunRecord, "id" | "status" | "created_at" | "cost_usd_est">[];
  queueCommands: QueueCommand[];
}

export interface PeriodSummary {
  counts: { done: number; error: number; other: number; total: number };
  costUsd: number;
  blocked: string[];
  text: string;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("vi-VN");
}

/** Pure: builds a Vietnamese summary of runs created within [from, to] plus currently blocked queue commands. */
export function summarizePeriod(input: PeriodSummaryInput): PeriodSummary {
  const to = input.to ?? Number.POSITIVE_INFINITY;
  const inRange = input.runs.filter((r) => r.created_at >= input.from && r.created_at <= to);
  let done = 0;
  let error = 0;
  let other = 0;
  let cost = 0;
  for (const r of inRange) {
    if (r.status === "done") done++;
    else if (r.status === "error") error++;
    else other++;
    const c = r.cost_usd_est;
    if (typeof c === "number" && Number.isFinite(c) && c > 0) cost += c;
  }
  const costUsd = round4(cost);
  const blocked = blockedByFailure(input.queueCommands);
  const range =
    input.to === undefined
      ? `Từ ${fmtDate(input.from)}`
      : `Từ ${fmtDate(input.from)} đến ${fmtDate(input.to)}`;
  const blockedLine =
    blocked.length > 0
      ? `Lệnh đang bị chặn: ${blocked.length} (${blocked.join(", ")})`
      : "Không có lệnh nào bị chặn";
  const text = [
    range,
    `Xong: ${done}, lỗi: ${error}`,
    `Chi phí ước tính: ${fmtUsd(costUsd)}`,
    blockedLine,
    ESTIMATE_NOTE,
  ].join("\n");
  return { counts: { done, error, other, total: inRange.length }, costUsd, blocked, text };
}
