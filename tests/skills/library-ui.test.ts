import { describe, expect, it } from "vitest";
import { MAX_RUN_AGENTS, catalogState, formatBytes, itemEffect, planRunAgents, roleChoices, utf8Bytes } from "../../ui/src/skills/library.js";
import type { LibraryItem, LibraryRole } from "../../ui/src/types.js";

const KIND = ["analyst", "planner", "critic", "implementer", "qa", "debug"];
const BUILTIN = [...KIND, "searcher", "analyzer", "synthesizer"];
const role = (id: string): LibraryRole => ({ id, description: `d-${id}`, prompt: `p-${id}`, tools: ["Read"] });
const item = (id: string, roleIds: string[]): LibraryItem => ({ id, name: id, type: "skill", content: "x", roleIds, createdAt: 1 });

describe("itemEffect", () => {
  it("splits an item's roles into applied, pulled and skipped", () => {
    const e = itemEffect(item("i", ["qa", "searcher", "wording"]), KIND, BUILTIN);
    expect(e).toEqual({ applied: ["qa"], skipped: ["searcher"], pulled: ["wording"], coordinatorOnly: false });
  });
  it("an item with no roles goes to the coordinator only", () => {
    expect(itemEffect(item("i", []), KIND, BUILTIN).coordinatorOnly).toBe(true);
  });
});

describe("planRunAgents", () => {
  const base = { libraryRoles: [role("a"), role("b"), role("c")], tickedRoleIds: [] as string[], rows: [], tickedItems: [] as LibraryItem[], kindRoles: KIND, builtinRoles: BUILTIN };

  it("sends ticked library roles as agents with their tools and model", () => {
    const withModel: LibraryRole = { ...role("m"), model: "haiku" };
    const p = planRunAgents({ ...base, libraryRoles: [withModel], tickedRoleIds: ["m"] });
    expect(p.error).toBeNull();
    expect(p.agents["m"]).toEqual({ description: "d-m", prompt: "p-m", tools: ["Read"], model: "haiku" });
  });
  it("ignores empty rows and keeps filled ones after library roles", () => {
    const p = planRunAgents({ ...base, tickedRoleIds: ["a"], rows: [{ name: "", description: "", prompt: "", tools: [] }, { name: "mine", description: "d", prompt: "p", tools: ["Read"] }] });
    expect(Object.keys(p.agents)).toEqual(["a", "mine"]);
  });
  it("flags a row that reuses a ticked role name or a built-in role name", () => {
    const row = { name: "a", description: "d", prompt: "p", tools: [] };
    expect(planRunAgents({ ...base, tickedRoleIds: ["a"], rows: [row] }).error).toBe("clash");
    expect(planRunAgents({ ...base, rows: [{ ...row, name: "qa" }] })).toMatchObject({ error: "clash", clash: "qa" });
  });
  it("counts roles pulled in by ticked items, without sending them, and de-duplicates", () => {
    const p = planRunAgents({ ...base, tickedRoleIds: ["a"], tickedItems: [item("i1", ["a", "b"]), item("i2", ["b"])] });
    expect(p.names.sort()).toEqual(["a", "b"]);
    expect(Object.keys(p.agents)).toEqual(["a"]);
  });
  it("reports the limit at the server's cap", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(role);
    expect(planRunAgents({ ...base, libraryRoles: many, tickedRoleIds: ["a", "b", "c", "d", "e"] }).error).toBeNull();
    expect(planRunAgents({ ...base, libraryRoles: many, tickedRoleIds: ["a", "b", "c", "d", "e", "f"] }).error).toBe("limit");
    expect(MAX_RUN_AGENTS).toBe(5);
  });
});

describe("small helpers", () => {
  it("roleChoices lists built-in first, then library roles", () => {
    expect(roleChoices(["qa"], [role("w")])).toEqual([{ id: "qa", builtin: true }, { id: "w", builtin: false }]);
  });
  it("roleChoices dedupes ids, builtin wins, order kept", () => {
    expect(roleChoices(["qa", "qa", "dev"], [role("dev"), role("w"), role("w")])).toEqual([
      { id: "qa", builtin: true },
      { id: "dev", builtin: true },
      { id: "w", builtin: false },
    ]);
  });
  it("catalogState", () => {
    expect(catalogState({ id: "x" }, ["x"])).toBe("in_library");
    expect(catalogState({ id: "y" }, ["x"])).toBe("addable");
  });
  it("formatBytes and utf8Bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(utf8Bytes("đ")).toBe(2);
  });
});
