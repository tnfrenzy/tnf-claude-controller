/**
 * Manual probe (spends subscription quota, never run by `npm test`): does a subagent's Bash call get cut at ~600 s?
 * Invoked from scripts/smoke.ts:  npm run smoke -- --yes --probe-timeout --project <name>
 *
 * It is a CODING run, so the project must have a repo (`tnf projects add <name> --repo <path>`); `Bash(node *)` is already
 * in the coding allowlist of config/controller.json. Two arms, each a small run asking one subagent to run
 * `node -e "setTimeout(()=>{},700000)"` (about 11.7 minutes, longer than the suspected ~600 s cut):
 *   A. "default": callTimeoutMinutes removed from the config copy, so BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS are NOT set;
 *   B. "env": the configured defaults.coding.callTimeoutMinutes (BASH_* set, see src/core/run/claude-runner.ts).
 * That BASH_* env vars lift the cut is an UNVERIFIED hypothesis; this probe is how it gets verified.
 */
import type { ControllerConfig } from "../src/core/app/config.js";
import { RunManager } from "../src/core/run/run-manager.js";
import { RunStore } from "../src/core/run/run-store.js";
import path from "node:path";

export const PROBE_SLEEP_MS = 700000;
export const PROBE_COMMAND = `node -e "setTimeout(()=>{},${PROBE_SLEEP_MS})"`;

export function buildProbePrompt(): string {
  return [
    "Đây là phép thử giới hạn thời gian, KHÔNG sửa file nào.",
    "Gọi đúng MỘT lần vai implementer (đồng bộ) và bảo nó chạy duy nhất lệnh Bash sau, chờ nó kết thúc:",
    PROBE_COMMAND,
    "(lệnh chạy khoảng 11,7 phút). Implementer báo lại một dòng: PROBE: COMPLETED nếu lệnh tự kết thúc, hoặc PROBE: CUT kèm thông báo lỗi nếu bị cắt giữa chừng.",
    "Không làm việc gì khác, không commit, rồi trả lời ngắn gọn kết quả.",
  ].join("\n");
}

export interface ProbeOutcome {
  status: string;
  error?: string | null;
}

/** A probe arm counts as cut when the run did not finish cleanly or reported an interrupted subagent. */
export function probeWasCut(o: ProbeOutcome): boolean {
  return o.status !== "done" || /interrupt|timeout|timed out|cut/i.test(o.error ?? "");
}

/** Conclusion from the default arm (a) and the env arm (b); each is true when that arm was cut. */
export function summarizeProbe(aCut: boolean, bCut: boolean): string {
  if (aCut && !bCut) return "KẾT LUẬN: mặc định bị cắt, có BASH_* thì không bị cắt: giả thuyết BASH_* được ủng hộ.";
  if (aCut && bCut) return "KẾT LUẬN: cả hai đều bị cắt: BASH_* không nâng được giới hạn, nguồn chặn nằm chỗ khác.";
  if (!aCut && bCut) return "KẾT LUẬN: bất thường: mặc định không bị cắt nhưng có BASH_* lại bị cắt, cần xem lại stream.";
  return "KẾT LUẬN: cả hai đều không bị cắt: lệnh 700000 ms không bị chặn ở mức này (có thể giới hạn ~600 s không phải do Bash).";
}

export async function runProbe(config: ControllerConfig, projectName: string): Promise<number> {
  const store = new RunStore(path.join(config.dataDir, "controller.db"));
  const results: boolean[] = [];
  for (const arm of ["default", "env"] as const) {
    let coding = config.defaults.coding;
    if (arm === "default") {
      const { callTimeoutMinutes: _omit, ...rest } = coding;
      coding = rest;
    }
    const mgr = new RunManager({ config: { ...config, defaults: { ...config.defaults, coding } }, store });
    console.log(`\n--- arm ${arm}: callTimeoutMinutes=${coding.callTimeoutMinutes ?? "(không đặt, không có BASH_*)"} ---`);
    const run = await mgr.startRun({ prompt: buildProbePrompt(), roles: true, kind: "coding", project: projectName, model: config.defaults.model, maxTurns: 20, maxBudgetUsd: 1 });
    const final = (await mgr.waitFor(run.id))!;
    const cut = probeWasCut(final);
    console.log(`run ${run.id}: status=${final.status} error=${final.error ?? "(none)"} cut=${cut}`);
    results.push(cut);
  }
  console.log(`\n${summarizeProbe(results[0]!, results[1]!)}`);
  store.close();
  return 0;
}
