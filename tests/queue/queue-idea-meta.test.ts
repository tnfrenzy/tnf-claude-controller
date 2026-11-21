import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueueStore } from "../../src/core/queue/queue-store.js";

const P = "proj";
let dir: string;
let q: QueueStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qmeta-"));
  q = new QueueStore(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const blueprint = { goal: "G", constraints: ["c"], architecture: "A", interfaces: [{ owner: "a", name: "fa()", description: "d" }] };

describe("QueueStore: contract fields and idea meta", () => {
  it("keeps consumes/produces/acceptance/kind/auto on stored commands", () => {
    const [a, b] = q.addCommands(P, [
      { id: "a", title: "A", body: "Làm A", produces: ["fa"], acceptance: ["có test"], kind: "research" },
      { id: "b", title: "B", body: "Làm B", consumes: ["fa"], auto: "integrate" },
    ], { hasRepo: true });
    expect(a!.produces).toEqual(["fa"]);
    expect(a!.acceptance).toEqual(["có test"]);
    expect(a!.kind).toBe("research");
    expect(b!.consumes).toEqual(["fa"]);
    expect(b!.auto).toBe("integrate");
    const again = new QueueStore(dir).get(P, "b")!;
    expect(again.consumes).toEqual(["fa"]);
    expect(again.auto).toBe("integrate");
  });

  it("stores idea meta per sourceRef, survives reload and other writes, removed with the idea", () => {
    q.addCommands(P, [{ id: "a", title: "A", body: "Làm A", sourceRef: "run1" }], { hasRepo: true });
    q.setIdeaMeta(P, "run1", { blueprint, criticIssues: [{ kind: "gap", note: "thiếu test" }], resplit: true });
    q.transition(P, "a", "đã duyệt");
    const fresh = new QueueStore(dir);
    expect(fresh.getIdeaMeta(P, "run1")?.blueprint).toEqual(blueprint);
    expect(fresh.listIdeaMeta(P)["run1"]?.resplit).toBe(true);
    expect(fresh.getIdeaMeta(P, "nope")).toBeNull();
    q.transition(P, "a", "bỏ qua");
    q.deleteIdea(P, "run1");
    expect(q.getIdeaMeta(P, "run1")).toBeNull();
  });

  it("a queue.json written before this change (no ideas key) still loads", () => {
    const f = path.join(dir, "projects", P, "queue.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ version: 1, commands: [] }));
    expect(q.listIdeaMeta(P)).toEqual({});
    expect(q.list(P)).toEqual([]);
  });
});
