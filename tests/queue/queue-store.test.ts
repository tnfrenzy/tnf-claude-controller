import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QUEUE_STATUSES, QUEUE_TRANSITIONS, QueueError, QueueStore, type QueueStatus } from "../../src/core/queue/queue-store.js";

let dir: string;
let store: QueueStore;
let clock: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-store-"));
  clock = 1000;
  store = new QueueStore(dir, () => ++clock);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cmd = (id: string, extra = {}) => ({ id, title: `T ${id}`, body: `body ${id}`, ...extra });

describe("queue-store", () => {
  it("creates and reads commands in order", () => {
    store.addCommands("demo", [cmd("a", { batch: 2, position: 1 }), cmd("b", { batch: 1, position: 1, files: ["x.ts"], dependsOn: ["a"] })]);
    const list = store.list("demo");
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ status: "chờ duyệt", project: "demo", runId: null, branch: null, approvedAt: null, files: ["x.ts"], dependsOn: ["a"] });
    expect(store.list("other")).toEqual([]);
  });

  it("edits body keeping bodyOriginal; approved edit returns to chờ duyệt", () => {
    store.addCommands("demo", [cmd("a")]);
    store.transition("demo", "a", "đã duyệt");
    expect(store.get("demo", "a")?.approvedAt).not.toBeNull();
    const edited = store.editCommand("demo", "a", { body: "new body", title: "New" });
    expect(edited.body).toBe("new body");
    expect(edited.bodyOriginal).toBe("body a");
    expect(edited.status).toBe("chờ duyệt");
    expect(edited.approvedAt).toBeNull();
  });

  it("rejects editing a command that already ran (409)", () => {
    store.addCommands("demo", [cmd("a")]);
    store.transition("demo", "a", "đã duyệt");
    store.transition("demo", "a", "đang chạy", { runId: "r1", branch: "tnf/r1" });
    try {
      store.editCommand("demo", "a", { body: "x" });
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(QueueError);
      expect((e as QueueError).conflict).toBe(true);
      expect((e as QueueError).message).toContain("Lệnh đã chạy");
    }
    expect(store.get("demo", "a")?.body).toBe("body a");
  });

  it("allows every valid transition", () => {
    for (const from of QUEUE_STATUSES) {
      for (const to of QUEUE_TRANSITIONS[from]) {
        const s = new QueueStore(fs.mkdtempSync(path.join(dir, "v-")));
        s.addCommands("p", [cmd("a")]);
        walkTo(s, "a", from);
        expect(s.transition("p", "a", to).status).toBe(to);
      }
    }
  });

  it("rejects every invalid transition with a Vietnamese error", () => {
    let checked = 0;
    for (const from of QUEUE_STATUSES) {
      for (const to of QUEUE_STATUSES) {
        if (QUEUE_TRANSITIONS[from].includes(to)) continue;
        const s = new QueueStore(fs.mkdtempSync(path.join(dir, "i-")));
        s.addCommands("p", [cmd("a")]);
        walkTo(s, "a", from);
        expect(() => s.transition("p", "a", to)).toThrow(/Không thể chuyển/);
        expect(s.get("p", "a")?.status).toBe(from);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("records run info and cost on transitions; re-run clears run", () => {
    store.addCommands("demo", [cmd("a")]);
    store.transition("demo", "a", "đã duyệt");
    store.transition("demo", "a", "đang chạy", { runId: "r1", branch: "tnf/r1" });
    const done = store.transition("demo", "a", "đã commit", { estCostUsd: 0.4 });
    expect(done).toMatchObject({ runId: "r1", branch: "tnf/r1", estCostUsd: 0.4 });
    store.transition("demo", "a", "lỗi");
    const again = store.transition("demo", "a", "chờ duyệt");
    expect(again.runId).toBeNull();
    expect(again.branch).toBeNull();
  });

  it("supports manual recovery transitions", () => {
    const toFailed = (id: string) => {
      store.addCommands("demo", [cmd(id)]);
      store.transition("demo", id, "đã duyệt");
      store.transition("demo", id, "đang chạy", { runId: "r1", branch: "tnf/r1" });
      store.transition("demo", id, "lỗi");
    };
    toFailed("a");
    const retried = store.transition("demo", "a", "đã duyệt");
    expect(retried).toMatchObject({ status: "đã duyệt", runId: null, branch: null });

    toFailed("b");
    const kept = store.transition("demo", "b", "đã duyệt", { runId: "r9" });
    expect(kept.runId).toBe("r9");

    toFailed("c");
    expect(store.transition("demo", "c", "đã commit")).toMatchObject({ status: "đã commit", runId: "r1", branch: "tnf/r1" });
    expect(store.transition("demo", "c", "đã gộp").status).toBe("đã gộp");
    for (const to of QUEUE_STATUSES) {
      expect(() => store.transition("demo", "c", to)).toThrow(/Không thể chuyển/);
    }
    try {
      store.transition("demo", "c", "lỗi");
    } catch (e) {
      expect((e as QueueError).code).toBe("bad_transition");
    }

    store.addCommands("demo", [cmd("d")]);
    store.transition("demo", "d", "bỏ qua");
    expect(store.transition("demo", "d", "chờ duyệt").status).toBe("chờ duyệt");

    store.addCommands("demo", [cmd("e")]);
    store.transition("demo", "e", "đã duyệt");
    store.transition("demo", "e", "đang chạy", { runId: "r2" });
    expect(() => store.transition("demo", "e", "bỏ qua")).toThrow(/Không thể chuyển/);
  });

  it("rejects the default environment and repo-less projects", () => {
    expect(() => store.addCommands("default", [cmd("a")])).toThrow(/không gắn repo/);
    expect(() => store.addCommands("demo", [cmd("a")], { hasRepo: false })).toThrow(/chưa gắn repo/);
    expect(() => store.addCommands("../evil", [cmd("a")])).toThrow(QueueError);
    expect(store.list("default")).toEqual([]);
  });

  it("makes ids unique within a project", () => {
    store.addCommands("demo", [cmd("a"), cmd("a")]);
    store.addCommands("demo", [cmd("a")]);
    expect(store.list("demo").map((c) => c.id).sort()).toEqual(["a", "a-2", "a-3"]);
    store.addCommands("other", [cmd("a")]);
    expect(store.list("other").map((c) => c.id)).toEqual(["a"]);
  });

  it("stores source, sourceRef, size, verify, parallelGroup and defaults them", () => {
    const [a, b] = store.addCommands("demo", [
      cmd("a", { source: "scout", sourceRef: "run1#x", size: 2, verify: "npm test", parallelGroup: "g1" }),
      cmd("b"),
    ]);
    expect(a).toMatchObject({ source: "scout", sourceRef: "run1#x", size: 2, verify: "npm test", parallelGroup: "g1" });
    expect(b).toMatchObject({ source: "manual", sourceRef: "" });
    expect(b!.size).toBeUndefined();
    const again = new QueueStore(dir).get("demo", "a");
    expect(again).toMatchObject({ source: "scout", sourceRef: "run1#x", size: 2, verify: "npm test", parallelGroup: "g1" });
  });

  it("loads an old queue.json without source fields as manual", () => {
    store.addCommands("demo", [cmd("a")]);
    const file = path.join(dir, "projects", "demo", "queue.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    delete raw.commands[0].source;
    delete raw.commands[0].sourceRef;
    fs.writeFileSync(file, JSON.stringify(raw), "utf8");
    const c = new QueueStore(dir).get("demo", "a");
    expect(c?.source).toBe("manual");
    expect(c?.sourceRef).toBe("");
  });

  it("reports missing commands", () => {
    store.addCommands("demo", [cmd("a")]);
    expect(() => store.transition("demo", "zz", "đã duyệt")).toThrow(/Không tìm thấy/);
  });

  it("persists across reopening the store", () => {
    store.addCommands("demo", [cmd("a")]);
    store.editCommand("demo", "a", { body: "edited" });
    const reopened = new QueueStore(dir);
    const c = reopened.get("demo", "a");
    expect(c?.body).toBe("edited");
    expect(c?.bodyOriginal).toBe("body a");
  });

  it("stores valid references and defaults to empty", () => {
    const [a, b] = store.addCommands("demo", [
      cmd("a", { references: [{ url: "https://example.com/doc", title: "Doc", note: "n" }, { url: "http://example.com" }] }),
      cmd("b"),
    ]);
    expect(a!.references).toEqual([
      { url: "https://example.com/doc", title: "Doc", note: "n" },
      { url: "http://example.com", title: "", note: "" },
    ]);
    expect(b!.references).toEqual([]);
    expect(b!.warnings).toEqual([]);
  });

  it("rejects invalid references", () => {
    const bad: unknown[] = [
      "x",
      [{ url: "ftp://example.com" }],
      [{ url: "not a url" }],
      [{ title: "no url" }],
      [{ url: "https://example.com", extra: 1 }],
      [{ url: "https://example.com", title: "t".repeat(121) }],
      [{ url: "https://example.com", note: "n".repeat(201) }],
      Array.from({ length: 6 }, () => ({ url: "https://example.com" })),
    ];
    for (const references of bad) {
      expect(() => store.addCommands("demo", [cmd("a", { references })])).toThrow(QueueError);
    }
    expect(store.list("demo")).toEqual([]);
  });

  it("rejects each forbidden body pattern", () => {
    const bodies = [
      "run git push origin main",
      "then rm -rf build",
      "use --dangerously-skip-permissions",
      "set bypassPermissions",
      "read ANTHROPIC_API_KEY",
      "read ANTHROPIC_AUTH_TOKEN",
    ];
    for (const body of bodies) {
      expect(() => store.addCommands("demo", [{ id: "a", title: "t", body }]), body).toThrow(QueueError);
    }
    expect(store.list("demo")).toEqual([]);
  });

  it("warns for each risky body pattern", () => {
    const bodies = [
      "see https://example.com",
      "curl the page",
      "wget file",
      "iwr thing",
      "Invoke-WebRequest x",
      "npm install -g foo",
      "pip install foo",
      "Set-ExecutionPolicy Bypass",
    ];
    for (const body of bodies) {
      const [c] = store.addCommands("warn", [{ id: "a", title: "t", body }]);
      expect(c!.warnings.length, body).toBeGreaterThan(0);
    }
  });

  it("reads an old store without references/warnings as empty arrays", () => {
    const file = path.join(dir, "projects", "old", "queue.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacy = {
      id: "a", project: "old", batch: 1, position: 1, title: "t", body: "b", bodyOriginal: "b",
      dependsOn: [], files: [], status: "chờ duyệt", runId: null, branch: null, estCostUsd: 0,
      createdAt: 1, updatedAt: 1, approvedAt: null,
    };
    fs.writeFileSync(file, JSON.stringify({ version: 1, commands: [legacy] }), "utf8");
    const c = store.get("old", "a");
    expect(c?.references).toEqual([]);
    expect(c?.warnings).toEqual([]);
    expect(store.editCommand("old", "a", { title: "u" }).references).toEqual([]);
  });

  it("recomputes warnings when the body is edited and rejects forbidden edits", () => {
    store.addCommands("demo", [cmd("a")]);
    expect(store.editCommand("demo", "a", { body: "curl https://example.com" }).warnings.length).toBe(2);
    expect(store.editCommand("demo", "a", { body: "clean" }).warnings).toEqual([]);
    expect(() => store.editCommand("demo", "a", { body: "git push" })).toThrow(QueueError);
    expect(store.get("demo", "a")?.body).toBe("clean");
  });
});

const PATHS: Record<QueueStatus, QueueStatus[]> = {
  "chờ duyệt": [],
  "đã duyệt": ["đã duyệt"],
  "đang chạy": ["đã duyệt", "đang chạy"],
  "đã commit": ["đã duyệt", "đang chạy", "đã commit"],
  "đã gộp": ["đã duyệt", "đang chạy", "đã commit", "đã gộp"],
  "bỏ qua": ["bỏ qua"],
  "lỗi": ["đã duyệt", "đang chạy", "lỗi"],
};

function walkTo(s: QueueStore, id: string, target: QueueStatus): void {
  for (const step of PATHS[target]) s.transition("p", id, step);
}
