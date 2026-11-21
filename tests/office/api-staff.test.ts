import { describe, expect, it } from "vitest";
import { placeEmployees, stateOf, summarizeFloor } from "../../ui/src/office/api-staff.js";
import { NARROW, WIDE } from "../../ui/src/office/layout.js";
import type { Employee } from "../../src/core/app/api-connections.js";

const emp = (id: string, over: Partial<Employee> = {}): Employee => ({ id, name: id, department: null, paused: false, queueKnown: true, counts: { pending: 0, processing: 0, failed: 0, done: 0 }, waitingLock: false, lastFinishedAt: null, avgSeconds: null, failedRate: null, ...over });
const counts = (pending: number, processing: number, failed: number) => ({ pending, processing, failed, done: 0 });

describe("stateOf", () => {
  it("maps counts to a state in priority order", () => {
    expect(stateOf(emp("a", { counts: counts(0, 1, 0) }))).toBe("working");
    expect(stateOf(emp("a", { paused: true, counts: counts(0, 1, 0) }))).toBe("paused");
    expect(stateOf(emp("a", { counts: counts(2, 0, 0), waitingLock: true }))).toBe("lockwait");
    expect(stateOf(emp("a", { counts: counts(2, 0, 0) }))).toBe("idle");
    expect(stateOf(emp("a", { counts: counts(0, 0, 3) }))).toBe("failed");
    expect(stateOf(emp("a", { queueKnown: false, counts: null }))).toBe("unwired");
  });
});

describe("placeEmployees", () => {
  it("seats everyone at a distinct desk, same department in the same room", () => {
    const list = [emp("bao-gia", { department: "sales" }), emp("ban-ve", { department: "sales" }), emp("chung-thu", { department: "acc" }), emp("bom", { department: "eng" })];
    const p = placeEmployees(list, WIDE);
    expect(p.overflow).toHaveLength(0);
    const keys = p.residents.map((r) => `${r.group}#${r.seat}`);
    expect(new Set(keys).size).toBe(4);
    expect(p.residents.filter((r) => r.group === "analyst")).toHaveLength(2);
    expect(p.residents.find((r) => r.id === "emp-chung-thu")!.group).toBe("critic");
    expect(p.residents.find((r) => r.id === "emp-bom")!.group).toBe("qa");
  });
  it("only working employees get an agent, pinned to their own resident", () => {
    const p = placeEmployees([emp("a", { counts: counts(0, 2, 0) }), emp("b")], WIDE);
    expect(p.agents).toHaveLength(1);
    expect(p.agents[0]!.residentId).toBe("emp-a");
  });
  it("overflows when there are more people than desks", () => {
    const many = Array.from({ length: 40 }, (_, i) => emp("e" + i));
    const p = placeEmployees(many, WIDE);
    expect(p.residents.length).toBe(WIDE.desks.length);
    expect(p.overflow.length).toBe(40 - WIDE.desks.length);
    expect(placeEmployees(many, NARROW).residents.length).toBe(NARROW.desks.length);
  });
});

describe("summarizeFloor", () => {
  it("is down when the API is unreachable", () => {
    expect(summarizeFloor({ ok: false, error: "x" }).badge).toBe("down");
    expect(summarizeFloor(null).badge).toBe("down");
  });
  it("flags attention for failures and working otherwise", () => {
    const ok = (employees: Employee[]) => ({ ok: true as const, fetchedAt: 0, generatedAt: null, employees });
    expect(summarizeFloor(ok([emp("a", { counts: counts(0, 0, 1) })])).badge).toBe("attention");
    expect(summarizeFloor(ok([emp("a", { counts: counts(0, 1, 0) })])).badge).toBe("working");
    expect(summarizeFloor(ok([emp("a")])).badge).toBe("ok");
  });
});
