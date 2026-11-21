// Writes report.md into the run dir of a finished skill-workshop step so RunPage shows it as an artifact.
import fs from "node:fs/promises";
import path from "node:path";
import type { RunStore } from "../run/run-store.js";

export function makeSaveRunReport(store: Pick<RunStore, "getRun" | "scanArtifacts">): (runId: string, markdown: string) => Promise<void> {
  return async (runId, markdown) => {
    if (!runId) return;
    const run = store.getRun(runId);
    if (!run?.run_dir) return;
    await fs.mkdir(run.run_dir, { recursive: true });
    // Overwrite on purpose: the latest sample report replaces an earlier one.
    await fs.writeFile(path.join(run.run_dir, "report.md"), markdown, "utf8");
    store.scanArtifacts(runId, run.run_dir);
  };
}
