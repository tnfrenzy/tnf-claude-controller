/**
 * `tnf skill train <slug> [--yes] [--max-rounds N] [--pass-score N] [--cost-cap X]`
 * Real runs spend subscription quota, so they need --yes and pass the billing guard first.
 * With TNF_FAKE_CLAUDE=1 (fake CLI) neither is needed. Approval is never automatic.
 */
import { parseArgs } from "node:util";
import type { RunManager } from "./core/run/run-manager.js";
import { createSkillStore } from "./core/skill-workshop/store.js";
import { createSkillTrainer } from "./core/skill-workshop/runner.js";
import { makeSaveRunReport } from "./core/skill-workshop/run-report.js";
import { createManagerRunStep, type StepManager } from "./core/skill-workshop/run-step.js";

export interface SkillCliDeps {
  manager: RunManager;
  fake: boolean;
  log?: (line: string) => void;
  err?: (line: string) => void;
}

export async function runSkillCli(args: string[], deps: SkillCliDeps): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const [sub, ...rest] = args;
  if (sub !== "train") {
    err("Cách dùng: tnf skill train <slug> [--yes] [--max-rounds N] [--pass-score N] [--cost-cap X]");
    return 1;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      yes: { type: "boolean" },
      "max-rounds": { type: "string" },
      "pass-score": { type: "string" },
      "cost-cap": { type: "string" }
    },
    allowPositionals: true
  });
  const slug = positionals[0];
  if (!slug) {
    err("Thiếu <slug> của skill.");
    return 1;
  }
  if (!deps.fake) {
    if (!values["yes"]) {
      err("Huấn luyện skill thật tốn hạn mức thuê bao. Thêm --yes để xác nhận (hoặc TNF_FAKE_CLAUDE=1 để chạy thử).");
      return 2;
    }
    try {
      await deps.manager.authStatus();
    } catch (e) {
      err(`Billing guard chặn: ${(e as Error).message}`);
      return 2;
    }
  }
  const cfg: Record<string, number> = {};
  if (values["max-rounds"]) cfg["maxRounds"] = Number(values["max-rounds"]);
  if (values["pass-score"]) cfg["passScore"] = Number(values["pass-score"]);
  if (values["cost-cap"]) cfg["costCapUsd"] = Number(values["cost-cap"]);

  const store = createSkillStore(deps.manager.config.dataDir);
  const adapter = createManagerRunStep(deps.manager as unknown as StepManager);
  const trainer = createSkillTrainer({
    store,
    runStep: adapter.runStep,
    cancelActive: adapter.cancelActive,
    saveRunReport: makeSaveRunReport(deps.manager.store),
    now: () => new Date().toISOString()
  });
  try {
    await trainer.train(slug, cfg);
    await trainer.whenIdle(slug);
    const r = await trainer.getRounds(slug);
    for (const x of r.rounds as { n: number; score: number }[]) log(`Vòng ${x.n}: ${x.score} điểm`);
    log(`Trạng thái: ${r.state} · điểm tốt nhất: ${r.bestScore ?? "?"} (vòng ${r.bestRound ?? "?"})`);
    if (r.state === "awaiting_approval") log("Đạt ngưỡng. Chờ bạn duyệt cuối trong giao diện (không tự duyệt).");
    if (r.state === "awaiting_score") log("Đã ghi đầu ra của vòng. Chờ bạn chấm điểm trong giao diện (không tự chấm).");
    return r.state === "awaiting_approval" || r.state === "awaiting_score" ? 0 : 3;
  } catch (e) {
    err(`Không huấn luyện được: ${(e as Error).message}`);
    return 2;
  }
}
