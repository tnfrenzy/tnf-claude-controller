import { describe, expect, it } from "vitest";
import {
  budgetState,
  estimateCommandCost,
  estimateGroupCost,
  queueSpent,
  type BudgetCommand,
} from "../../src/core/queue/queue-budget.js";
import { DEFAULT_QUEUE_MAX_BUDGET_USD } from "../../src/core/app/config.js";

const D = { maxBudgetUsd: 3 };

function cmd(status: BudgetCommand["status"], estCostUsd: number): BudgetCommand {
  return { id: "c-" + status, project: "p", size: 2, status, estCostUsd };
}

describe("estimateCommandCost", () => {
  it("uses history average times size factor", () => {
    expect(estimateCommandCost({ size: 2 }, [1, 2, 3], D)).toMatchObject({ estimateUsd: 2, basis: "history", upperBoundUsd: 3 });
    expect(estimateCommandCost({ size: 1 }, [1, 2, 3], D).estimateUsd).toBe(1);
  });

  it("falls back to default budget without history", () => {
    expect(estimateCommandCost({ size: 2 }, [], D)).toMatchObject({ estimateUsd: 3, basis: "default" });
    expect(estimateCommandCost({ size: 1 }, undefined, D).estimateUsd).toBe(1.5);
  });

  it("ignores NaN, negative and zero history", () => {
    const r = estimateCommandCost({ size: 2 }, [NaN, -4, 0, 2], D);
    expect(r.estimateUsd).toBe(2);
    expect(r.basis).toBe("history");
    expect(estimateCommandCost({ size: 2 }, [NaN, 0], D).basis).toBe("default");
  });

  it("clamps to the per-run upper bound and says it is an estimate", () => {
    const r = estimateCommandCost({ size: 2 }, [10], D);
    expect(r.estimateUsd).toBe(3);
    expect(r.note).toContain("không phải hóa đơn");
  });

  it("uses 3 when defaults.maxBudgetUsd is invalid", () => {
    expect(estimateCommandCost({ size: 2 }, [], { maxBudgetUsd: NaN }).upperBoundUsd).toBe(3);
  });
});

describe("estimateGroupCost", () => {
  it("sums a group of 3 commands", () => {
    const items = [
      estimateCommandCost({ size: 2 }, [1, 2, 3], D),
      estimateCommandCost({ size: 1 }, [1, 2, 3], D),
      estimateCommandCost({ size: 2 }, [], D),
    ];
    const g = estimateGroupCost(items);
    expect(g.count).toBe(3);
    expect(g.totalEstimateUsd).toBe(6);
    expect(g.totalUpperBoundUsd).toBe(9);
    expect(g.note).toContain("không phải hóa đơn");
  });

  it("empty group is zero", () => {
    expect(estimateGroupCost([])).toMatchObject({ totalEstimateUsd: 0, totalUpperBoundUsd: 0, count: 0 });
  });
});

describe("queueSpent", () => {
  it("counts committed, merged, running and failed with cost", () => {
    const cmds = [cmd("đã commit", 1), cmd("đã gộp", 2), cmd("đang chạy", 0.5), cmd("lỗi", 0.25)];
    expect(queueSpent(cmds)).toBe(3.75);
  });

  it("ignores pending, approved and skipped", () => {
    expect(queueSpent([cmd("chờ duyệt", 5), cmd("đã duyệt", 5), cmd("bỏ qua", 5), cmd("lỗi", 0)])).toBe(0);
  });

  it("adds replan costs and skips invalid numbers", () => {
    expect(queueSpent([cmd("đã gộp", 1), cmd("đã commit", NaN), cmd("đã commit", -2)], [0.5, NaN, -1, 0.25])).toBe(1.75);
  });
});

describe("budgetState", () => {
  it("below ceiling can open new", () => {
    const s = budgetState(4, 10);
    expect(s).toMatchObject({ canOpenNew: true, reached: false, remainingUsd: 6 });
    expect(s.message).toContain("ước tính");
  });

  it("exactly at ceiling is reached", () => {
    const s = budgetState(10, 10);
    expect(s).toMatchObject({ canOpenNew: false, reached: true, remainingUsd: 0 });
  });

  it("over ceiling: no new, remaining 0, message mentions running and estimate", () => {
    const s = budgetState(12.5, 10);
    expect(s).toMatchObject({ canOpenNew: false, reached: true, remainingUsd: 0 });
    expect(s.message).toContain("đang chạy");
    expect(s.message).toContain("ước tính");
    expect(s.message).toContain("$12,50");
  });

  it("lệnh đang chạy: queueSpent counts it and budgetState only blocks new commands (no throw)", () => {
    const spent = queueSpent([cmd("đã gộp", 9), cmd("đang chạy", 3)]);
    expect(spent).toBe(12);
    const s = budgetState(spent, 10);
    expect(s.canOpenNew).toBe(false);
    expect(s.spentUsd).toBe(12);
  });

  it("rounds to cents so 9.999 vs 10 counts as reached", () => {
    expect(budgetState(9.999, 10).reached).toBe(true);
  });

  it("invalid max falls back to the default", () => {
    for (const bad of [undefined, NaN, 0, -5, Infinity]) {
      expect(budgetState(1, bad as number | undefined).maxBudgetUsd).toBe(DEFAULT_QUEUE_MAX_BUDGET_USD);
    }
    expect(DEFAULT_QUEUE_MAX_BUDGET_USD).toBe(30);
  });

  it("null max means unlimited", () => {
    const s = budgetState(1000, null);
    expect(s).toMatchObject({ canOpenNew: true, reached: false, maxBudgetUsd: null, remainingUsd: null, spentUsd: 1000 });
    expect(s.message).toContain("Không giới hạn");
    expect(s.message).not.toContain("null");
    expect(s.message).not.toContain("NaN");
    expect(budgetState(1, undefined).maxBudgetUsd).toBe(30);
  });

  it("invalid spent counts as 0", () => {
    expect(budgetState(NaN, 10)).toMatchObject({ spentUsd: 0, canOpenNew: true });
    expect(budgetState(-3, 10).spentUsd).toBe(0);
    expect(budgetState(undefined, 10).spentUsd).toBe(0);
  });
});
