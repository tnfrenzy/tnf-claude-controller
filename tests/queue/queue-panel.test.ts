import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueCard, reasonText, type QueueLabels } from "../../ui/src/components/queue/QueuePanel";
import { recoveryConfirmText } from "../../ui/src/queue/queue-labels";
import type { DescribedCommand, QueueView } from "../../ui/src/types";

const labels: QueueLabels = {
  title: "Queue", empty: "Empty", batch: "Batch", files: "Files", dependsOn: "Depends", references: "Refs",
  warnings: "Warnings", estimate: "Estimate", pushedReason: "Pushed", edit: "Edit", save: "Save", cancel: "Cancel",
  approveRun: "Approve and run", runParallel: "Run parallel", skip: "Skip", copy: "Copy", copied: "Copied",
  select: "Select", parallelBar: "Parallel", loadWarning: "Heavy", ackWarnings: "Acknowledge", loadError: "Load error",
  confirmMerged: "Xác nhận đã commit", confirmDone: "Xác nhận đã xong", confirmDoneTip: "tip", retry: "Chạy lại",
  retryTip: "retry tip", markFailed: "Đánh dấu lỗi", unskip: "Hoàn tác bỏ qua",
  confirmMergedAsk: "merged?", confirmDoneAsk: "Xác nhận lệnh này đã xong?", confirmDoneNoCommit: "Run chưa có commit.", markFailedAsk: "fail?",
  status: { "chờ duyệt": "Pending" },
  reasons: { notRunnable: "{id} not runnable", ackWarnings: "Acknowledge warnings of {id}" },
};

const lock = { locked: false, reasons: [] };
function cmd(over: Partial<DescribedCommand> = {}): DescribedCommand {
  return {
    id: "c1", project: "p", batch: 1, position: 1, title: "Do it", body: "body text", bodyOriginal: "body text",
    dependsOn: ["c0"], files: ["src/a.ts"], references: [{ url: "https://example.com/x", title: "Ref", note: "n" }],
    warnings: ["risky"], source: "manual", sourceRef: "", status: "chờ duyệt", runId: null, branch: null,
    estCostUsd: 0.5, createdAt: 0, updatedAt: 0, approvedAt: null, wave: 1, waveReasons: ["after c0"],
    estimatedCostUsd: 0.5, locks: { edit: lock, approveRun: lock, skip: lock }, ...over,
  };
}
const view = (c: DescribedCommand[]): QueueView => ({
  commands: c, waveError: null, totalEstimatedCostUsd: 0, costNote: "", maxParallel: 2, codingRunning: 0,
  budget: { canOpenNew: true, reached: false, spentUsd: 0, maxBudgetUsd: 3, remainingUsd: 3, message: "" },
});
const render = (c: DescribedCommand) =>
  renderToStaticMarkup(createElement(QueueCard, { cmd: c, view: view([c]), labels, selectedIds: [], acknowledged: {}, editing: false, draft: "" }));

describe("QueueCard", () => {
  it("renders references safely, warnings before the approve button, and the estimate", () => {
    const html = render(cmd());
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("https://example.com/x");
    expect(html).toContain("Copy");
    expect(html).toContain("risky");
    expect(html).toContain("Estimate");
    expect(html.indexOf("queue-warn")).toBeGreaterThan(-1);
    expect(html.indexOf("queue-warn")).toBeLessThan(html.indexOf("Approve and run"));
  });
  it("disables approve with a reason until warnings are acknowledged", () => {
    const html = render(cmd());
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve and run/);
    expect(html).toContain("Acknowledge warnings of c1");
  });
  it("omits warning and reference blocks when empty", () => {
    const html = render(cmd({ warnings: [], references: [] }));
    expect(html).not.toContain("queue-warn");
    expect(html).not.toContain("queue-refs");
  });
  it("maps reason codes and keeps server text verbatim", () => {
    expect(reasonText({ code: "notRunnable", params: { id: "x" } }, labels)).toBe("x not runnable");
    expect(reasonText({ code: "server", text: "raw" }, labels)).toBe("raw");
    expect(reasonText({ code: "unknown" }, labels)).toBe("unknown");
  });
});

describe("QueueCard recovery buttons", () => {
  const all = ["Xác nhận đã commit", "Xác nhận đã xong", "Chạy lại", "Đánh dấu lỗi", "Hoàn tác bỏ qua"];
  it("shows the right buttons per status", () => {
    const committed = render(cmd({ status: "đã commit" }));
    expect(committed).toContain("Xác nhận đã commit");
    const failed = render(cmd({ status: "lỗi" }));
    expect(failed).toContain("Chạy lại");
    expect(failed).toContain("Xác nhận đã xong");
    expect(render(cmd({ status: "bỏ qua" }))).toContain("Hoàn tác bỏ qua");
    const orphan = render(cmd({ status: "đang chạy", runLive: false }));
    expect(orphan).toContain("Xác nhận đã xong");
    expect(orphan).toContain("Đánh dấu lỗi");
    const live = render(cmd({ status: "đang chạy", runLive: true }));
    for (const t of all) expect(live).not.toContain(t);
  });
  it("builds the confirm text with a no-commit warning", () => {
    expect(recoveryConfirmText("confirmDone", labels, 0)).toContain("Run chưa có commit.");
    expect(recoveryConfirmText("confirmDone", labels, 2)).not.toContain("Run chưa có commit.");
    expect(recoveryConfirmText("retry", labels)).toBeNull();
  });
});

describe("QueuePanel source and css", () => {
  const src = readFileSync("ui/src/components/queue/QueuePanel.tsx", "utf8");
  const css = readFileSync("ui/src/styles.css", "utf8");
  it("polls REST every 3 s with [project] deps, catches errors, no WebSocket", () => {
    expect(src).toMatch(/setInterval\(\s*tick\s*,\s*3000\s*\)/);
    expect(src).toMatch(/\[\s*project\s*,\s*load\s*\]/);
    expect(src).toMatch(/catch\s*\(/);
    expect(src).not.toMatch(/WebSocket/);
  });
  it("uses minmax(0, 1fr) grids at both widths and no pinched column", () => {
    const blocks = css.match(/\.queue-[^{]*\{[^}]*\}/g) ?? [];
    expect(blocks.length).toBeGreaterThan(10);
    expect(css).toMatch(/\.queue-list\s*\{[^}]*grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1280px\)\s*\{\s*\.queue-list\s*\{[^}]*repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/);
    for (const b of blocks) {
      expect(b).not.toMatch(/grid-template-columns:[^;]*\b\d+px\b/);
      expect(b).not.toMatch(/(^|[^-])width:\s*\d{1,2}px/);
    }
    expect(css).toMatch(/\.queue-card\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
