import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeSaveRunReport } from "../../src/core/skill-workshop/run-report.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-run-report-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function fakeStore() {
  const scanArtifacts = vi.fn();
  const store = {
    getRun: (id: string) => (id === "r1" ? { run_dir: path.join(dir, "r1") } : null),
    scanArtifacts
  };
  return { store: store as any, scanArtifacts };
}

describe("makeSaveRunReport", () => {
  it("writes report.md, overwrites on second call and rescans artifacts", async () => {
    const { store, scanArtifacts } = fakeStore();
    const save = makeSaveRunReport(store);
    await save("r1", "# one");
    const file = path.join(dir, "r1", "report.md");
    expect(await fs.readFile(file, "utf8")).toBe("# one");
    await save("r1", "# two");
    expect(await fs.readFile(file, "utf8")).toBe("# two");
    expect(scanArtifacts).toHaveBeenCalledWith("r1", path.join(dir, "r1"));
    expect(scanArtifacts).toHaveBeenCalledTimes(2);
  });

  it("does nothing and does not throw for empty or unknown runId", async () => {
    const { store, scanArtifacts } = fakeStore();
    const save = makeSaveRunReport(store);
    await expect(save("", "x")).resolves.toBeUndefined();
    await expect(save("nope", "x")).resolves.toBeUndefined();
    expect(scanArtifacts).not.toHaveBeenCalled();
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
