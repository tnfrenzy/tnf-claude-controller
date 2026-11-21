import { describe, it, expect } from "vitest";
import { resolveBaseRef } from "../../src/core/queue/queue-engine.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";

function mk(id: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return {
    id, project: "p", batch: 1, position: 0, title: id, body: `body ${id}`, bodyOriginal: `body ${id}`,
    dependsOn: [], files: [`src/${id}.ts`], status: "đã duyệt", runId: null, branch: null,
    estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null, ...over,
  };
}

describe("resolveBaseRef", () => {
  it("no dep -> undefined", () => {
    const a = mk("a");
    expect(resolveBaseRef(a, [a])).toBeUndefined();
  });
  it("committed dep -> its branch verbatim", () => {
    const d = mk("d", { status: "đã commit", runId: "run1", branch: "custom/odd-name" });
    const a = mk("a", { dependsOn: ["d"] });
    expect(resolveBaseRef(a, [d, a])).toBe("custom/odd-name");
  });
  it("merged dep -> undefined", () => {
    const d = mk("d", { status: "đã gộp", branch: "tnf/x" });
    const a = mk("a", { dependsOn: ["d"] });
    expect(resolveBaseRef(a, [d, a])).toBeUndefined();
  });
  it("two committed deps -> last one", () => {
    const d1 = mk("d1", { status: "đã commit", branch: "b1" });
    const d2 = mk("d2", { status: "đã commit", branch: "b2" });
    const a = mk("a", { dependsOn: ["d1", "d2"] });
    expect(resolveBaseRef(a, [d1, d2, a])).toBe("b2");
  });
  it("committed dep with null branch -> undefined", () => {
    const d = mk("d", { status: "đã commit", branch: null });
    const a = mk("a", { dependsOn: ["d"] });
    expect(resolveBaseRef(a, [d, a])).toBeUndefined();
  });
});
