import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => {
  const actual = await orig<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { buildChildEnv, ClaudeRunner, type RunnerOptions } from "../../src/core/run/claude-runner.js";

const lim = { maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1 };

describe("buildChildEnv", () => {
  it("sets both BASH timeouts to minutes * 60000", () => {
    const env = buildChildEnv({}, { ...lim, callTimeoutMinutes: 20 });
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBe("1200000");
    expect(env.BASH_MAX_TIMEOUT_MS).toBe("1200000");
  });
  it("omits BASH vars when not given", () => {
    const env = buildChildEnv({}, lim);
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBeUndefined();
    expect(env.BASH_MAX_TIMEOUT_MS).toBeUndefined();
    expect(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("3");
  });
  it("removes API keys and does not mutate the base env", () => {
    const base = { ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", X: "1" };
    const env = buildChildEnv(base, { ...lim, callTimeoutMinutes: 5 });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.X).toBe("1");
    expect(base).toEqual({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", X: "1" });
  });
});

describe("ClaudeRunner passes env to spawn", () => {
  beforeEach(() => spawnMock.mockReset());
  function fakeChild() {
    const c = new EventEmitter() as EventEmitter & Record<string, unknown>;
    c.stdout = new PassThrough();
    c.stderr = new PassThrough();
    c.stdin = new PassThrough();
    c.pid = 1;
    return c;
  }
  it("spawn receives BASH timeout env when callTimeoutMinutes is set", () => {
    spawnMock.mockReturnValue(fakeChild());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-env-"));
    const o: RunnerOptions = {
      runId: "r1", claudePath: "claude.exe", cwd: dir, env: { ANTHROPIC_API_KEY: "k" }, authMode: "subscription",
      prompt: "x", model: "sonnet", maxTurns: 1, maxBudgetUsd: 1, timeoutMs: 60000, allowedTools: [],
      streamFile: path.join(dir, "s.jsonl"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, callTimeoutMinutes: 20,
    };
    const r = new ClaudeRunner(o);
    r.start();
    const opts = spawnMock.mock.calls[0]![2] as { env: NodeJS.ProcessEnv; shell: boolean };
    expect(opts.shell).toBe(false);
    expect(opts.env.BASH_DEFAULT_TIMEOUT_MS).toBe("1200000");
    expect(opts.env.BASH_MAX_TIMEOUT_MS).toBe("1200000");
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    r.cancel();
  });
});
