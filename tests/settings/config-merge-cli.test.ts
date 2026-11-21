import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/merge-config-cli.js";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const EXISTING = { model: "my-model", limits: { maxTurns: 7 } };
const DEFAULTS = { model: "default-model", newKey: "fresh", limits: { maxTurns: 30, newLimit: 5 } };

let dir: string;
let existingPath: string;
let defaultsPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "tnf-merge-cli-"));
  existingPath = path.join(dir, "controller.json");
  defaultsPath = path.join(dir, "defaults.json");
  writeFileSync(defaultsPath, JSON.stringify(DEFAULTS, null, 2), "utf8");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("merge-config-cli main (file-based)", () => {
  it("adds missing keys and keeps user values", () => {
    writeFileSync(existingPath, JSON.stringify(EXISTING, null, 2), "utf8");
    expect(main([existingPath, defaultsPath])).toBe(0);
    const out = JSON.parse(readFileSync(existingPath, "utf8"));
    expect(out.newKey).toBe("fresh");
    expect(out.limits.newLimit).toBe(5);
    expect(out.model).toBe("my-model");
    expect(out.limits.maxTurns).toBe(7);
  });

  it("creates a byte-identical .bak of the original (with BOM)", () => {
    const original = Buffer.concat([BOM, Buffer.from(JSON.stringify(EXISTING, null, 2), "utf8")]);
    writeFileSync(existingPath, original);
    expect(main([existingPath, defaultsPath])).toBe(0);
    const bak = readFileSync(existingPath + ".bak");
    expect(bak.equals(original)).toBe(true);
    expect(existsSync(existingPath + ".tmp")).toBe(false);
  });

  it("writes without BOM, even when the original had one", () => {
    writeFileSync(existingPath, Buffer.concat([BOM, Buffer.from(JSON.stringify(EXISTING), "utf8")]));
    expect(main([existingPath, defaultsPath])).toBe(0);
    const bytes = readFileSync(existingPath);
    expect(bytes.subarray(0, 3).equals(BOM)).toBe(false);
    expect(JSON.parse(bytes.toString("utf8")).newKey).toBe("fresh");
  });

  it("does not touch a file with broken JSON and returns 1", () => {
    const broken = Buffer.from('{ "model": "x", ', "utf8");
    writeFileSync(existingPath, broken);
    expect(main([existingPath, defaultsPath])).toBe(1);
    expect(readFileSync(existingPath).equals(broken)).toBe(true);
    expect(existsSync(existingPath + ".bak")).toBe(false);
    expect(existsSync(existingPath + ".tmp")).toBe(false);
  });

  it("returns 2 on missing arguments and leaves the file unchanged", () => {
    const original = Buffer.from(JSON.stringify(EXISTING), "utf8");
    writeFileSync(existingPath, original);
    expect(main([])).toBe(2);
    expect(main([existingPath])).toBe(2);
    expect(readFileSync(existingPath).equals(original)).toBe(true);
    expect(existsSync(existingPath + ".bak")).toBe(false);
  });
});
