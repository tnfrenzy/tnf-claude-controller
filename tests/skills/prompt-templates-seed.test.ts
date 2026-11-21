import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_LIBRARY_ITEMS, RoleLibrary } from "../../src/core/roles/role-library.js";
import { PROMPT_TEMPLATES } from "../../src/core/roles/prompt-templates.js";
import { extractSlots } from "../../ui/src/skills/library.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-seed-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const mk = () => new RoleLibrary(dir, () => []);

describe("seedTemplates", () => {
  it("seeds all templates as prompts with slots", () => {
    const lib = mk();
    lib.seedTemplates(PROMPT_TEMPLATES);
    const items = lib.list().items;
    expect(items.length).toBe(PROMPT_TEMPLATES.length);
    for (const t of PROMPT_TEMPLATES) {
      expect(t.id).toMatch(/^tpl-[a-z0-9-]{1,36}$/);
      const it2 = items.find((i) => i.id === t.id)!;
      expect(it2.type).toBe("prompt");
      expect(extractSlots(it2.content).length).toBeGreaterThan(0);
    }
  });

  it("does not duplicate on second run", () => {
    const lib = mk();
    lib.seedTemplates(PROMPT_TEMPLATES);
    lib.seedTemplates(PROMPT_TEMPLATES);
    expect(lib.list().items.length).toBe(PROMPT_TEMPLATES.length);
  });

  it("keeps user edits", () => {
    const lib = mk();
    lib.seedTemplates(PROMPT_TEMPLATES);
    lib.updateItem("tpl-fix-bug", { name: "Sửa lỗi", type: "prompt", content: "nội dung riêng", roleIds: [] });
    lib.seedTemplates(PROMPT_TEMPLATES);
    expect(lib.list().items.find((i) => i.id === "tpl-fix-bug")!.content).toBe("nội dung riêng");
  });

  it("does not recreate deleted templates", () => {
    const lib = mk();
    lib.seedTemplates(PROMPT_TEMPLATES);
    lib.deleteItem("tpl-add-test");
    lib.seedTemplates(PROMPT_TEMPLATES);
    expect(lib.list().items.some((i) => i.id === "tpl-add-test")).toBe(false);
  });

  it("does not throw when library is full", () => {
    const lib = mk();
    for (let i = 0; i < MAX_LIBRARY_ITEMS; i++) lib.createItem({ name: `m${i}`, type: "prompt", content: "x", roleIds: [] });
    expect(() => lib.seedTemplates(PROMPT_TEMPLATES)).not.toThrow();
    expect(lib.list().items.length).toBe(MAX_LIBRARY_ITEMS);
  });
});
