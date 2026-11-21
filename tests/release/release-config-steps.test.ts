import { describe, it, expect } from "vitest";
import { validateReleaseConfig, ReleaseConfigError } from "../../src/core/release/config.js";

const script = (over: Record<string, unknown> = {}) => ({
  type: "project-script",
  scriptPath: "deploy/run.sh",
  target: "deploy@example.com",
  keyPath: "C:/keys/id_ed25519",
  keyEnvName: "DEPLOY_KEY",
  ...over,
});
const cfg = (...steps: unknown[]) => ({ steps });
const push = (over: Record<string, unknown> = {}) => ({ type: "git-push", remote: "origin", ...over });

describe("release config: git-push, project-script, healthcheck", () => {
  it("accepts valid steps", () => {
    const c = validateReleaseConfig(cfg(push({ branch: "main", tag: "v1.0.0" }), script({ timeoutMin: 30 }), { type: "healthcheck", url: "https://example.com/", expectStatus: 200 }));
    expect(c.steps.map((s) => s.type)).toEqual(["git-push", "project-script", "healthcheck"]);
    expect(c.steps[0]).toEqual({ type: "git-push", remote: "origin", branch: "main", tag: "v1.0.0" });
  });

  it("git-push works without branch/tag", () => {
    expect(validateReleaseConfig(cfg(push())).steps[0]).toEqual({ type: "git-push", remote: "origin" });
  });

  it("rejects bad branch/tag names", () => {
    for (const b of ["-x", "+main", "a:b", "a b", "a..b"]) {
      expect(() => validateReleaseConfig(cfg(push({ branch: b })))).toThrow(ReleaseConfigError);
      expect(() => validateReleaseConfig(cfg(push({ tag: b })))).toThrow(ReleaseConfigError);
    }
  });

  it("rejects force-like or unknown keys on git-push", () => {
    expect(() => validateReleaseConfig(cfg(push({ force: true })))).toThrow(ReleaseConfigError);
  });

  it("rejects bad scriptPath", () => {
    for (const p of ["../x.sh", "a/../x.sh", "/abs/x.sh", "C:/x.sh", "deploy/run.py", "-x.sh", "deploy\\..\\x.sh"]) {
      expect(() => validateReleaseConfig(cfg(script({ scriptPath: p }))), p).toThrow(ReleaseConfigError);
    }
  });

  it("rejects bad target, key env name, timeout", () => {
    for (const t of ["example.com", "user@", "@host", "user@host;rm", "us er@host", "-o@host x"]) {
      expect(() => validateReleaseConfig(cfg(script({ target: t }))), t).toThrow(ReleaseConfigError);
    }
    for (const n of ["deploy_key", "1KEY", "KEY-X", "A B"]) {
      expect(() => validateReleaseConfig(cfg(script({ keyEnvName: n }))), n).toThrow(ReleaseConfigError);
    }
    for (const m of [31, 0, 1.5, "10"]) {
      expect(() => validateReleaseConfig(cfg(script({ timeoutMin: m })))).toThrow(ReleaseConfigError);
    }
  });

  it("rejects unknown keys (no secrets) on project-script", () => {
    expect(() => validateReleaseConfig(cfg(script({ password: "x" })))).toThrow(ReleaseConfigError);
  });

  it("healthcheck accepts only http(s) urls", () => {
    expect(() => validateReleaseConfig(cfg({ type: "healthcheck", url: "ftp://example.com/" }))).toThrow(ReleaseConfigError);
    expect(() => validateReleaseConfig(cfg({ type: "healthcheck", url: "https://u:p@example.com/" }))).toThrow(ReleaseConfigError);
    expect(validateReleaseConfig(cfg({ type: "healthcheck", url: "http://example.com/" })).steps[0]).toEqual({ type: "healthcheck", url: "http://example.com/", expectStatus: 200 });
  });

  it("still reads an old release.json with ssh-deploy", () => {
    const c = validateReleaseConfig(cfg({ type: "ssh-deploy", host: "h.example.com", user: "u", port: 22, keyPath: "k", remoteDir: "/var/www" }, push()));
    expect(c.steps.map((s) => s.type)).toEqual(["ssh-deploy", "git-push"]);
  });
});
