import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, parseAutomation } from "../../src/core/app/config.js";

function load(extra: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-automation-"));
  fs.mkdirSync(path.join(root, "config"));
  const file = path.join(root, "config", "controller.json");
  fs.writeFileSync(file, JSON.stringify({ ...extra }));
  try {
    return loadConfig(file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const DEFAULTS = { enabled: false, maxRetries: 0, schedule: null, webhooks: [] };

describe("parseAutomation", () => {
  it("uses safe defaults when missing", () => {
    expect(parseAutomation(undefined)).toEqual(DEFAULTS);
    expect(parseAutomation(null)).toEqual(DEFAULTS);
    expect(parseAutomation({})).toEqual(DEFAULTS);
  });

  it("accepts and normalises valid values", () => {
    const r = parseAutomation({
      enabled: true,
      maxRetries: 3,
      schedule: " */15 * * * * ",
      webhooks: [" https://example.com/hook ", "https://example.com/hook", "https://hooks.example.org/a"],
    });
    expect(r).toEqual({
      enabled: true,
      maxRetries: 3,
      schedule: "*/15 * * * *",
      webhooks: ["https://example.com/hook", "https://hooks.example.org/a"],
    });
  });

  it("treats empty schedule as null", () => {
    expect(parseAutomation({ schedule: "   " }).schedule).toBeNull();
    expect(parseAutomation({ schedule: null }).schedule).toBeNull();
  });

  it("throws on bad enabled / maxRetries", () => {
    expect(() => parseAutomation({ enabled: "yes" })).toThrow(/config: automation/);
    expect(() => parseAutomation({ maxRetries: 4 })).toThrow(/config: automation/);
    expect(() => parseAutomation({ maxRetries: -1 })).toThrow(/config: automation/);
    expect(() => parseAutomation({ maxRetries: 1.5 })).toThrow(/config: automation/);
  });

  it("throws on non-object automation (including arrays)", () => {
    expect(() => parseAutomation([])).toThrow(/config: automation/);
    expect(() => parseAutomation("x")).toThrow(/config: automation/);
  });

  it("throws on bad schedule", () => {
    expect(() => parseAutomation({ schedule: "abc" })).toThrow(/config: automation/);
    expect(() => parseAutomation({ schedule: "0 */15 * * * *" })).toThrow(/config: automation/);
    expect(() => parseAutomation({ schedule: 5 })).toThrow(/config: automation/);
  });

  it("throws on bad webhooks", () => {
    const bad = [
      "http://example.com",
      "https://localhost/x",
      "https://app.localhost/x",
      "https://printer.local/x",
      "https://192.168.1.5/x",
      "https://10.0.0.1",
      "https://172.16.0.1",
      "https://0.0.0.0",
      "https://127.0.0.1",
      "https://169.254.1.1",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://user:pass@example.com/",
      "not a url",
    ];
    for (const u of bad) {
      expect(() => parseAutomation({ webhooks: [u] }), u).toThrow(/config: automation/);
    }
    expect(() => parseAutomation({ webhooks: [5] })).toThrow(/config: automation/);
    expect(() => parseAutomation({ webhooks: "https://example.com" })).toThrow(/config: automation/);
    const eleven = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    expect(() => parseAutomation({ webhooks: eleven })).toThrow(/config: automation/);
  });

  it("allows public IPs", () => {
    expect(parseAutomation({ webhooks: ["https://8.8.8.8/x", "https://172.32.0.1/x"] }).webhooks).toHaveLength(2);
  });
});

describe("loadConfig automation", () => {
  it("returns configured automation", () => {
    const c = load({ automation: { enabled: true, maxRetries: 2, schedule: "0 9 * * 1-5", webhooks: ["https://example.com/h"] } });
    expect(c.automation).toEqual({ enabled: true, maxRetries: 2, schedule: "0 9 * * 1-5", webhooks: ["https://example.com/h"] });
  });
  it("defaults when key is missing", () => {
    expect(load({}).automation).toEqual(DEFAULTS);
  });
  it("real config/controller.json has automation off", () => {
    const real = path.resolve(__dirname, "..", "..", "config", "controller.json");
    expect(loadConfig(real).automation).toEqual(DEFAULTS);
    expect(JSON.parse(fs.readFileSync(real, "utf8")).automation).toEqual(DEFAULTS);
  });
  it("throws on invalid values", () => {
    expect(() => load({ automation: { maxRetries: 9 } })).toThrow(/config: automation/);
  });
});
