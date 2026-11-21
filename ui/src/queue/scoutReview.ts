// Pure logic of the scout proposal review screen (no React, no network except via injected api).
import { ideaProblem } from "../components/queue/QueuePanel";
import { sourceRefFor } from "./scoutRef";
import { validateProposalFields, type ScoutProposal } from "../../../src/core/ideas/scout-proposals";

export type ReviewStatus = "pending" | "approved" | "skipped";

export interface ReviewItem {
  proposal: ScoutProposal;
  status: ReviewStatus;
  /** True once the user changed title/goal/scope. */
  edited: boolean;
}

/** Mirrors SPLITTER_MAX_IDEA_CHARS in src/core/ideas/queue-split.ts (a test keeps them equal). */
export const SPLITTER_MAX_IDEA_CHARS = 2000;
/** Mirrors SPLITTER_MAX_PENDING in src/core/ideas/queue-split.ts (a test keeps them equal). */
export const SPLITTER_MAX_PENDING = 50;
/** Estimate per split, not a bill. Mirrors SPLITTER_BUDGET_USD (=1) in src/core/ideas/queue-split.ts. */
export const SCOUT_SPLIT_BUDGET_USD = 1;

export function initReview(proposals: ScoutProposal[]): ReviewItem[] {
  return proposals.map((proposal) => ({ proposal: { ...proposal }, status: "pending" as const, edited: false }));
}

export function setStatus(items: ReviewItem[], id: string, status: ReviewStatus): ReviewItem[] {
  return items.map((it) => (it.proposal.id === id ? { ...it, status } : it));
}

/** Drop one proposal from the list (used by "skip"). Does not mutate the input. */
export function removeItem(items: ReviewItem[], id: string): ReviewItem[] {
  return items.filter((it) => it.proposal.id !== id);
}

/** Drop proposals whose split finished with state "done"; error/cancelled/unrun items stay for a retry. */
export function removeSettled(items: ReviewItem[], results: SplitItemResult[] | null | undefined): ReviewItem[] {
  const doneIds = new Set((results ?? []).filter((r) => r.state === "done").map((r) => r.id));
  if (doneIds.size === 0) return items.slice();
  return items.filter((it) => !doneIds.has(it.proposal.id));
}

export type EditResult = { ok: true; items: ReviewItem[] } | { ok: false; errors: string[]; items: ReviewItem[] };

export function editFields(items: ReviewItem[], id: string, fields: { title?: string; goal?: string; scope?: string }): EditResult {
  const clean: Record<string, string> = {};
  for (const k of ["title", "goal", "scope"] as const) {
    const v = fields[k];
    if (v !== undefined) clean[k] = v.trim();
  }
  const errors = validateProposalFields(clean);
  for (const k of Object.keys(clean)) if (clean[k] === "") errors.push(`Trường "${k}" không được để trống.`);
  if (errors.length > 0) return { ok: false, errors, items };
  return {
    ok: true,
    items: items.map((it) => (it.proposal.id === id ? { ...it, edited: true, proposal: { ...it.proposal, ...clean } } : it)),
  };
}

export function approvedItems(items: ReviewItem[]): ReviewItem[] {
  return items.filter((it) => it.status === "approved");
}

/** Vietnamese idea text for the splitter, trimmed to the splitter's limit. */
export function buildIdeaText(p: ScoutProposal, lang: "vi" | "en" = "vi"): string {
  void lang; // the splitter requires Vietnamese with diacritics, so the labels are always Vietnamese
  let text = `${p.title}. Mục tiêu: ${p.goal}. Phạm vi: ${p.scope}. Rủi ro: ${p.risk}.`;
  const extras: Array<[string, string | undefined]> = [["Agent", p.agent], ["Tính năng", p.feature], ["Bảo mật", p.security]];
  for (const [label, value] of extras) {
    const v = value?.trim();
    if (v) text += ` ${label}: ${v}.`;
  }
  if (text.length <= SPLITTER_MAX_IDEA_CHARS) return text;
  return text.slice(0, SPLITTER_MAX_IDEA_CHARS - 1).trimEnd() + "…";
}

type IdeaLabels = Parameters<typeof ideaProblem>[1];
export const DEFAULT_IDEA_LABELS: IdeaLabels = {
  ideaTooLong: "Ý tưởng quá dài (tối đa {max} ký tự).",
  ideaNeedVi: "Hãy viết ý tưởng bằng tiếng Việt có dấu.",
};

/** Pre-send check for one proposal; null when it can be sent. */
export function proposalProblem(p: ScoutProposal, labels: IdeaLabels = DEFAULT_IDEA_LABELS): string | null {
  return ideaProblem(buildIdeaText(p), labels);
}

export { sourceRefFor };

export function estimateTotal(n: number): number {
  return Math.max(0, n) * SCOUT_SPLIT_BUDGET_USD;
}

export function canSplit(items: ReviewItem[], opts: { busy: boolean; pendingInQueue: number }): boolean {
  const n = approvedItems(items).length;
  return n >= 1 && !opts.busy && opts.pendingInQueue + n <= SPLITTER_MAX_PENDING;
}

export interface SplitApi {
  queueSplit: (project: string, body: { idea: string; source: "scout"; sourceRef: string; skipInterview?: boolean }) => Promise<{ runId: string }>;
  queueSplitStatus: (project: string, runId: string) => Promise<{ state: "running" | "done" | "error" | "questions"; commands?: number; costUsd?: number; error?: string }>;
}

export interface SplitItemResult {
  id: string;
  state: "done" | "error" | "cancelled";
  commands: number;
  costUsd: number;
  error?: string;
}

export interface SplitSequenceOpts {
  project: string;
  scoutRunId: string;
  pollMs?: number;
  retryMs?: number;
  maxBusyRetries?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  onProgress?: (id: string, state: "starting" | "running" | SplitItemResult["state"]) => void;
  labels?: IdeaLabels;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errInfo(e: unknown): { message: string; status?: number; code?: string } {
  const o = e as { message?: unknown; status?: unknown; code?: unknown } | null;
  return {
    message: typeof o?.message === "string" ? o.message : String(e),
    ...(typeof o?.status === "number" ? { status: o.status } : {}),
    ...(typeof o?.code === "string" ? { code: o.code } : {}),
  };
}

/** Split each approved proposal one after another (the server allows one split per project at a time). */
export async function runSplitSequence(items: ReviewItem[], api: SplitApi, opts: SplitSequenceOpts): Promise<SplitItemResult[]> {
  const sleep = opts.sleep ?? realSleep;
  const pollMs = opts.pollMs ?? 2000;
  const retryMs = opts.retryMs ?? 3000;
  const maxBusy = opts.maxBusyRetries ?? 20;
  const maxPolls = opts.maxPolls ?? 900;
  const results: SplitItemResult[] = [];
  const queue = approvedItems(items);
  for (const it of queue) {
    const id = it.proposal.id;
    const finish = (r: Omit<SplitItemResult, "id">) => {
      results.push({ id, ...r });
      opts.onProgress?.(id, r.state);
    };
    if (opts.isCancelled?.()) { finish({ state: "cancelled", commands: 0, costUsd: 0 }); continue; }
    const problem = proposalProblem(it.proposal, opts.labels);
    if (problem !== null) { finish({ state: "error", commands: 0, costUsd: 0, error: problem || "Ý tưởng trống." }); continue; }
    opts.onProgress?.(id, "starting");
    let runId: string | null = null;
    let failure: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        runId = (await api.queueSplit(opts.project, { idea: buildIdeaText(it.proposal), source: "scout", sourceRef: sourceRefFor(opts.scoutRunId, id), skipInterview: true })).runId;
        break;
      } catch (e) {
        const info = errInfo(e);
        if ((info.status === 409 || info.code === "split_busy") && attempt < maxBusy && !opts.isCancelled?.()) { await sleep(retryMs); continue; }
        failure = info.code === "need_vietnamese" ? `Cần tiếng Việt có dấu: ${info.message}` : info.message;
        break;
      }
    }
    if (runId === null) { finish({ state: "error", commands: 0, costUsd: 0, error: failure ?? "Không bắt đầu được." }); continue; }
    opts.onProgress?.(id, "running");
    let settled = false;
    for (let i = 0; i < maxPolls && !settled; i++) {
      await sleep(pollMs);
      try {
        const st = await api.queueSplitStatus(opts.project, runId);
        if (st.state === "running") continue;
        settled = true;
        if (st.state === "done") finish({ state: "done", commands: st.commands ?? 0, costUsd: st.costUsd ?? 0 });
        else finish({ state: "error", commands: 0, costUsd: st.costUsd ?? 0, error: st.error ?? "Lỗi không rõ." });
      } catch (e) {
        settled = true;
        finish({ state: "error", commands: 0, costUsd: 0, error: errInfo(e).message });
      }
    }
    if (!settled) finish({ state: "error", commands: 0, costUsd: 0, error: "Hết thời gian chờ kết quả chia ý tưởng." });
  }
  return results;
}
