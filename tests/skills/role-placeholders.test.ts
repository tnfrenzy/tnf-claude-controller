import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderRolePlaceholders } from "../../src/core/run/run-manager.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("renderRolePlaceholders", () => {
  it("fills known placeholders", () => {
    const roles: Record<string, Record<string, unknown>> = { qa: { prompt: "Sigs: {{knownEnvFailures}}." } };
    renderRolePlaceholders(roles, { knownEnvFailures: "- -4094" });
    expect(roles["qa"]!["prompt"]).toBe("Sigs: - -4094.");
  });

  it("throws a Vietnamese error naming the role when a placeholder is left", () => {
    const roles: Record<string, Record<string, unknown>> = { qa: { prompt: "x {{oops}}" } };
    expect(() => renderRolePlaceholders(roles, {})).toThrow(/vai "qa".*\{\{oops\}\}/);
  });

  it("ignores roles without a string prompt", () => {
    const roles: Record<string, Record<string, unknown>> = { a: { description: "d" } };
    expect(() => renderRolePlaceholders(roles, {})).not.toThrow();
  });

  it("the shipped coding qa prompt uses the knownEnvFailures placeholder and renders fully", () => {
    const roles = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "roles-coding.json"), "utf8")) as Record<string, Record<string, unknown>>;
    expect(String(roles["qa"]!["prompt"])).toContain("{{knownEnvFailures}}");
    expect(() => renderRolePlaceholders(roles, { knownEnvFailures: "- a" })).not.toThrow();
    expect(String(roles["qa"]!["prompt"])).not.toMatch(/\{\{/);
  });
});
