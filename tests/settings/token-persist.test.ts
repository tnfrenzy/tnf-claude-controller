import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadOrCreateToken, writeTokenFile } from "../../src/server/auth.js";

describe("loadOrCreateToken", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-token-"));

  it("creates a 48-hex token when no file exists", () => {
    expect(loadOrCreateToken(tmp())).toMatch(/^[0-9a-f]{48}$/);
  });

  it("reuses the saved token across restarts", () => {
    const dir = tmp();
    const saved = "ab".repeat(24);
    writeTokenFile(dir, saved);
    expect(loadOrCreateToken(dir)).toBe(saved);
    expect(loadOrCreateToken(dir)).toBe(saved);
  });

  it("replaces a malformed token file", () => {
    const dir = tmp();
    writeTokenFile(dir, "short");
    expect(loadOrCreateToken(dir)).toMatch(/^[0-9a-f]{48}$/);
  });
});
