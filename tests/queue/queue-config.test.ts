import { describe, expect, it } from "vitest";
import { parseQueue } from "../../src/core/app/config.js";

describe("parseQueue maxBudgetUsd", () => {
  it("null means unlimited", () => {
    expect(parseQueue({ maxBudgetUsd: null }).maxBudgetUsd).toBeNull();
  });
  it("missing or invalid values fall back to 30", () => {
    expect(parseQueue({}).maxBudgetUsd).toBe(30);
    expect(parseQueue({ maxBudgetUsd: "5" }).maxBudgetUsd).toBe(30);
    expect(parseQueue({ maxBudgetUsd: 0 }).maxBudgetUsd).toBe(30);
    expect(parseQueue({ maxBudgetUsd: Number.NaN }).maxBudgetUsd).toBe(30);
  });
  it("keeps a valid number", () => {
    expect(parseQueue({ maxBudgetUsd: 12 }).maxBudgetUsd).toBe(12);
  });
});
