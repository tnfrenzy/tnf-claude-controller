import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImportPreview, MAX_IMPORT_TEXT_BYTES, type ImportPreviewOptions } from "../../src/core/roles/agent-md.js";
import { importAgentMd } from "../../src/core/roles/agent-md-import.js";
import { LibraryError, RoleLibrary } from "../../src/core/roles/role-library.js";

let dir: string;
let lib: RoleLibrary;

function previewOf(text: string, extra: Partial<ImportPreviewOptions> = {}) {
  const cur = lib.list();
  return buildImportPreview(text, {
    builtinRoles: cur.builtinRoles,
    libraryRoleIds: cur.roles.map((r) => r.id),
    libraryItemCount: cur.items.length,
    ...extra,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-import-int-"));
  lib = new RoleLibrary(path.join(dir, "library"), () => ["analyst", "qa"]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const SUBAGENT = "---\nname: doc-checker\ndescription: Checks docs\ntools: Read, Grep\n---\nYou check documentation carefully.\n";

describe("md import integration", () => {
  it("preview and import agree on id/name/tools for a valid subagent", () => {
    const p = previewOf(SUBAGENT);
    const r = importAgentMd(lib, { text: SUBAGENT });
    expect(r.created?.kind).toBe("role");
    if (r.created?.kind !== "role") throw new Error("expected role");
    expect(r.created.role.id).toBe(p.id);
    expect(r.created.role.tools).toEqual(p.tools);
    expect(r.preview.name).toBe(p.name);
  });

  it("drops tools outside the safe list, warns, and never grants Bash", () => {
    const text = "---\nname: risky\ndescription: d\ntools: Bash, Agent, mcp__x, Write, Edit, Read\n---\nDo things.\n";
    const p = previewOf(text);
    expect(p.droppedTools).toEqual(expect.arrayContaining(["Bash", "Agent", "mcp__x"]));
    expect(p.warnings).toContain("tools_dropped");
    expect(p.tools).toEqual(expect.arrayContaining(["Write", "Edit", "Read"]));
    const r = importAgentMd(lib, { text });
    if (r.created?.kind !== "role") throw new Error("expected role");
    expect(r.created.role.tools).not.toContain("Bash");
    expect(r.created.role.tools).not.toContain("Agent");
    expect(r.created.role.tools).toEqual(p.tools);
  });

  it("imports SKILL.md as a skill item and plain prompts as a prompt item", () => {
    const skill = "---\nname: my-skill\ndescription: A skill\n---\nSteps here.\n";
    const rs = importAgentMd(lib, { text: skill, filename: "SKILL.md" });
    expect(rs.created?.kind).toBe("skill");
    const rp = importAgentMd(lib, { text: "# Hello prompt\nSay hi.", as: "prompt", filename: "hello.md" });
    expect(rp.created?.kind).toBe("prompt");
    if (rp.created?.kind === "prompt") expect(rp.created.item.id).toBe(rp.preview.id);
    expect(lib.list().items.length).toBe(2);
  });

  it("rejects text over the size limit with a 400 LibraryError", () => {
    const big = "a".repeat(MAX_IMPORT_TEXT_BYTES + 1);
    try {
      importAgentMd(lib, { text: big });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LibraryError);
      expect((e as LibraryError).status).toBe(400);
    }
  });

  it("import sources never reference run-manager or run-store", () => {
    const base = path.resolve(__dirname, "..", "..", "src", "core", "roles");
    for (const f of ["agent-md.ts", "agent-md-import.ts"]) {
      const src = fs.readFileSync(path.join(base, f), "utf8");
      expect(src).not.toMatch(/run-manager/);
      expect(src).not.toMatch(/run-store/);
    }
  });
});
