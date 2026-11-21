import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULT_QUEUE_HOTSPOTS, REPO_ROOT } from "../../src/core/app/config.js";
import {
  QUEUE_SPLITTER_ROLE,
  DEFAULT_VERIFY,
  validateSplitterOutput,
  checkIndependence,
  computeWaves,
  checkBodySafety,
  type QueueCommand,
} from "../../src/core/queue/queue-plan.js";

function qc(id: string, files: string[], dependsOn: string[] = [], parallelGroup?: string): QueueCommand {
  const c: QueueCommand = { id, title: id, body: id, files, dependsOn, verify: "npm test", size: 1 };
  if (parallelGroup) c.parallelGroup = parallelGroup;
  return c;
}

describe("checkIndependence", () => {
  const hs = DEFAULT_QUEUE_HOTSPOTS;
  it("overlapping files, directory and case", () => {
    expect(checkIndependence(qc("a", ["src/a.ts"]), qc("b", ["./SRC/A.ts"]), hs).independent).toBe(false);
    const r = checkIndependence(qc("a", ["src/core/"]), qc("b", ["src/core/x.ts"]), hs);
    expect(r.independent).toBe(false);
    expect(r.reason).toContain("cùng sửa");
    expect(checkIndependence(qc("a", ["src/a.ts"]), qc("b", ["src/b.ts"]), hs).independent).toBe(true);
  });
  it("shared hotspot conflicts, different hotspots do not", () => {
    const r = checkIndependence(qc("a", ["src/server/http.ts"]), qc("b", ["src/server/http.ts"]), hs);
    expect(r.independent).toBe(false);
    expect(checkIndependence(qc("a", ["ui/src/i18n.ts"]), qc("b", ["ui/src/App.tsx"]), hs).independent).toBe(true);
  });
  it("glob hotspot", () => {
    const g = ["ui/src/pages/*.tsx"];
    const r = checkIndependence(qc("a", ["ui/src/pages/A.tsx"]), qc("b", ["ui/src/pages/B.tsx"]), g);
    expect(r.independent).toBe(false);
    expect(r.reason).toContain("điểm nóng");
  });
  it("transitive dependency", () => {
    const all = [qc("c1", ["a.ts"]), qc("c2", ["b.ts"], ["c1"]), qc("c3", ["c.ts"], ["c2"])];
    expect(checkIndependence(all[0]!, all[2]!, hs, all).independent).toBe(false);
    expect(checkIndependence(all[0]!, all[2]!, hs).independent).toBe(true);
  });
});

describe("computeWaves", () => {
  const hs = DEFAULT_QUEUE_HOTSPOTS;
  const six = () => [
    qc("c1", ["src/core/config.ts", "tests/config.test.ts"]),
    qc("c2", ["src/core/queue-store.ts", "tests/queue-store.test.ts"]),
    qc("c3", ["src/core/queue-scheduler.ts", "tests/queue-scheduler.test.ts"], ["c1", "c2"]),
    qc("c4", ["src/server/http.ts", "tests/queue-api.test.ts"], ["c2"]),
    qc("c5", ["src/server/http.ts", "tests/queue-cancel.test.ts"], ["c2"]),
    qc("c6", ["ui/src/components/queue/QueuePanel.tsx", "ui/src/i18n.ts", "ui/src/App.tsx", "tests/queue-panel.test.ts"], ["c4", "c5"]),
  ];
  it("six-command example gives waves 1,1,2,2,3,4, deterministic", () => {
    const a = computeWaves(six(), { maxParallel: 2, hotspots: hs });
    expect(a.map((e) => e.wave)).toEqual([1, 1, 2, 2, 3, 4]);
    expect(a[4]!.reasons.join(" ")).toContain("http.ts");
    expect(computeWaves(six(), { maxParallel: 2, hotspots: hs })).toEqual(a);
  });
  it("parallelGroup is a hint: connected members are split with a reason", () => {
    const cmds = [qc("a", ["x.ts"], [], "g"), qc("b", ["y.ts"], ["a"], "g"), qc("c", ["z.ts"], [], "g")];
    const w = computeWaves(cmds, { hotspots: hs });
    expect(w.map((e) => e.wave)).toEqual([1, 2, 1]);
    expect(w[1]!.reasons.join(" ")).toContain("nhóm song song");
  });
  it("compares against earlier placed commands, not just the previous one", () => {
    const cmds = [qc("a", ["f.ts"]), qc("b", ["g.ts"]), qc("c", ["f.ts"])];
    expect(computeWaves(cmds, { hotspots: [] }).map((e) => e.wave)).toEqual([1, 1, 2]);
  });
});

function load(extra: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-queue-"));
  fs.mkdirSync(path.join(root, "config"));
  const file = path.join(root, "config", "controller.json");
  fs.writeFileSync(file, JSON.stringify({ ...extra }));
  try {
    return loadConfig(file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("queue config", () => {
  it("uses defaults when the queue key is missing", () => {
    const q = load({}).queue;
    expect(q.maxParallel).toBe(2);
    expect(q.maxBudgetUsd).toBe(30);
    expect(q.replan.enabled).toBe(false);
    expect(q.hotspots).toEqual(DEFAULT_QUEUE_HOTSPOTS);
    expect(q.hotspots).toContain("src/server/http.ts");
  });
  it("clamps maxParallel to 1..3", () => {
    expect(load({ queue: { maxParallel: 99 } }).queue.maxParallel).toBe(10);
    expect(load({ queue: { maxParallel: 0 } }).queue.maxParallel).toBe(1);
  });
  it("custom hotspots replace the defaults", () => {
    expect(load({ queue: { hotspots: ["a.ts", "", 5, "b/*.ts"] } }).queue.hotspots).toEqual(["a.ts", "b/*.ts"]);
  });
  it("does not throw on malformed queue", () => {
    expect(load({ queue: "x" }).queue.maxParallel).toBe(2);
  });
});

function cmd(over: Record<string, unknown> = {}) {
  return { id: "c1", title: "T", body: "B", files: ["src/a.ts"], dependsOn: [], verify: "npx vitest run", size: 1, ...over };
}
const err = (commands: unknown[]) => {
  const r = validateSplitterOutput({ commands });
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
};

describe("validateSplitterOutput", () => {
  it("accepts valid JSON", () => {
    const r = validateSplitterOutput({ commands: [cmd(), cmd({ id: "c2", dependsOn: ["c1"], parallelGroup: "g", size: 2 })] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commands).toHaveLength(2);
  });
  it("rejects duplicate id", () => {
    expect(err([cmd(), cmd()])).toContain("trùng");
  });
  it("rejects empty files", () => {
    expect(err([cmd({ files: [] })])).toContain("files");
  });
  it("rejects '..' and absolute paths", () => {
    expect(err([cmd({ files: ["../x.ts"] })])).toContain("..");
    expect(err([cmd({ files: ["/etc/x"] })])).toContain("tuyệt đối");
  });
  it("rejects unknown dependsOn", () => {
    expect(err([cmd({ dependsOn: ["zz"] })])).toContain("không tồn tại");
  });
  it("rejects self dependency", () => {
    expect(err([cmd({ dependsOn: ["c1"] })])).toContain("tự trỏ");
  });
  it("rejects cycles", () => {
    expect(err([cmd({ dependsOn: ["c2"] }), cmd({ id: "c2", dependsOn: ["c1"] })])).toContain("vòng");
  });
  it("rejects size 3", () => {
    expect(err([cmd({ size: 3 })])).toContain("size");
  });
  it("rejects unknown keys", () => {
    expect(err([cmd({ extra: 1 })])).toContain("khóa lạ");
    expect(validateSplitterOutput({ commands: [cmd()], note: 1 }).ok).toBe(false);
  });
  it("rejects 21 commands", () => {
    const many = Array.from({ length: 21 }, (_, i) => cmd({ id: `c${i}` }));
    expect(err(many)).toContain("quá lớn");
  });
});

const ref = (over: Record<string, unknown> = {}) => ({ url: "https://example.com/a", title: "T", note: "N", ...over });

describe("references", () => {
  it("accepts 0, 5 and boundary lengths", () => {
    for (const refs of [undefined, [], Array.from({ length: 5 }, () => ref()), [ref({ title: "t".repeat(120), note: "n".repeat(200) })]]) {
      const r = validateSplitterOutput({ commands: [cmd(refs === undefined ? {} : { references: refs })] });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.commands[0]!.references).toHaveLength(refs?.length ?? 0);
    }
  });
  it.each([
    ["6 items", Array.from({ length: 6 }, () => ref()), "tối đa"],
    ["not array", "x", "mảng"],
    ["unknown key", [ref({ extra: 1 })], "khóa lạ"],
    ["missing url", [{ title: "t" }], "url"],
    ["bad url", [ref({ url: "not a url" })], "url"],
    ["ftp", [ref({ url: "ftp://example.com/x" })], "http"],
    ["javascript", [ref({ url: "javascript:alert(1)" })], "http"],
    ["title 121", [ref({ title: "t".repeat(121) })], "title"],
    ["note 201", [ref({ note: "n".repeat(201) })], "note"],
  ])("rejects %s", (_n, refs, msg) => {
    expect(err([cmd({ references: refs })])).toContain(msg);
  });
});

describe("checkBodySafety", () => {
  it.each([
    "run git push origin main",
    "rm -rf build",
    "rm -fr build",
    "use --dangerously-skip-permissions",
    "set bypassPermissions",
    "echo $ANTHROPIC_API_KEY",
    "echo $ANTHROPIC_AUTH_TOKEN",
  ])("errors on %s", (b) => {
    expect(checkBodySafety(b).errors).toHaveLength(1);
    expect(err([cmd({ body: b })])).toContain("từ chối");
  });
  it.each([
    "see https://example.com",
    "curl x",
    "wget x",
    "iwr x",
    "Invoke-WebRequest x",
    "npm install -g foo",
    "pip install foo",
    "Set-ExecutionPolicy Bypass",
  ])("warns on %s", (b) => {
    const s = checkBodySafety(b);
    expect(s.errors).toHaveLength(0);
    expect(s.warnings).toHaveLength(1);
    const r = validateSplitterOutput({ commands: [cmd({ body: b })] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commands[0]!.warnings).toHaveLength(1);
  });
  it("clean body has nothing; case-insensitive; one entry per pattern", () => {
    expect(checkBodySafety("Sửa hàm add và chạy test")).toEqual({ errors: [], warnings: [] });
    expect(checkBodySafety("GIT   PUSH").errors).toHaveLength(1);
    expect(checkBodySafety("CURL http://a.b and curl again").warnings).toHaveLength(2);
    expect(checkBodySafety("git pushed, myrm -rf2").errors).toHaveLength(0);
  });
});

describe("splitter role id", () => {
  it("does not collide with other role ids", () => {
    expect(QUEUE_SPLITTER_ROLE).toBe("idea-splitter");
    const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", f), "utf8")) as unknown;
    const coding = Object.keys(rd("roles-coding.json") as object);
    const research = Object.keys(rd("roles-research.json") as object);
    const catalog = (rd("roles-catalog.json") as { id: string }[]).map((r) => r.id);
    expect(coding).not.toContain(QUEUE_SPLITTER_ROLE);
    expect(research).not.toContain(QUEUE_SPLITTER_ROLE);
    expect(catalog).not.toContain(QUEUE_SPLITTER_ROLE);
  });
});

describe("validateSplitterOutput repairs harmless slips instead of rejecting the batch", () => {
  const ok = (commands: unknown[]) => {
    const r = validateSplitterOutput({ commands });
    expect(r.ok).toBe(true);
    return r.ok ? r.commands : [];
  };

  it("an empty, missing or whitespace verify gets the default text", () => {
    const [a, b, c] = ok([cmd({ id: "a", verify: "" }), cmd({ id: "b", verify: undefined }), cmd({ id: "c", verify: "   " })]);
    for (const x of [a, b, c]) expect(x!.verify).toBe(DEFAULT_VERIFY);
  });

  it("a verify longer than 300 characters is cut with an ellipsis and stays within the limit", () => {
    const [a] = ok([cmd({ verify: "x".repeat(500) })]);
    expect(a!.verify.length).toBeLessThanOrEqual(300);
    expect(a!.verify.endsWith("…")).toBe(true);
  });

  it("a title longer than 120 characters is cut, an empty title is still rejected", () => {
    const [a] = ok([cmd({ title: "t".repeat(200) })]);
    expect(a!.title.length).toBeLessThanOrEqual(120);
    expect(err([cmd({ title: "  " })])).toContain("title");
  });

  it("a verify that is not a string is still an error", () => {
    expect(err([cmd({ verify: 42 })])).toContain("verify");
  });

  it("one command with a missing verify no longer voids the other commands in the batch", () => {
    const list = ok([cmd({ id: "a" }), cmd({ id: "b", dependsOn: ["a"], verify: "" })]);
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("safety and structure are still strict (forbidden body pattern, dependency cycle)", () => {
    expect(err([cmd({ body: "chạy git push origin main" })])).toContain("c1");
    expect(err([cmd({ id: "a", dependsOn: ["b"] }), cmd({ id: "b", dependsOn: ["a"] })])).toMatch(/vòng|chu trình|cycle/i);
  });
});
