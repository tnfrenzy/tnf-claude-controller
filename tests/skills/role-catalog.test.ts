import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryError, RoleLibrary, normalizeName } from "../../src/core/roles/role-library.js";
import { addFromCatalog, catalogFile, readCatalog, searchCatalog, type CatalogRole } from "../../src/core/roles/role-catalog.js";
import { validateExtraAgents } from "../../src/core/run/extras.js";

const SHIPPED = readCatalog(catalogFile(path.resolve(__dirname, "..", "..")));
let dir: string;
let lib: RoleLibrary;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cat-"));
  lib = new RoleLibrary(path.join(dir, "library"), () => ["analyst", "qa"]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("shipped config/roles-catalog.json", () => {
  it("has unique ids and every role passes the same validation as a library role", () => {
    expect(SHIPPED.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SHIPPED.map((r) => r.id)).size).toBe(SHIPPED.length);
    for (const r of SHIPPED) {
      expect(normalizeName(r.id)).toBe(r.id);
      expect(r.name.trim().length).toBeGreaterThan(0);
      expect(r.tags.length).toBeGreaterThan(0);
      expect(r.tools ?? []).not.toContain("Bash");
      expect(() => validateExtraAgents({ [r.id]: { description: r.description, prompt: r.prompt, tools: r.tools } }, [])).not.toThrow();
    }
  });
  it("every role can be added to an empty library and none is a built-in coding/research role", () => {
    const builtin = ["analyst", "planner", "critic", "implementer", "qa", "debug", "searcher", "analyzer", "synthesizer"];
    for (const r of SHIPPED) {
      expect(builtin).not.toContain(r.id);
    }
    // MAX_LIBRARY_ROLES is 30: the catalog must fit in the library at once.
    const big = new RoleLibrary(path.join(dir, "big"), () => builtin);
    for (const r of SHIPPED) expect(addFromCatalog(SHIPPED, r.id, big).id).toBe(r.id);
    expect(big.list().roles).toHaveLength(SHIPPED.length);
  });
  it("ships a read-only code-searcher role that search finds", () => {
    const r = SHIPPED.find((x) => x.id === "code-searcher");
    expect(r).toBeDefined();
    expect(r!.tools).toEqual(["Read", "Grep", "Glob"]);
    for (const t of ["Bash", "Edit", "Write"]) expect(r!.tools).not.toContain(t);
    expect(searchCatalog(SHIPPED, "tìm kiếm mã nguồn").map((x) => x.id)).toContain("code-searcher");
  });
});

describe("readCatalog", () => {
  it("returns [] for a missing or invalid file", () => {
    expect(readCatalog(path.join(dir, "nope.json"))).toEqual([]);
    fs.writeFileSync(path.join(dir, "bad.json"), "{not json", "utf8");
    expect(readCatalog(path.join(dir, "bad.json"))).toEqual([]);
    fs.writeFileSync(path.join(dir, "obj.json"), "{}", "utf8");
    expect(readCatalog(path.join(dir, "obj.json"))).toEqual([]);
  });
});

describe("searchCatalog", () => {
  const cat: CatalogRole[] = [
    { id: "qa-tester", name: "QA tester", description: "Kiểm thử chấp nhận", tags: ["qa", "kiểm thử"], prompt: "p", tools: ["Read"] },
    { id: "translator-vi", name: "Translator", description: "Dịch Việt-Anh", tags: ["dịch"], prompt: "p", tools: ["Read"] },
  ];
  it("empty query returns everything", () => {
    expect(searchCatalog(cat, "  ")).toHaveLength(2);
  });
  it("ignores case and accents, in either direction", () => {
    expect(searchCatalog(cat, "KIEM THU").map((r) => r.id)).toEqual(["qa-tester"]);
    expect(searchCatalog(cat, "dịch viet").map((r) => r.id)).toEqual(["translator-vi"]);
  });
  it("needs every word to match", () => {
    expect(searchCatalog(cat, "qa dich")).toEqual([]);
    expect(searchCatalog(cat, "zzz")).toEqual([]);
  });
});

describe("addFromCatalog", () => {
  it("copies the role into the library, then 409 on a second add, 404 on an unknown id", () => {
    const role = addFromCatalog(SHIPPED, "code-reviewer", lib);
    expect(role.id).toBe("code-reviewer");
    expect(lib.getRole("code-reviewer")?.prompt).toBe(SHIPPED.find((r) => r.id === "code-reviewer")!.prompt);
    expect(() => addFromCatalog(SHIPPED, "code-reviewer", lib)).toThrowError(LibraryError);
    try {
      addFromCatalog(SHIPPED, "code-reviewer", lib);
    } catch (e) {
      expect((e as LibraryError).status).toBe(409);
    }
    try {
      addFromCatalog(SHIPPED, "ghost", lib);
    } catch (e) {
      expect((e as LibraryError).status).toBe(404);
    }
  });
  it("refuses a catalog id that clashes with a built-in role", () => {
    const clash: CatalogRole[] = [{ id: "qa", name: "QA", description: "d", tags: ["x"], prompt: "p", tools: ["Read"] }];
    expect(() => addFromCatalog(clash, "qa", lib)).toThrow(/trùng/);
  });
});
