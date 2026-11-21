import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importAgentMd } from "../../src/core/roles/agent-md-import.js";
import { LibraryError, RoleLibrary } from "../../src/core/roles/role-library.js";

let dir: string;
let lib: RoleLibrary;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-import-"));
  lib = new RoleLibrary(path.join(dir, "library"), () => ["analyst", "qa"]);
  file = path.join(dir, "library", "library.json");
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

const md = (meta: Record<string, string>, body: string) =>
  `---\n${Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n${body}\n`;

const reviewer = md({ name: "reviewer", description: "Soát mã", tools: "Read, Grep, Bash" }, "Bạn soát mã nguồn.");

describe("importAgentMd", () => {
  it("dryRun returns only a preview and writes nothing", () => {
    const r = importAgentMd(lib, { text: reviewer, dryRun: true });
    expect(r.created).toBeUndefined();
    expect(r.preview.kind).toBe("role");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("creates a role and drops Bash from tools", () => {
    const r = importAgentMd(lib, { text: reviewer });
    expect(r.created?.kind).toBe("role");
    const saved = lib.list().roles.find((x) => x.id === "reviewer");
    expect(saved).toBeDefined();
    expect(saved!.tools).not.toContain("Bash");
    expect(saved!.tools).toContain("Read");
  });

  it("keeps a valid model", () => {
    importAgentMd(lib, { text: md({ name: "fast", description: "d", model: "sonnet" }, "Nội dung.") });
    expect(lib.list().roles.find((x) => x.id === "fast")?.model).toBe("sonnet");
  });

  it("imports SKILL.md as a skill item", () => {
    const r = importAgentMd(lib, { text: md({ name: "My Skill", description: "d" }, "Cách làm."), filename: "SKILL.md" });
    expect(r.created?.kind).toBe("skill");
    const items = lib.list().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("skill");
    expect(items[0]!.roleIds).toEqual([]);
    expect(lib.list().roles).toHaveLength(0);
  });

  it("as:prompt creates a prompt item", () => {
    importAgentMd(lib, { text: reviewer, as: "prompt" });
    const items = lib.list().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("prompt");
  });

  it("rejects when the library already has 30 roles (400) and leaves the file unchanged", () => {
    for (let i = 1; i <= 30; i++) lib.createRole({ id: `r${i}`, description: "d", prompt: "p", tools: ["Read"] });
    const before = fs.readFileSync(file, "utf8");
    fails(() => importAgentMd(lib, { text: reviewer }), /đầy/, 400);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("rejects a conflicting id with 409 and leaves the file unchanged", () => {
    lib.createRole({ id: "reviewer", description: "d", prompt: "p", tools: ["Read"] });
    const before = fs.readFileSync(file, "utf8");
    fails(() => importAgentMd(lib, { text: reviewer }), /trùng/, 409);
    fails(() => importAgentMd(lib, { text: md({ name: "qa", description: "d" }, "x") }), /trùng/, 409);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("rejects empty and oversized text with 400", () => {
    fails(() => importAgentMd(lib, { text: "" }), /trống/, 400);
    fails(() => importAgentMd(lib, { text: "   \n " }), /trống/, 400);
    fails(() => importAgentMd(lib, { text: "ế".repeat(50000) }), /quá lớn/, 400);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects a non-permissive license with 400", () => {
    const text = md({ name: "gpl-agent", description: "d", license: "GPL-3.0" }, "Nội dung.");
    fails(() => importAgentMd(lib, { text }), /giấy phép/, 400);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects an empty body as blocked empty (400)", () => {
    fails(() => importAgentMd(lib, { text: md({ name: "hollow", description: "d" }, "") }), /prompt|mã hợp lệ/, 400);
  });
});
