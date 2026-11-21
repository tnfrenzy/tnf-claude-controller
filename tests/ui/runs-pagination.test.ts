import { describe, expect, it } from "vitest";
import { RunStore, SCOUT_PROMPT_PREFIXES } from "../../src/core/run/run-store.js";

function seed() {
  const store = new RunStore(":memory:");
  const mk = (id: string, prompt: string, status: "done" | "error" = "done") =>
    store.createRun({ id, status, prompt, mode: "m", model: null, session_id: null, parent_run_id: null, project: "p", claude_version: null, run_dir: "D:/x" });
  for (let i = 0; i < 25; i++) mk(`n${String(i).padStart(2, "0")}`, `lenh ${i}`);
  mk("s1", `${SCOUT_PROMPT_PREFIXES[0]}abc" ...`);
  mk("s2", `${SCOUT_PROMPT_PREFIXES[1]}abc" ...`);
  mk("s3", `${SCOUT_PROMPT_PREFIXES[0]}xyz" ...`, "error");
  mk("mid", `noi dung ${SCOUT_PROMPT_PREFIXES[0]}abc" giua`);
  return store;
}

describe("runs pagination and scout filter", () => {
  it("pages with offset and reports total", () => {
    const s = seed();
    expect(s.listRuns({ limit: 10 })).toHaveLength(10);
    expect(s.countRuns({})).toBe(29);
    expect(s.listRuns({ limit: 10, offset: 20 })).toHaveLength(9);
    expect(s.listRuns({ limit: 10, offset: -5 })).toHaveLength(10);
    const a = s.listRuns({ limit: 10, offset: 0 }).map((r) => r.id);
    const b = s.listRuns({ limit: 10, offset: 10 }).map((r) => r.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
    s.close();
  });
  it("filters scout runs by prompt prefix only", () => {
    const s = seed();
    const r = s.listRuns({ scout: true }).map((x) => x.id).sort();
    expect(r).toEqual(["s1", "s2", "s3"]);
    expect(s.countRuns({ scout: true })).toBe(3);
    expect(s.listRuns({ scout: true, status: "done" }).map((x) => x.id).sort()).toEqual(["s1", "s2"]);
    expect(s.countRuns({ scout: true, status: "done" })).toBe(2);
    s.close();
  });
});
