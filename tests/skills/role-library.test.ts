import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryError, MAX_ITEM_BYTES, MAX_LIBRARY_ITEMS, MAX_LIBRARY_ROLES, RoleLibrary, normalizeName } from "../../src/core/roles/role-library.js";

let dir: string;
let lib: RoleLibrary;
const role = { id: "wording", description: "Soát câu chữ", prompt: "Bạn soát câu chữ.", tools: ["Read", "Grep"] };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-lib-"));
  lib = new RoleLibrary(path.join(dir, "library"), () => ["analyst", "qa"]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fails = (fn: () => unknown, re: RegExp, status?: number) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LibraryError);
    expect((e as Error).message).toMatch(re);
    if (status) expect((e as LibraryError).status).toBe(status);
    return;
  }
  throw new Error("expected an error");
};

describe("normalizeName", () => {
  it("strips Vietnamese accents to ASCII", () => {
    expect(normalizeName("Kiểm thử Đơn vị!")).toBe("kiem-thu-don-vi");
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName("a".repeat(80)).length).toBe(40);
  });
});

describe("library roles", () => {
  it("create, update, delete and persist", () => {
    expect(lib.createRole(role).id).toBe("wording");
    expect(new RoleLibrary(path.join(dir, "library"), () => []).list().roles).toHaveLength(1);
    expect(lib.updateRole("wording", { description: "Mới" }).description).toBe("Mới");
    expect(lib.list().roles[0]!.prompt).toBe(role.prompt);
    lib.deleteRole("wording");
    expect(lib.list().roles).toHaveLength(0);
    fails(() => lib.deleteRole("wording"), /Không tìm thấy/, 404);
  });
  it("rejects Bash and unknown tools", () => {
    fails(() => lib.createRole({ ...role, tools: ["Bash"] }), /Bash/);
    fails(() => lib.createRole({ ...role, tools: ["Bash(git *)"] }), /an toàn/);
  });
  it("rejects a name clashing with a built-in role, and duplicates", () => {
    fails(() => lib.createRole({ ...role, id: "analyst" }), /trùng/);
    lib.createRole(role);
    fails(() => lib.createRole(role), /đã có/, 409);
  });
  it("normalizes the id and enforces the count limit", () => {
    expect(lib.createRole({ ...role, id: "Soát Lỗi" }).id).toBe("soat-loi");
    for (let i = 0; i < MAX_LIBRARY_ROLES - 1; i++) lib.createRole({ ...role, id: `r${i}` });
    fails(() => lib.createRole({ ...role, id: "extra" }), /tối đa/);
  });
  it("deleting a role removes it from item ticks", () => {
    lib.createRole(role);
    const it1 = lib.createItem({ name: "n", type: "prompt", content: "x", roleIds: ["wording", "qa"] });
    lib.deleteRole("wording");
    expect(lib.list().items.find((i) => i.id === it1.id)!.roleIds).toEqual(["qa"]);
  });
});

describe("library items", () => {
  it("create/update/delete with ticks, ASCII ids and de-duplicated ids", () => {
    const a = lib.createItem({ name: "Quy tắc viết", type: "skill", content: "# skill", roleIds: ["analyst"] });
    expect(a.id).toBe("quy-tac-viet");
    const b = lib.createItem({ name: "Quy tắc viết", type: "prompt", content: "y" });
    expect(b.id).toBe("quy-tac-viet-2");
    expect(lib.updateItem(a.id, { roleIds: ["analyst", "qa"] }).roleIds).toEqual(["analyst", "qa"]);
    expect(lib.updateItem(a.id, { content: "mới" }).roleIds).toEqual(["analyst", "qa"]);
    lib.deleteItem(a.id);
    expect(lib.list().items.map((i) => i.id)).toEqual(["quy-tac-viet-2"]);
    fails(() => lib.deleteItem("nope"), /Không tìm thấy/, 404);
  });
  it("rejects unknown role ids, bad type, empty and oversized content", () => {
    fails(() => lib.createItem({ name: "n", type: "prompt", content: "x", roleIds: ["ghost"] }), /không tồn tại/);
    fails(() => lib.createItem({ name: "n", type: "other", content: "x" }), /skill/);
    fails(() => lib.createItem({ name: "n", type: "skill", content: "  " }), /trống/);
    fails(() => lib.createItem({ name: "n", type: "skill", content: "a".repeat(MAX_ITEM_BYTES + 1) }), /vượt/);
    expect(lib.createItem({ name: "n", type: "skill", content: "a".repeat(MAX_ITEM_BYTES) }).id).toBe("n");
  });
  it("enforces the item count limit and resolves ids for a run", () => {
    for (let i = 0; i < MAX_LIBRARY_ITEMS; i++) lib.createItem({ name: `m${i}`, type: "prompt", content: "x" });
    fails(() => lib.createItem({ name: "more", type: "prompt", content: "x" }), /tối đa/);
    expect(lib.getItems(["m1", "m1"])).toHaveLength(1);
    fails(() => lib.getItems(["ghost"]), /Không tìm thấy mục thư viện/);
  });
});
