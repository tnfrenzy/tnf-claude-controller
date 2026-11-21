import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fake = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");

function stream(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.01 }) + "\n";
}

function call(env: Record<string, string>): string {
  const r = spawnSync("node", [fake, "-p"], { input: "x", encoding: "utf8", env: { ...process.env, ...env } });
  return r.stdout;
}

describe("fake-claude sequence", () => {
  it("picks fixture by call index and repeats last", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakeseq-"));
    const a = path.join(dir, "a.jsonl");
    const b = path.join(dir, "b.jsonl");
    fs.writeFileSync(a, stream("AAA"));
    fs.writeFileSync(b, stream("BBB"));
    const env = { FAKE_CLAUDE_SEQUENCE: `${a}|${b}`, FAKE_CLAUDE_COUNTER_FILE: path.join(dir, "counter.txt") };
    expect(call(env)).toContain("AAA");
    expect(call(env)).toContain("BBB");
    expect(call(env)).toContain("BBB");
  });

  it("falls back to FAKE_CLAUDE_FIXTURE without sequence env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakeseq-"));
    const a = path.join(dir, "a.jsonl");
    fs.writeFileSync(a, stream("ONLY"));
    const out = call({ FAKE_CLAUDE_FIXTURE: a, FAKE_CLAUDE_SEQUENCE: "", FAKE_CLAUDE_COUNTER_FILE: "" });
    expect(out).toContain("ONLY");
  });
});
