import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(resolve(__dirname, "..", "..", "installer", "setup.iss"), "utf8");
const iss = raw.replace(/^﻿/, "");
const lines = iss.split(/\r?\n/);

function section(name: string): string {
  const start = iss.indexOf(`\n[${name}]`) + 1;
  expect(start).toBeGreaterThan(0);
  const next = iss.indexOf("\n[", start + 1);
  return iss.slice(start, next === -1 ? undefined : next);
}

describe("installer/setup.iss", () => {
  const files = section("Files").split(/\r?\n/);
  const code = section("Code");

  it("ships controller.default.json with ignoreversion", () => {
    const rows = files.filter((l) => /^Source:\s*"\.\.\\build\\app\\config\\controller\.default\.json"/.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('DestDir: "{app}\\app\\config"');
    expect(rows[0]).toContain("ignoreversion");
  });

  it("keeps an existing controller.json (onlyifdoesntexist)", () => {
    const rows = files.filter((l) => /^Source:\s*"\.\.\\build\\app\\config\\controller\.json"/.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("onlyifdoesntexist");
  });

  it("excludes both config files from the wildcard line", () => {
    const row = files.find((l) => l.startsWith('Source: "..\\build\\app\\*"'));
    expect(row).toBeDefined();
    expect(row).toContain("config\\controller.json");
    expect(row).toContain("config\\controller.default.json");
  });

  it("has the post-install merge step in [Code]", () => {
    for (const s of ["CurStepChanged", "ssPostInstall", "merge-config-cli.js", "SW_HIDE", "FileCopy", "Log("]) {
      expect(code).toContain(s);
    }
  });

  it("sets HadConfig inside PrepareToInstall, before CurStepChanged", () => {
    const prep = iss.indexOf("function PrepareToInstall");
    const had = iss.indexOf("HadConfig :=");
    const step = iss.indexOf("procedure CurStepChanged");
    expect(prep).toBeGreaterThanOrEqual(0);
    expect(had).toBeGreaterThan(prep);
    expect(step).toBeGreaterThan(had);
  });

  it("still deletes the app folder on uninstall", () => {
    const un = iss.indexOf("procedure CurUninstallStepChanged");
    const del = iss.indexOf("DelTree(ExpandConstant('{app}\\app')");
    expect(un).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(un);
  });

  it("passes Cfg before Def to merge-config-cli", () => {
    const exec = lines.find((l) => l.includes("Exec(Node"));
    expect(exec).toBeDefined();
    expect(exec!.indexOf("Cfg")).toBeGreaterThan(-1);
    expect(exec!.indexOf("Cfg")).toBeLessThan(exec!.indexOf("Def"));
  });

  it("has no replacement characters", () => {
    expect(iss).not.toContain("�");
  });
});
