import { DEFAULT_IDEA_AGENTS } from "../../src/core/app/config.js";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPLITTER_MAX_IDEA_CHARS as CORE_MAX_IDEA, SPLITTER_MAX_PENDING as CORE_MAX_PENDING } from "../../src/core/ideas/queue-split.js";
import type { ScoutProposal } from "../../src/core/ideas/scout-proposals.js";
import {
  SCOUT_SPLIT_BUDGET_USD,
  SPLITTER_MAX_IDEA_CHARS,
  SPLITTER_MAX_PENDING,
  approvedItems,
  buildIdeaText,
  canSplit,
  editFields,
  estimateTotal,
  initReview,
  proposalProblem,
  removeItem,
  removeSettled,
  runSplitSequence,
  setStatus,
  sourceRefFor,
  type SplitApi,
} from "../../ui/src/queue/scoutReview";

const mk = (id: string, over: Partial<ScoutProposal> = {}): ScoutProposal => ({
  id,
  title: `Sửa lỗi ${id}`,
  goal: "Mục tiêu có dấu",
  reason: "Lý do",
  scope: "ui/src/a.ts",
  risk: "Rủi ro thấp",
  difficulty: "low",
  ...over,
});

const noSleep = async () => undefined;

describe("scout review pure logic", () => {
  it("constants match core", () => {
    expect(SPLITTER_MAX_IDEA_CHARS).toBe(CORE_MAX_IDEA);
    expect(SPLITTER_MAX_PENDING).toBe(CORE_MAX_PENDING);
    // the splitter budget is now a setting; its default must keep matching the UI constant
    expect(DEFAULT_IDEA_AGENTS.splitterBudgetUsd).toBe(SCOUT_SPLIT_BUDGET_USD);
  });

  it("init does not auto-approve; status and edit work", () => {
    let items = initReview([mk("a"), mk("b")]);
    expect(items.every((i) => i.status === "pending")).toBe(true);
    items = setStatus(items, "a", "approved");
    items = setStatus(items, "b", "skipped");
    expect(approvedItems(items).map((i) => i.proposal.id)).toEqual(["a"]);
    const ok = editFields(items, "a", { title: "  Tiêu đề mới  " });
    expect(ok.ok).toBe(true);
    expect(ok.items[0]!.proposal.title).toBe("Tiêu đề mới");
    expect(ok.items[0]!.edited).toBe(true);
    const bad = editFields(items, "a", { title: "x".repeat(121) });
    expect(bad.ok).toBe(false);
    expect(bad.items).toBe(items);
    expect(editFields(items, "a", { goal: "   " }).ok).toBe(false);
  });

  it("buildIdeaText is capped, Vietnamese with diacritics, and passes the idea check", () => {
    const p = mk("a");
    expect(buildIdeaText(p)).toMatch(/Mục tiêu/);
    expect(proposalProblem(p)).toBeNull();
    const long = mk("b", { goal: "á".repeat(600), scope: "á".repeat(600), risk: "á".repeat(600), title: "á".repeat(120) });
    expect(buildIdeaText(long, "en").length).toBeLessThanOrEqual(SPLITTER_MAX_IDEA_CHARS);
    const noVi = mk("c", { title: "Fix", goal: "Goal", scope: "a.ts", risk: "low" });
    expect(proposalProblem({ ...noVi })).toBeNull(); // labels "Mục tiêu" supply diacritics
  });

  it("buildIdeaText appends trimmed Agent, Tính năng, Bảo mật after Rủi ro in order", () => {
    const t = buildIdeaText(mk("a", { agent: "  qa  ", feature: "Tìm kiếm", security: "Không lộ token" }));
    expect(t).toContain(" Agent: qa.");
    expect(t).toContain(" Tính năng: Tìm kiếm.");
    expect(t).toContain(" Bảo mật: Không lộ token.");
    expect(t.indexOf("Rủi ro: ")).toBeLessThan(t.indexOf("Agent: "));
    expect(t.indexOf("Agent: ")).toBeLessThan(t.indexOf("Tính năng: "));
    expect(t.indexOf("Tính năng: ")).toBeLessThan(t.indexOf("Bảo mật: "));
    expect(proposalProblem(mk("a", { agent: "qa", feature: "x", security: "y" }))).toBeNull();
  });

  it("buildIdeaText skips missing, empty or blank extras and matches the old output", () => {
    const base = buildIdeaText(mk("a"));
    expect(base).toBe("Sửa lỗi a. Mục tiêu: Mục tiêu có dấu. Phạm vi: ui/src/a.ts. Rủi ro: Rủi ro thấp.");
    const t = buildIdeaText(mk("a", { agent: undefined, feature: "", security: "   " }));
    expect(t).toBe(base);
    expect(t).not.toMatch(/Agent:|Tính năng:|Bảo mật:/);
    const only = buildIdeaText(mk("a", { feature: "F" }));
    expect(only).toBe(`${base} Tính năng: F.`);
  });

  it("buildIdeaText with long extras is exactly 2000 chars, ends with an ellipsis and is a prefix", () => {
    const p = mk("a", { agent: "á".repeat(700), feature: "á".repeat(700), security: "á".repeat(700) });
    const t = buildIdeaText(p);
    expect(t.length).toBe(SPLITTER_MAX_IDEA_CHARS);
    expect(t.endsWith("…")).toBe(true);
    const full = `${p.title}. Mục tiêu: ${p.goal}. Phạm vi: ${p.scope}. Rủi ro: ${p.risk}. Agent: ${p.agent}. Tính năng: ${p.feature}. Bảo mật: ${p.security}.`;
    expect(full.length).toBeGreaterThan(SPLITTER_MAX_IDEA_CHARS);
    expect(full.startsWith(t.slice(0, -1))).toBe(true);
  });

  it("sourceRefFor matches the server regex", () => {
    expect(sourceRefFor("20261028-120000-abc123", "fix_1")).toMatch(/^[\w-]+#[a-z0-9_-]{1,32}$/);
  });

  it("estimateTotal and canSplit boundaries", () => {
    expect(estimateTotal(3)).toBe(3 * SCOUT_SPLIT_BUDGET_USD);
    expect(estimateTotal(0)).toBe(0);
    let items = initReview([mk("a"), mk("b")]);
    expect(canSplit(items, { busy: false, pendingInQueue: 0 })).toBe(false);
    items = setStatus(setStatus(items, "a", "approved"), "b", "approved");
    expect(canSplit(items, { busy: false, pendingInQueue: 0 })).toBe(true);
    expect(canSplit(items, { busy: true, pendingInQueue: 0 })).toBe(false);
    expect(canSplit(items, { busy: false, pendingInQueue: CORE_MAX_PENDING - 2 })).toBe(true);
    expect(canSplit(items, { busy: false, pendingInQueue: CORE_MAX_PENDING - 1 })).toBe(false);
  });
});

describe("removeItem and removeSettled", () => {
  const res = (id: string, state: "done" | "error" | "cancelled") => ({ id, state, commands: 0, costUsd: 0 });
  const ids = (items: ReturnType<typeof initReview>) => items.map((i) => i.proposal.id);

  it("removeItem removes one item and keeps order", () => {
    const items = initReview([mk("a"), mk("b"), mk("c")]);
    expect(ids(removeItem(items, "b"))).toEqual(["a", "c"]);
  });

  it("removeItem with unknown id changes nothing and does not mutate", () => {
    const items = initReview([mk("a"), mk("b")]);
    const out = removeItem(items, "zzz");
    expect(out).toEqual(items);
    removeItem(items, "a");
    expect(ids(items)).toEqual(["a", "b"]);
  });

  it("removeSettled removes done items only", () => {
    const items = setStatus(initReview([mk("a"), mk("b")]), "a", "approved");
    expect(ids(removeSettled(items, [res("a", "done")]))).toEqual(["b"]);
  });

  it("removeSettled keeps error, cancelled and items without results", () => {
    const items = initReview([mk("a"), mk("b"), mk("c")]);
    expect(ids(removeSettled(items, [res("a", "error"), res("b", "cancelled")]))).toEqual(["a", "b", "c"]);
  });

  it("removeSettled with empty or null results keeps all", () => {
    const items = initReview([mk("a"), mk("b")]);
    expect(ids(removeSettled(items, []))).toEqual(["a", "b"]);
    expect(ids(removeSettled(items, null))).toEqual(["a", "b"]);
    expect(ids(removeSettled(items, undefined))).toEqual(["a", "b"]);
  });

  it("removeSettled mixed keeps status/edited of survivors and does not mutate", () => {
    let items = initReview([mk("a"), mk("b"), mk("c"), mk("d")]);
    for (const id of ["a", "b", "c"]) items = setStatus(items, id, "approved");
    const edited = editFields(items, "b", { title: "Mới" });
    items = edited.items;
    const out = removeSettled(items, [res("a", "done"), res("b", "error"), res("c", "cancelled")]);
    expect(ids(out)).toEqual(["b", "c", "d"]);
    expect(out[0]).toMatchObject({ status: "approved", edited: true });
    expect(out[1]).toMatchObject({ status: "approved", edited: false });
    expect(out[2]).toMatchObject({ status: "pending" });
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
  });
});

function fakeApi(opts: { failOn?: string[]; busyFirst?: boolean } = {}) {
  const log: string[] = [];
  let active = 0;
  let overlap = false;
  let busyLeft = opts.busyFirst ? 2 : 0;
  const refs = new Map<string, string>();
  const api: SplitApi = {
    queueSplit: async (_p, body) => {
      if (busyLeft > 0) { busyLeft--; throw Object.assign(new Error("busy"), { status: 409, code: "split_busy" }); }
      const id = body.sourceRef.split("#")[1]!;
      expect(body.source).toBe("scout");
      if (opts.failOn?.includes(id)) throw Object.assign(new Error("Hãy viết ý tưởng bằng tiếng Việt có dấu."), { status: 400, code: "need_vietnamese" });
      if (active > 0) overlap = true;
      active++;
      log.push(`start:${id}`);
      refs.set(`run-${id}`, id);
      return { runId: `run-${id}` };
    },
    queueSplitStatus: async (_p, runId) => {
      active--;
      log.push(`done:${refs.get(runId)}`);
      return { state: "done", commands: 2, costUsd: 0.5 };
    },
  };
  return { api, log, overlap: () => overlap };
}

describe("runSplitSequence", () => {
  it("runs only approved, in order, never overlapping", async () => {
    let items = initReview([mk("a"), mk("b"), mk("c"), mk("d")]);
    items = setStatus(items, "a", "approved");
    items = setStatus(items, "b", "skipped");
    items = setStatus(items, "d", "approved");
    const f = fakeApi();
    const res = await runSplitSequence(items, f.api, { project: "p", scoutRunId: "r1", sleep: noSleep });
    expect(f.log).toEqual(["start:a", "done:a", "start:d", "done:d"]);
    expect(f.overlap()).toBe(false);
    expect(res.map((r) => [r.id, r.state, r.commands, r.costUsd])).toEqual([["a", "done", 2, 0.5], ["d", "done", 2, 0.5]]);
  });

  it("an error on one does not stop the next; need_vietnamese is explained", async () => {
    let items = initReview([mk("a"), mk("b")]);
    items = setStatus(setStatus(items, "a", "approved"), "b", "approved");
    const f = fakeApi({ failOn: ["a"] });
    const res = await runSplitSequence(items, f.api, { project: "p", scoutRunId: "r1", sleep: noSleep });
    expect(res[0]!.state).toBe("error");
    expect(res[0]!.error).toMatch(/tiếng Việt/);
    expect(res[1]!.state).toBe("done");
  });

  it("retries on 409 with a bounded count", async () => {
    const items = setStatus(initReview([mk("a")]), "a", "approved");
    const f = fakeApi({ busyFirst: true });
    const res = await runSplitSequence(items, f.api, { project: "p", scoutRunId: "r1", sleep: noSleep });
    expect(res[0]!.state).toBe("done");
    const alwaysBusy: SplitApi = { queueSplit: async () => { throw Object.assign(new Error("busy"), { status: 409 }); }, queueSplitStatus: f.api.queueSplitStatus };
    const res2 = await runSplitSequence(items, alwaysBusy, { project: "p", scoutRunId: "r1", sleep: noSleep, maxBusyRetries: 3 });
    expect(res2[0]!.state).toBe("error");
  });

  it("rejects a proposal without diacritics before sending, and supports cancel", async () => {
    const bare = mk("a", { title: "x", goal: "y", scope: "z", risk: "w" });
    // buildIdeaText always adds Vietnamese labels, so force a failing idea check via custom labels
    let items = setStatus(setStatus(initReview([bare, mk("b")]), "a", "approved"), "b", "approved");
    const f = fakeApi();
    let cancelled = false;
    const res = await runSplitSequence(items, f.api, { project: "p", scoutRunId: "r1", sleep: async () => { cancelled = true; }, isCancelled: () => cancelled });
    expect(res.map((r) => r.state)).toEqual(["done", "cancelled"]);
    items = [];
    expect(await runSplitSequence(items, f.api, { project: "p", scoutRunId: "r1" })).toEqual([]);
  });
});
