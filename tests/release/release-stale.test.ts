import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_STALE_MS, readReleaseLogChecked, reconcileStaleRelease, releaseLogPath, type ReleaseLog } from "../../src/core/release/pipeline.js";
import { DEFAULT_RUN_TIMEOUT_MS, migrateRunTimeout } from "../../src/core/app/config.js";

const NOW = Date.parse("2026-10-29T03:00:00.000Z");

function log(over: Partial<ReleaseLog> = {}): ReleaseLog {
  return {
    id: "r1", project: "controller", status: "running", version: "0.5.5",
    startedAt: "2026-10-29T02:17:40.000Z", endedAt: "2026-10-29T02:17:40.000Z",
    steps: [
      { index: 0, type: "bump", description: "bump", argv: [], status: "ok", exitCode: 0, output: "", startedAt: null, endedAt: null },
      { index: 1, type: "build", description: "npm run test", argv: [], status: "running", exitCode: null, output: "", startedAt: null, endedAt: null },
      { index: 2, type: "build", description: "npm run package", argv: [], status: "skipped", exitCode: null, output: "", startedAt: null, endedAt: null },
    ],
    warnings: [],
    ...over,
  } as ReleaseLog;
}

describe("reconcileStaleRelease", () => {
  it("a running log silent for longer than the limit becomes failed, with the running step failed and the bump warned", () => {
    const fixed = reconcileStaleRelease(log(), NOW)!;
    expect(fixed.status).toBe("failed");
    expect(fixed.error).toMatch(/Server dừng giữa chừng/);
    expect(fixed.steps.map((s) => s.status)).toEqual(["ok", "failed", "skipped"]);
    expect(fixed.steps[1]!.output).toMatch(/Bị ngắt/);
    expect(fixed.warnings.join(" ")).toContain("chore(release): 0.5.5");
    expect(fixed.heartbeatAt).toBeUndefined();
  });

  it("a recent heartbeat keeps the release alive", () => {
    const beat = new Date(NOW - 30_000).toISOString();
    expect(reconcileStaleRelease(log({ heartbeatAt: beat }), NOW)).toBeNull();
  });

  it("the heartbeat, not the start time, decides: a long release that keeps beating is not stale", () => {
    expect(reconcileStaleRelease(log({ startedAt: "2026-10-29T01:00:00.000Z", heartbeatAt: new Date(NOW - 1000).toISOString() }), NOW)).toBeNull();
  });

  it("finished logs are left alone", () => {
    expect(reconcileStaleRelease(log({ status: "success" }), NOW)).toBeNull();
    expect(reconcileStaleRelease(log({ status: "failed" }), NOW)).toBeNull();
  });

  it("the limit is 5 minutes", () => {
    expect(RELEASE_STALE_MS).toBe(5 * 60 * 1000);
    const edge = new Date(NOW - RELEASE_STALE_MS).toISOString();
    expect(reconcileStaleRelease(log({ heartbeatAt: edge }), NOW)).toBeNull();
    expect(reconcileStaleRelease(log({ heartbeatAt: new Date(NOW - RELEASE_STALE_MS - 1000).toISOString() }), NOW)).not.toBeNull();
  });
});

describe("readReleaseLogChecked", () => {
  it("rewrites an abandoned log on disk so every later read says failed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-stale-"));
    try {
      const f = releaseLogPath(dir, "r1");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(log()));
      const first = readReleaseLogChecked(dir, "r1", NOW)!;
      expect(first.status).toBe("failed");
      expect((JSON.parse(fs.readFileSync(f, "utf8")) as ReleaseLog).status).toBe("failed");
      expect(readReleaseLogChecked(dir, "r1", NOW + 1000)!.status).toBe("failed");
      expect(readReleaseLogChecked(dir, "missing", NOW)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("run timeout default", () => {
  it("is 60 minutes; the old 30 minute default is migrated; other explicit values are kept", () => {
    expect(DEFAULT_RUN_TIMEOUT_MS).toBe(3_600_000);
    expect(migrateRunTimeout(undefined)).toBe(3_600_000);
    expect(migrateRunTimeout(1_800_000)).toBe(3_600_000);
    expect(migrateRunTimeout(2_400_000)).toBe(2_400_000);
    expect(migrateRunTimeout(7_200_000)).toBe(7_200_000);
    expect(migrateRunTimeout(-5)).toBe(3_600_000);
  });
});
