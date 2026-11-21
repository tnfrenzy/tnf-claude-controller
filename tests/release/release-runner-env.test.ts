import os from "node:os";
import { describe, expect, it } from "vitest";
import { defaultRunner } from "../../src/core/release/pipeline.js";
import { findGitBash, minimalScriptEnv } from "../../src/core/release/bash-locator.js";

describe("defaultRunner env and timeout", () => {
  it("replaces the environment instead of inheriting it", async () => {
    process.env["TNF_TEST_LEAK"] = "leaked";
    const code = "console.log(String(process.env.TNF_TEST_LEAK)+'|'+String(process.env.ONLY_ME))";
    const r = await defaultRunner([process.execPath, "-e", code], { cwd: os.tmpdir(), env: { ONLY_ME: "yes" } });
    expect(r.exitCode).toBe(0);
    expect(r.output.trim()).toBe("undefined|yes");
    delete process.env["TNF_TEST_LEAK"];
  });

  it("keeps inheriting by default", async () => {
    process.env["TNF_TEST_INH"] = "inh";
    const r = await defaultRunner([process.execPath, "-e", "console.log(process.env.TNF_TEST_INH)"], { cwd: os.tmpdir() });
    expect(r.output.trim()).toBe("inh");
    delete process.env["TNF_TEST_INH"];
  });

  it("kills the process and reports timeout", async () => {
    const t0 = Date.now();
    const r = await defaultRunner([process.execPath, "-e", "setTimeout(()=>{},60000)"], { cwd: os.tmpdir(), timeoutMs: 500 });
    expect(r.error).toBe("timeout");
    expect(r.exitCode).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});

describe("findGitBash", () => {
  it("finds bash under ProgramFiles", () => {
    const env = { ProgramFiles: "C:\\PF" } as NodeJS.ProcessEnv;
    const found = findGitBash(env, (p) => /PF.Git.bin.bash\.exe$/.test(p));
    expect(found).toMatch(/bash\.exe$/);
  });
  it("finds bash under LOCALAPPDATA", () => {
    const env = { LOCALAPPDATA: "C:\\L" } as NodeJS.ProcessEnv;
    expect(findGitBash(env, (p) => p.includes("Programs"))).toMatch(/Programs.Git.bin.bash\.exe$/);
  });
  it("returns null when nothing exists", () => {
    expect(findGitBash({ ProgramFiles: "C:\\PF" } as NodeJS.ProcessEnv, () => false)).toBeNull();
  });
});

describe("minimalScriptEnv", () => {
  it("only has minimal keys plus the key variable", () => {
    const env = minimalScriptEnv({ keyEnvName: "DEPLOY_KEY", keyPath: "C:\\k\\id", bashPath: "C:\\Git\\bin\\bash.exe", env: { SECRET_TOKEN: "x", USERPROFILE: "C:\\U" } as NodeJS.ProcessEnv });
    expect(env["DEPLOY_KEY"]).toBe("C:\\k\\id");
    expect(env["SECRET_TOKEN"]).toBeUndefined();
    expect(env["HOME"]).toBe("C:\\U");
    expect(env["LANG"]).toBeTruthy();
    expect(env["PATH"]).toBeTruthy();
  });
});
