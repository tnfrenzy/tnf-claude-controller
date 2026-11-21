import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseQueue } from "../../src/core/app/config.js";
import { budgetState, queueSpent, type BudgetCommand } from "../../src/core/queue/queue-budget.js";

function cmd(status: BudgetCommand["status"], estCostUsd: number): BudgetCommand {
  return { id: "c-" + status, project: "p", size: 2, status, estCostUsd };
}

describe("unlimited queue budget", () => {
  it("null config keeps the queue open however much was spent", () => {
    const cfg = parseQueue({ maxBudgetUsd: null });
    expect(cfg.maxBudgetUsd).toBeNull();
    const spent = queueSpent([cmd("đã gộp", 5000), cmd("đang chạy", 5000)]);
    const state = budgetState(spent, cfg.maxBudgetUsd);
    expect(state.canOpenNew).toBe(true);
    expect(state.reached).toBe(false);
    expect(state.remainingUsd).toBeNull();
    expect(state.message).toContain("Không giới hạn");
  });

  it("missing key still falls back to the 30 USD ceiling", () => {
    const cfg = parseQueue({});
    expect(cfg.maxBudgetUsd).toBe(30);
    expect(budgetState(100, cfg.maxBudgetUsd).canOpenNew).toBe(false);
  });

  it("shipped config/controller.json has no queue ceiling", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "controller.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parseQueue(raw.queue).maxBudgetUsd).toBeNull();
  });
});
