import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELEASE_TEMPLATES, ReleaseConfigError, readReleaseConfig, releaseConfigPath, validateReleaseConfig, writeReleaseConfig,
} from "../../src/core/release/config.js";

const ssh = (over: Record<string, unknown>) => ({
  extraScripts: [],
  steps: [{ type: "ssh-deploy", host: "h.example.com", user: "u", port: 22, keyPath: "k", remoteDir: "/var/www", ...over }],
});

describe("release config", () => {
  it("both templates are valid", () => {
    for (const t of Object.values(RELEASE_TEMPLATES)) expect(validateReleaseConfig(t)).toEqual(t);
    expect(RELEASE_TEMPLATES["windows-installer"]!.steps.map((s) => s.type)).toEqual(["build", "bump", "build", "build"]);
    expect(RELEASE_TEMPLATES["web-vps"]!.steps.map((s) => s.type)).toEqual(["bump", "build", "tag", "git-push", "project-script", "healthcheck"]);
  });

  it("rejects unknown script, extraScripts opens it", () => {
    const cfg = { extraScripts: [], steps: [{ type: "build", script: "deploy" }] };
    expect(() => validateReleaseConfig(cfg)).toThrow(ReleaseConfigError);
    expect(() => validateReleaseConfig(cfg)).toThrow(/không nằm trong danh sách/);
    expect(validateReleaseConfig({ ...cfg, extraScripts: ["deploy"] }).steps[0]).toEqual({ type: "build", script: "deploy" });
    expect(() => validateReleaseConfig({ extraScripts: ["a b"], steps: [{ type: "bump" }] })).toThrow(/không hợp lệ/);
  });

  it("rejects dangerous host, keyPath, remoteDir", () => {
    expect(() => validateReleaseConfig(ssh({ host: "-oProxyCommand=x" }))).toThrow(/host/);
    expect(() => validateReleaseConfig(ssh({ host: "a/../b" }))).toThrow(/host/);
    expect(() => validateReleaseConfig(ssh({ keyPath: "../k" }))).toThrow(/khóa SSH/);
    expect(() => validateReleaseConfig(ssh({ remoteDir: "/a; rm -rf" }))).toThrow(/thư mục đích/);
    expect(() => validateReleaseConfig(ssh({ port: 70000 }))).toThrow(/port/);
  });

  it("rejects secret fields and bad url", () => {
    expect(() => validateReleaseConfig(ssh({ password: "x" }))).toThrow(/password/);
    expect(() => validateReleaseConfig(ssh({ token: "x" }))).toThrow(/token/);
    expect(() => validateReleaseConfig({ extraScripts: [], steps: [{ type: "healthcheck", url: "ftp://x" }] })).toThrow(/url/);
  });

  it("writes then reads back; missing file is null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-relcfg-"));
    try {
      expect(readReleaseConfig(dir, "proj")).toBeNull();
      writeReleaseConfig(dir, "proj", RELEASE_TEMPLATES["web-vps"]);
      expect(fs.existsSync(releaseConfigPath(dir, "proj"))).toBe(true);
      expect(readReleaseConfig(dir, "proj")).toEqual(RELEASE_TEMPLATES["web-vps"]);
      expect(() => writeReleaseConfig(dir, "proj", { steps: [] })).toThrow(ReleaseConfigError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
