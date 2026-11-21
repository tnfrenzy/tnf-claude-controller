import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/core/app/config.js";

function load(extra: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-towers-"));
  fs.mkdirSync(path.join(root, "config"));
  const file = path.join(root, "config", "controller.json");
  fs.writeFileSync(file, JSON.stringify({ ...extra }));
  try {
    return loadConfig(file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("ui.towers", () => {
  it("defaults when key is missing", () => {
    expect(load({}).ui.towers).toEqual(["TNF Tower", "Huấn luyện AI"]);
  });
  it("maps legacy Tower 2 to the new default, keeps custom names", () => {
    expect(load({ ui: { towers: ["TNF Tower", "Tower 2"] } }).ui.towers).toEqual(["TNF Tower", "Huấn luyện AI"]);
    expect(load({ ui: { towers: ["A", "Kho"] } }).ui.towers).toEqual(["A", "Kho"]);
  });
  it("uses configured names (trimmed)", () => {
    expect(load({ ui: { towers: [" Alpha ", "Beta"] } }).ui.towers).toEqual(["Alpha", "Beta"]);
  });
  it("falls back on malformed arrays", () => {
    expect(load({ ui: { towers: ["only"] } }).ui.towers).toEqual(["TNF Tower", "Huấn luyện AI"]);
    expect(load({ ui: { towers: [1, 2] } }).ui.towers).toEqual(["TNF Tower", "Huấn luyện AI"]);
    expect(load({ ui: { towers: ["a", "  "] } }).ui.towers).toEqual(["TNF Tower", "Huấn luyện AI"]);
  });
  it("caps names at 40 chars", () => {
    expect(load({ ui: { towers: ["x".repeat(60), "b"] } }).ui.towers[0]).toHaveLength(40);
  });
});
