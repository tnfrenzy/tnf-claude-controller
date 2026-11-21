import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMergeConfig, main } from "../../src/merge-config-cli.js";

const failure = vi.hoisted(() => ({ rename: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (failure.rename) throw new Error("EPERM simulated");
      return actual.renameSync(...args);
    },
  };
});

function printed(): string {
  return JSON.stringify([
    vi.mocked(console.log).mock.calls,
    vi.mocked(console.error).mock.calls,
  ]);
}

let dir: string;
let existing: string;
let defaults: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tnf-merge-"));
  existing = path.join(dir, "controller.json");
  defaults = path.join(dir, "defaults.json");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("merge-config-cli", () => {
  it("does not overwrite a corrupt existing file and exits non-zero", () => {
    writeFileSync(existing, "{ not json", "utf8");
    writeFileSync(defaults, JSON.stringify({ a: 1 }), "utf8");
    expect(runMergeConfig(existing, defaults)).not.toBe(0);
    expect(readFileSync(existing, "utf8")).toBe("{ not json");
    expect(existsSync(existing + ".bak")).toBe(false);
  });

  it("writes backup, BOM-free 2-space JSON with trailing newline, adds new default keys", () => {
    writeFileSync(existing, "﻿" + JSON.stringify({ keep: 1 }), "utf8");
    writeFileSync(defaults, JSON.stringify({ keep: 9, added: 2 }), "utf8");
    expect(runMergeConfig(existing, defaults)).toBe(0);
    const raw = readFileSync(existing);
    expect(raw[0]).not.toBe(0xef);
    const text = raw.toString("utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "keep": 1');
    expect(JSON.parse(text)).toEqual({ keep: 1, added: 2 });
    expect(readFileSync(existing + ".bak", "utf8")).toBe("﻿" + JSON.stringify({ keep: 1 }));
    expect(existsSync(existing + ".tmp")).toBe(false);
  });

  it("does not write or back up when the result is unchanged (idempotent)", () => {
    writeFileSync(existing, JSON.stringify({ keep: 1 }), "utf8");
    writeFileSync(defaults, JSON.stringify({ keep: 1, added: 2 }), "utf8");
    expect(runMergeConfig(existing, defaults)).toBe(0);
    rmSync(existing + ".bak");
    const before = readFileSync(existing, "utf8");
    expect(runMergeConfig(existing, defaults)).toBe(0);
    expect(readFileSync(existing, "utf8")).toBe(before);
    expect(existsSync(existing + ".bak")).toBe(false);
  });

  it("does not print config content", () => {
    writeFileSync(existing, JSON.stringify({ keep: "SECRET-VALUE-123" }), "utf8");
    writeFileSync(defaults, JSON.stringify({ added: "OTHER-VALUE-456" }), "utf8");
    runMergeConfig(existing, defaults);
    const out = JSON.stringify([
      vi.mocked(console.log).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    expect(out).not.toContain("SECRET-VALUE-123");
    expect(out).not.toContain("OTHER-VALUE-456");
  });

  it("does not leak secret text or SyntaxError message from a corrupt file", () => {
    writeFileSync(existing, '{ "k": "SECRET-XYZ" oops', "utf8");
    writeFileSync(defaults, JSON.stringify({ a: 1 }), "utf8");
    expect(runMergeConfig(existing, defaults)).not.toBe(0);
    const out = printed();
    expect(out).not.toContain("SECRET-XYZ");
    expect(out).not.toContain("SyntaxError");
    expect(out).not.toContain("Unexpected");
    expect(readFileSync(existing, "utf8")).toBe('{ "k": "SECRET-XYZ" oops');
  });

  it("keeps existing untouched when defaults JSON is corrupt", () => {
    writeFileSync(existing, JSON.stringify({ keep: 1 }), "utf8");
    writeFileSync(defaults, "{ broken", "utf8");
    expect(runMergeConfig(existing, defaults)).not.toBe(0);
    expect(readFileSync(existing, "utf8")).toBe(JSON.stringify({ keep: 1 }));
    expect(existsSync(existing + ".bak")).toBe(false);
    expect(existsSync(existing + ".tmp")).toBe(false);
  });

  it("rewrites a valid file that differs only by whitespace/CRLF, with backup", () => {
    const original = '{\r\n    "keep": 1\r\n}\r\n';
    writeFileSync(existing, original, "utf8");
    writeFileSync(defaults, JSON.stringify({ keep: 1 }), "utf8");
    expect(runMergeConfig(existing, defaults)).toBe(0);
    expect(readFileSync(existing, "utf8")).toBe('{\n  "keep": 1\n}\n');
    expect(readFileSync(existing + ".bak", "utf8")).toBe(original);
  });

  it("drops apiKey/token/secret keys and keeps the original in .bak", () => {
    const original = JSON.stringify({ keep: 1, apiKey: "K-1", nested: { token: "T-1", secret: "S-1", ok: 2 } });
    writeFileSync(existing, original, "utf8");
    writeFileSync(defaults, JSON.stringify({ keep: 1, added: 3 }), "utf8");
    expect(runMergeConfig(existing, defaults)).toBe(0);
    const text = readFileSync(existing, "utf8");
    expect(text).not.toMatch(/K-1|T-1|S-1/);
    expect(text).not.toMatch(/apiKey|token|secret/i);
    expect(JSON.parse(text).nested.ok).toBe(2);
    expect(readFileSync(existing + ".bak", "utf8")).toBe(original);
  });

  it("returns 1 on write failure, leaves existing unchanged and no .tmp", () => {
    const original = JSON.stringify({ keep: 1 });
    writeFileSync(existing, original, "utf8");
    writeFileSync(defaults, JSON.stringify({ keep: 1, added: 2 }), "utf8");
    failure.rename = true;
    try {
      expect(runMergeConfig(existing, defaults)).toBe(1);
    } finally {
      failure.rename = false;
    }
    expect(readFileSync(existing, "utf8")).toBe(original);
    expect(existsSync(existing + ".tmp")).toBe(false);
  });

  it("importing the module does not run main or print anything", async () => {
    vi.resetModules();
    await import("../../src/merge-config-cli.js");
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns 2 on missing arguments", () => {
    expect(main([])).toBe(2);
  });
});
