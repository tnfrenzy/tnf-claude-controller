import { describe, it, expect } from "vitest";
import { initialChips, reduceChips } from "../../ui/src/office/role-chips.js";
import type { NormalizedEvent } from "../../ui/src/types.js";

const started = (agent_id: string, role: string): NormalizedEvent => ({ type: "agent.started", agent_id, role, parent_id: null, tool_use_id: null });
const finished = (agent_id: string, status?: string): NormalizedEvent => ({ type: "agent.finished", agent_id, summary: "s", ...(status ? { status } : {}) });

describe("role chips", () => {
  it("all roles idle without a run", () => {
    const s = initialChips(["analyst", "qa"]);
    expect(s.chips).toEqual([{ role: "analyst", state: "idle" }, { role: "qa", state: "idle" }]);
  });
  it("agent.started then agent.finished changes the chip", () => {
    let s = initialChips(["analyst", "qa"]);
    s = reduceChips(s, started("a1", "analyst"));
    expect(s.chips[0]?.state).toBe("working");
    s = reduceChips(s, finished("a1", "completed"));
    expect(s.chips[0]?.state).toBe("done");
    expect(s.chips[1]?.state).toBe("idle");
  });
  it("failed finish gives error and unknown role is appended", () => {
    let s = initialChips(["qa"]);
    s = reduceChips(s, started("x", "critic"));
    s = reduceChips(s, finished("x", "failed"));
    expect(s.chips).toEqual([{ role: "qa", state: "idle" }, { role: "critic", state: "error" }]);
  });
  it("ignores unrelated events and unknown agent ids", () => {
    const s = initialChips(["qa"]);
    expect(reduceChips(s, { type: "text.delta", agent_id: "a", text: "x" } as NormalizedEvent)).toBe(s);
    expect(reduceChips(s, finished("nope"))).toBe(s);
  });
});
