import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoBare, BillingGuardError, checkAuthMethod, parseAuthStatus, queryAuthStatus, runBillingGuard, sanitizeEnv } from "../../src/core/run/billing-guard.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");

describe("sanitizeEnv", () => {
  it("removes billing variables in subscription mode", () => {
    const env = sanitizeEnv({ PATH: "x", ANTHROPIC_API_KEY: "sk-1", anthropic_auth_token: "t", CLAUDE_CODE_USE_BEDROCK: "1", KEEP: "1" }, "subscription");
    expect(env).toEqual({ PATH: "x", KEEP: "1" });
  });
  it("keeps them in api mode", () => {
    const env = sanitizeEnv({ ANTHROPIC_API_KEY: "sk-1" }, "api");
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-1");
  });
});

describe("assertNoBare", () => {
  it("rejects --bare in subscription mode", () => {
    expect(() => assertNoBare(["-p", "--bare"], "subscription")).toThrow(BillingGuardError);
    expect(() => assertNoBare(["-p"], "subscription")).not.toThrow();
    expect(() => assertNoBare(["--bare"], "api")).not.toThrow();
  });
});

describe("checkAuthMethod", () => {
  const st = (authMethod: string, loggedIn = true) => parseAuthStatus(JSON.stringify({ loggedIn, authMethod }));
  it("accepts claude.ai and oauth_token", () => {
    expect(() => checkAuthMethod(st("claude.ai"), "subscription")).not.toThrow();
    expect(() => checkAuthMethod(st("oauth_token"), "subscription")).not.toThrow();
  });
  it("rejects api_key in subscription mode with kind api_billing", () => {
    try {
      checkAuthMethod(st("api_key"), "subscription");
      expect.fail("should throw");
    } catch (e) {
      expect((e as BillingGuardError).kind).toBe("api_billing");
    }
  });
  it("rejects not logged in", () => {
    expect(() => checkAuthMethod(st("none", false), "subscription")).toThrow(/Chưa đăng nhập/);
  });
  it("allows api_key in api mode", () => {
    expect(() => checkAuthMethod(st("api_key"), "api")).not.toThrow();
  });
});

describe("queryAuthStatus / runBillingGuard with fake CLI", () => {
  it("parses the fake auth output", async () => {
    const s = await queryAuthStatus(process.execPath, { ...process.env }, [FAKE]);
    expect(s.loggedIn).toBe(true);
    expect(s.authMethod).toBe("claude.ai");
    expect(s.subscriptionType).toBe("team");
  });
  it("runBillingGuard strips keys and accepts claude.ai", async () => {
    const r = await runBillingGuard(process.execPath, "subscription", { ...process.env, ANTHROPIC_API_KEY: "sk-leak" }, [FAKE]);
    expect(r.env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(r.status.authMethod).toBe("claude.ai");
  });
  it("runBillingGuard rejects api_key auth in subscription mode", async () => {
    const r = await runBillingGuard(process.execPath, "subscription", { ...process.env, FAKE_CLAUDE_AUTH: "api_key" }, [FAKE]).catch((e) => e);
    expect(r).toBeInstanceOf(BillingGuardError);
    expect((r as BillingGuardError).kind).toBe("api_billing");
  });
  it("runBillingGuard rejects when not logged in", async () => {
    const r = await runBillingGuard(process.execPath, "subscription", { ...process.env, FAKE_CLAUDE_AUTH: "none" }, [FAKE]).catch((e) => e);
    expect((r as BillingGuardError).kind).toBe("not_logged_in");
  });
});
