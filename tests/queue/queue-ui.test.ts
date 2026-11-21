import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOTSPOTS, buttonStates, filesOverlap, groupByBatch, groupEstimate, matchesHotspot, normalizeFile,
  parallelCheck, parallelGate, statusVisual, recoveryActions,
} from "../../ui/src/queue/queue";
import type { DescribedCommand, QueueStatus, QueueView } from "../../ui/src/types";
import { DEFAULT_QUEUE_HOTSPOTS } from "../../src/core/app/config";
import { checkIndependence } from "../../src/core/queue/queue-plan";

const open = { locked: false, reasons: [] as string[] };

function cmd(id: string, over: Partial<DescribedCommand> = {}): DescribedCommand {
  return {
    id, project: "p", batch: 1, position: 0, title: `T ${id}`, body: "b", bodyOriginal: "b",
    dependsOn: [], files: [`src/${id}.ts`], references: [], warnings: [], source: "manual", sourceRef: "",
    status: "đã duyệt" as QueueStatus, runId: null, branch: null, estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null,
    wave: 1, waveReasons: [], estimatedCostUsd: 0.5,
    locks: { edit: open, approveRun: open, skip: open },
    ...over,
  };
}

function view(commands: DescribedCommand[], over: Partial<QueueView> = {}): QueueView {
  return {
    commands, waveError: null, totalEstimatedCostUsd: 0, costNote: "", maxParallel: 3, codingRunning: 0,
    budget: { canOpenNew: true, reached: false, spentUsd: 0, maxBudgetUsd: 10, remainingUsd: 10, message: "" },
    ...over,
  };
}

const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe("groupByBatch", () => {
  it("sorts batches ascending and keeps original order inside a batch", () => {
    const g = groupByBatch([cmd("c", { batch: 2 }), cmd("a", { batch: 1 }), cmd("d", { batch: 2 }), cmd("b", { batch: 1 })]);
    expect(g.map((x) => x.batch)).toEqual([1, 2]);
    expect(g[0]!.commands.map((c) => c.id)).toEqual(["a", "b"]);
    expect(g[1]!.commands.map((c) => c.id)).toEqual(["c", "d"]);
  });
});

describe("files and hotspots", () => {
  it("normalizes and compares paths", () => {
    expect(normalizeFile("./A\\B.ts")).toBe("a/b.ts");
    expect(filesOverlap("./a/B.ts", "a/b.ts")).toBe(true);
    expect(filesOverlap("a\\b.ts", "a/b.ts")).toBe(true);
  });
  it("only a trailing slash makes a directory", () => {
    expect(filesOverlap("src/", "src/x.ts")).toBe(true);
    expect(filesOverlap("src/x.ts", "./src/")).toBe(true);
    expect(filesOverlap("src", "src/x.ts")).toBe(false);
  });
  it("matches hotspots exactly and by glob like the server", () => {
    expect(matchesHotspot("package.json", DEFAULT_HOTSPOTS)).toBe(true);
    expect(matchesHotspot("./UI/src/api.ts", DEFAULT_HOTSPOTS)).toBe(true);
    expect(matchesHotspot("docs/a.md", ["docs/*.md"])).toBe(true);
    expect(matchesHotspot("docs/x/a.md", ["docs/*.md"])).toBe(false);
    expect(matchesHotspot("docs/x/a.md", ["docs/**"])).toBe(true);
    expect(matchesHotspot("src", ["src/"])).toBe(false);
    expect(matchesHotspot("src/x.ts", ["src"])).toBe(false);
  });
  it("DEFAULT_HOTSPOTS equals the server default", () => {
    expect(DEFAULT_HOTSPOTS).toEqual(DEFAULT_QUEUE_HOTSPOTS);
  });
});

describe("parallelCheck", () => {
  const v = { maxParallel: 3, codingRunning: 0 };
  it("rejects empty and single selections", () => {
    const all = [cmd("a"), cmd("b")];
    expect(codes(parallelCheck([], all, v))).toEqual(["noSelection"]);
    expect(codes(parallelCheck(["a"], all, v))).toEqual(["needTwo"]);
  });
  it("allows independent commands and every reason is an object with a code", () => {
    expect(parallelCheck(["a", "b"], [cmd("a"), cmd("b")], v)).toEqual({ ok: true, reasons: [] });
    const bad = parallelCheck(["a", "b"], [cmd("a", { files: ["x.ts"] }), cmd("b", { files: ["x.ts"] })], v);
    for (const r of bad.reasons) expect(typeof r).toBe("object");
    expect(bad.reasons.every((r) => typeof r.code === "string")).toBe(true);
  });
  it("rejects transitive dependency A->B->C even when B is not selected", () => {
    const all = [
      cmd("a", { dependsOn: ["b"] }), cmd("b", { dependsOn: ["c"], status: "đã gộp" }), cmd("c", { status: "đã gộp" }),
    ];
    const r = parallelCheck(["a", "c"], all, v);
    expect(r.ok).toBe(false);
    expect(r.reasons.find((x) => x.code === "dependency")?.params).toEqual({ a: "a", b: "c" });
  });
  it("rejects when B is selected too", () => {
    const all = [cmd("a", { dependsOn: ["b"] }), cmd("b", { dependsOn: ["c"] }), cmd("c", { status: "đã gộp" })];
    expect(codes(parallelCheck(["a", "b", "c"], all, v))).toContain("dependency");
  });
  it("rejects selected commands that are not approved or whose deps are not merged", () => {
    const all = [cmd("a", { status: "chờ duyệt" }), cmd("b"), cmd("c", { dependsOn: ["b"] })];
    const r = parallelCheck(["a", "b"], all, v);
    expect(r.reasons).toContainEqual({ code: "notRunnable", params: { id: "a" } });
    expect(codes(parallelCheck(["b", "c"], all, v))).toContain("notRunnable");
  });
  it("reports file overlap with both command ids and the file", () => {
    const r = parallelCheck(["a", "b"], [cmd("a", { files: ["./Src/X.ts"] }), cmd("b", { files: ["src/x.ts"] })], v);
    expect(r.reasons[0]).toEqual({ code: "fileOverlap", params: { a: "a", b: "b", file: "src/x.ts" } });
  });
  it("reports shared hotspots (default and custom)", () => {
    const hot = [cmd("a", { files: ["package.json"] }), cmd("b", { files: ["package.json"] })];
    expect(codes(parallelCheck(["a", "b"], [cmd("a", { files: ["ui/src/api.ts"] }), cmd("b", { files: ["ui/src/api.ts"] })], v))).toContain("fileOverlap");
    const a = cmd("a", { files: ["docs/one.md"] });
    const b = cmd("b", { files: ["docs/two.md"] });
    expect(parallelCheck(["a", "b"], [a, b], v).ok).toBe(true);
    const r = parallelCheck(["a", "b"], [a, b], v, ["docs/*.md"]);
    expect(r.reasons[0]!.code).toBe("hotspot");
    expect(hot.length).toBe(2);
  });
  it("rejects different batches", () => {
    expect(codes(parallelCheck(["a", "b"], [cmd("a"), cmd("b", { batch: 2 })], v))).toContain("diffBatch");
  });
  it("counts codingRunning against maxParallel", () => {
    const all = [cmd("a"), cmd("b")];
    expect(parallelCheck(["a", "b"], all, { maxParallel: 2, codingRunning: 0 }).ok).toBe(true);
    const r = parallelCheck(["a", "b"], all, { maxParallel: 2, codingRunning: 1 });
    expect(r.reasons).toContainEqual({ code: "noSlots", params: { n: 1 } });
  });
  it("agrees with checkIndependence of the server for pairs", () => {
    const pairs: [string[], string[], string[]][] = [
      [["a.ts"], ["b.ts"], []],
      [["src/"], ["src/x.ts"], []],
      [["src"], ["src/x.ts"], []],
      [["package.json"], ["package.json"], []],
      [["docs/a.md"], ["docs/b.md"], ["docs/*.md"]],
      [["docs/a.md"], ["other/b.md"], ["docs/*.md"]],
      [["./A.ts"], ["a.ts"], []],
    ];
    for (const [fa, fb, hs] of pairs) {
      const a = cmd("a", { files: fa });
      const b = cmd("b", { files: fb });
      const hotspots = hs.length ? hs : DEFAULT_QUEUE_HOTSPOTS;
      const server = checkIndependence(
        { id: "a", title: "", body: "", files: fa, dependsOn: [], verify: "v", size: 1 },
        { id: "b", title: "", body: "", files: fb, dependsOn: [], verify: "v", size: 1 },
        hotspots,
      ).independent;
      expect(parallelCheck(["a", "b"], [a, b], v, hotspots).ok).toBe(server);
    }
  });
});

describe("parallelGate", () => {
  const v = { maxParallel: 3, codingRunning: 0 };
  const warned = cmd("a", { warnings: ["Cảnh báo: body có URL"] });
  it("locks on unacknowledged warnings and opens when acknowledged", () => {
    const all = [warned, cmd("b")];
    const locked = parallelGate(["a", "b"], all, v, {});
    expect(locked.ok).toBe(false);
    expect(locked.reasons).toContainEqual({ code: "ackWarnings", params: { id: "a" } });
    expect(parallelGate(["a", "b"], all, v, { acknowledged: { a: true } }).ok).toBe(true);
  });
  it("locks with the server reason verbatim", () => {
    const b = cmd("b", { locks: { edit: open, skip: open, approveRun: { locked: true, reasons: ["Chờ lệnh x được gộp"] } } });
    const r = parallelGate(["a", "b"], [cmd("a"), b], v, {});
    expect(r.ok).toBe(false);
    expect(r.reasons).toContainEqual({ code: "server", text: "Chờ lệnh x được gộp" });
  });
});

describe("buttonStates", () => {
  const ctx = { selectedIds: [] as string[] };
  it("locks edit once the command ran", () => {
    for (const status of ["đang chạy", "đã commit", "đã gộp"] as QueueStatus[]) {
      const c = cmd("a", { status });
      const s = buttonStates(c, view([c]), ctx);
      expect(s.edit.locked).toBe(true);
      expect(s.edit.reasons.map((r) => r.code)).toContain("alreadyRan");
    }
    const c = cmd("a");
    expect(buttonStates(c, view([c]), ctx).edit.locked).toBe(false);
  });
  it("approve-run needs acknowledged warnings", () => {
    const c = cmd("a", { warnings: ["w"] });
    expect(buttonStates(c, view([c]), ctx).approveRun.reasons[0]!.code).toBe("ackWarnings");
    expect(buttonStates(c, view([c]), { ...ctx, warningsAcknowledged: true }).approveRun.locked).toBe(false);
    expect(buttonStates(c, view([c]), { ...ctx, acknowledged: { a: true } }).approveRun.locked).toBe(false);
  });
  it("approve-run shows server reasons verbatim", () => {
    const c = cmd("a", { locks: { edit: open, skip: open, approveRun: { locked: true, reasons: ["Hết chỗ"] } } });
    expect(buttonStates(c, view([c]), ctx).approveRun.reasons).toEqual([{ code: "server", text: "Hết chỗ" }]);
  });
  it("skip locks while running and after merge or skip", () => {
    const run = cmd("a", { status: "đang chạy" });
    expect(buttonStates(run, view([run]), ctx).skip.reasons.map((r) => r.code)).toEqual(["cancelRunFirst"]);
    for (const status of ["đã gộp", "bỏ qua"] as QueueStatus[]) {
      const c = cmd("a", { status });
      expect(buttonStates(c, view([c]), ctx).skip.reasons.map((r) => r.code)).toEqual(["mergedOrSkipped"]);
    }
  });
  it("runParallel: notRunnable for unapproved commands", () => {
    const c = cmd("a", { status: "chờ duyệt" });
    expect(buttonStates(c, view([c]), ctx).runParallel.reasons[0]).toEqual({ code: "notRunnable", params: { id: "a" } });
  });
  it("runParallel of an unselected card is judged on selection plus itself", () => {
    const all = [cmd("a", { files: ["x.ts"] }), cmd("b", { files: ["x.ts"] }), cmd("c")];
    const v1 = view(all);
    const s = buttonStates(all[1]!, v1, { selectedIds: ["a"] });
    expect(s.runParallel.locked).toBe(true);
    expect(s.runParallel.reasons.map((r) => r.code)).toContain("fileOverlap");
    expect(buttonStates(all[2]!, v1, { selectedIds: ["a"] }).runParallel.locked).toBe(false);
    // alone it needs a partner
    expect(buttonStates(all[0]!, v1, { selectedIds: [] }).runParallel.reasons[0]!.code).toBe("needTwo");
  });
});

describe("recoveryActions", () => {
  const r = (status: QueueStatus, live = false) => recoveryActions(cmd("x", { status }), live);
  it("maps every status", () => {
    expect(r("đã commit")).toEqual(["confirmMerged"]);
    expect(r("lỗi")).toEqual(["retry", "confirmDone"]);
    expect(r("đang chạy", false)).toEqual(["confirmDone", "markFailed"]);
    expect(r("đang chạy", true)).toEqual([]);
    expect(r("bỏ qua")).toEqual(["unskip"]);
    expect(r("chờ duyệt")).toEqual([]);
    expect(r("đã duyệt")).toEqual([]);
    expect(r("đã gộp")).toEqual([]);
  });
});

describe("estimate and status", () => {
  it("sums estimates and flags them", () => {
    const e = groupEstimate([{ estimatedCostUsd: 0.5 }, { estimatedCostUsd: 1.25 }, { estimatedCostUsd: undefined as unknown as number }]);
    expect(e.totalUsd).toBeCloseTo(1.75);
    expect(e.isEstimate).toBe(true);
    expect(e.label).toContain("1.75");
  });
  it("maps all 7 statuses", () => {
    const all: QueueStatus[] = ["chờ duyệt", "đã duyệt", "đang chạy", "đã commit", "đã gộp", "bỏ qua", "lỗi"];
    for (const s of all) {
      const x = statusVisual(s);
      expect(x.icon.length).toBeGreaterThan(0);
      expect(["ok", "warn", "bad", "info", "muted"]).toContain(x.tone);
    }
    expect(statusVisual("lỗi").tone).toBe("bad");
  });
});
