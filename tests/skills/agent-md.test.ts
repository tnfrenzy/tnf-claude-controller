import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImportPreview, MAX_IMPORT_TEXT_BYTES, parseFrontmatter } from "../../src/core/roles/agent-md.js";
import { importAgentMd } from "../../src/core/roles/agent-md-import.js";
import { LibraryError, MAX_LIBRARY_ROLES, RoleLibrary } from "../../src/core/roles/role-library.js";
import { DEFAULT_EXTRA_TOOLS, MAX_DESCRIPTION, MAX_PROMPT, SAFE_AGENT_TOOLS } from "../../src/core/run/extras.js";

let dir: string;
let lib: RoleLibrary;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-agentmd-"));
  lib = new RoleLibrary(path.join(dir, "library"), () => ["analyst", "qa"]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PREVIEW_OPTS = { builtinRoles: ["analyst", "qa"], libraryRoleIds: [] as string[], libraryItemCount: 0 };
const preview = (text: string, extra: Record<string, unknown> = {}) => buildImportPreview(text, { ...PREVIEW_OPTS, ...extra });
const agent = (frontmatter: string, body = "Bạn là một agent hữu ích.") => `---\n${frontmatter}\n---\n${body}\n`;

describe("parseFrontmatter", () => {
  it("parses string, flow array and block list tools", () => {
    expect(parseFrontmatter(agent("name: a\ntools: Read, Grep")).meta.tools).toBe("Read, Grep");
    expect(parseFrontmatter(agent("name: a\ntools: [Read, 'Grep']")).meta.tools).toEqual(["Read", "Grep"]);
    expect(parseFrontmatter(agent("name: a\ntools:\n  - Read\n  - Glob")).meta.tools).toEqual(["Read", "Glob"]);
    expect(parseFrontmatter(agent("name: a\ntools:\n- Read\n- Glob")).meta.tools).toEqual(["Read", "Glob"]);
  });

  it("handles CRLF and folded multi-line description", () => {
    const r = parseFrontmatter("---\r\nname: a\r\ndescription: >\r\n  dòng một\r\n  dòng hai\r\n---\r\nbody");
    expect(r.hasFrontmatter).toBe(true);
    expect(r.meta.description).toBe("dòng một dòng hai");
    expect(r.body).toBe("body");
  });

  it("reports no frontmatter for plain text or an unclosed block", () => {
    expect(parseFrontmatter("chỉ là văn bản").hasFrontmatter).toBe(false);
    expect(parseFrontmatter("---\nname: a\nkhông đóng").hasFrontmatter).toBe(false);
  });
});

describe("buildImportPreview: tools variants", () => {
  it("string tools", () => {
    const p = preview(agent("name: a\ntools: Read, Grep, Glob"));
    expect(p.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(p.droppedTools).toEqual([]);
  });

  it("array tools", () => {
    expect(preview(agent("name: a\ntools: [Read, Write]")).tools).toEqual(["Read", "Write"]);
  });

  it("block list tools", () => {
    expect(preview(agent("name: a\ntools:\n  - Read\n  - WebSearch")).tools).toEqual(["Read", "WebSearch"]);
  });

  it("lowercase tool names are canonicalised", () => {
    const p = preview(agent("name: a\ntools: read, grep"));
    expect(p.tools).toEqual(["Read", "Grep"]);
    expect(p.droppedTools).toEqual([]);
  });

  it("drops Bash(git:*), mcp__x, Agent and '*'", () => {
    const p = preview(agent("name: a\ntools: Read, Bash(git:*), mcp__x__do, Agent, *, Bash"));
    expect(p.tools).toEqual(["Read"]);
    expect(p.droppedTools).toEqual(["Bash(git:*)", "mcp__x__do", "Agent", "*", "Bash"]);
    expect(p.warnings).toContain("tools_dropped");
  });

  it("falls back to defaults when every tool is dropped", () => {
    const p = preview(agent("name: a\ntools: Bash, Agent"));
    expect(p.tools).toEqual([...DEFAULT_EXTRA_TOOLS]);
    expect(p.warnings).toEqual(expect.arrayContaining(["tools_dropped", "tools_defaulted"]));
  });

  it("empty tools key defaults", () => {
    const p = preview(agent("name: a\ntools:"));
    expect(p.tools).toEqual([...DEFAULT_EXTRA_TOOLS]);
    expect(p.warnings).toContain("tools_defaulted");
  });

  it("missing tools on a role defaults", () => {
    const p = preview(agent("name: a\nmodel: opus"));
    expect(p.kind).toBe("role");
    expect(p.tools).toEqual([...DEFAULT_EXTRA_TOOLS]);
  });
});

describe("buildImportPreview: model, name, description, kinds", () => {
  it("model inherit is dropped, opus kept, odd name with a space dropped", () => {
    const a = preview(agent("name: a\nmodel: inherit"));
    expect(a.model).toBeUndefined();
    expect(a.warnings).toContain("model_dropped");
    expect(preview(agent("name: a\nmodel: opus")).model).toBe("opus");
    const c = preview(agent("name: a\nmodel: my custom model"));
    expect(c.model).toBeUndefined();
    expect(c.warnings).toContain("model_dropped");
  });

  it("Vietnamese or uppercase names normalise to an ascii id", () => {
    expect(preview(agent("name: Kiểm Thử Viên")).id).toBe("kiem-thu-vien");
    expect(preview(agent("name: Code-Reviewer")).id).toBe("code-reviewer");
    expect(preview(agent("name: Đồ Họa")).id).toBe("do-hoa");
  });

  it("multi-line description is joined; over-long description is truncated", () => {
    const p = preview(agent("name: a\ndescription: |\n  dòng một\n  dòng hai"));
    expect(p.description).toBe("dòng một\ndòng hai");
    const long = preview(agent(`name: a\ndescription: ${"x".repeat(MAX_DESCRIPTION + 50)}`));
    expect(long.description.length).toBe(MAX_DESCRIPTION);
    expect(long.warnings).toContain("description_truncated");
  });

  it("SKILL.md without tools is a skill and gets no tools", () => {
    const p = preview(agent("name: my-skill\ndescription: d", "Cách làm."), { filename: "SKILL.md" });
    expect(p.kind).toBe("skill");
    expect(p.tools).toEqual([]);
  });

  it("file without frontmatter uses the file stem and warns", () => {
    const p = preview("Chỉ có nội dung prompt.", { filename: "helper-bot.md" });
    expect(p.id).toBe("helper-bot");
    expect(p.warnings).toContain("no_frontmatter");
    expect(p.prompt).toBe("Chỉ có nội dung prompt.");
  });

  it("flags danger keywords but does not block", () => {
    const p = preview(agent("name: a", "Chạy git push và curl."));
    expect(p.dangerKeywords).toEqual(expect.arrayContaining(["push", "curl"]));
    expect(p.blocked).toBeNull();
  });
});

describe("importAgentMd: flow and invariants", () => {
  const importedRoles = () => lib.list().roles;

  it("imports tool variants and never stores Bash, '*' or Agent", () => {
    const variants = [
      "tools: Read, Bash, Agent, *",
      "tools: [read, Bash(git:*), mcp__x]",
      "tools:\n  - Bash\n  - Edit\n  - Agent",
      "tools:",
      "tools: '*'",
      "name2: none",
    ];
    variants.forEach((v, i) => {
      importAgentMd(lib, { text: agent(`name: bot${i}\n${v}`) });
    });
    const roles = importedRoles();
    expect(roles).toHaveLength(variants.length);
    for (const r of roles) {
      for (const t of r.tools ?? []) {
        expect(t).not.toBe("Bash");
        expect(t).not.toBe("*");
        expect(t).not.toBe("Agent");
        expect(t.startsWith("Bash")).toBe(false);
        expect((SAFE_AGENT_TOOLS as readonly string[]).includes(t)).toBe(true);
      }
      expect((r.tools ?? []).length).toBeGreaterThan(0);
    }
    expect(importedRoles().find((r) => r.id === "bot2")?.tools).toEqual(["Edit"]);
    expect(importedRoles().find((r) => r.id === "bot1")?.tools).toEqual(["Read"]);
  });

  it("caps role prompt at 4000 chars", () => {
    importAgentMd(lib, { text: agent("name: big\ntools: Read", "Â".repeat(MAX_PROMPT + 500)) });
    const r = importedRoles().find((x) => x.id === "big");
    expect(r).toBeDefined();
    expect(r!.prompt.length).toBeLessThanOrEqual(MAX_PROMPT);
  });

  it("stores model opus, drops inherit and unknown names with spaces", () => {
    importAgentMd(lib, { text: agent("name: m1\nmodel: opus") });
    importAgentMd(lib, { text: agent("name: m2\nmodel: inherit") });
    importAgentMd(lib, { text: agent("name: m3\nmodel: some odd model") });
    const roles = importedRoles();
    expect(roles.find((r) => r.id === "m1")?.model).toBe("opus");
    expect(roles.find((r) => r.id === "m2")?.model).toBeUndefined();
    expect(roles.find((r) => r.id === "m3")?.model).toBeUndefined();
  });

  it("imports Vietnamese/uppercase name under a normalised id", () => {
    const r = importAgentMd(lib, { text: agent("name: Chuyên Gia ĐỒ HỌA\ndescription: d") });
    expect(r.created?.kind).toBe("role");
    expect(importedRoles().map((x) => x.id)).toEqual(["chuyen-gia-do-hoa"]);
  });

  it("SKILL.md without tools becomes a skill item, no role", () => {
    const r = importAgentMd(lib, { text: agent("name: Skill X\ndescription: d", "Các bước."), filename: "SKILL.md" });
    expect(r.created?.kind).toBe("skill");
    expect(lib.list().items).toHaveLength(1);
    expect(importedRoles()).toHaveLength(0);
  });

  it("file without frontmatter imports with filename stem as id", () => {
    const r = importAgentMd(lib, { text: "Nội dung thuần.", filename: "plain-agent.md" });
    expect(r.preview.warnings).toContain("no_frontmatter");
    expect(importedRoles().map((x) => x.id)).toEqual(["plain-agent"]);
  });

  it("rejects text over 128 KB and stores nothing", () => {
    const text = agent("name: huge", "x".repeat(MAX_IMPORT_TEXT_BYTES + 1));
    expect(() => importAgentMd(lib, { text })).toThrow(LibraryError);
    expect(importedRoles()).toHaveLength(0);
    expect(lib.list().items).toHaveLength(0);
  });

  it("rejects the 31st role", () => {
    for (let i = 1; i <= MAX_LIBRARY_ROLES; i++) importAgentMd(lib, { text: agent(`name: role${i}`) });
    expect(importedRoles()).toHaveLength(MAX_LIBRARY_ROLES);
    expect(() => importAgentMd(lib, { text: agent("name: one-too-many") })).toThrow(LibraryError);
    expect(importedRoles()).toHaveLength(MAX_LIBRARY_ROLES);
  });

  it("rejects an id clashing with a builtin or an existing library role (409)", () => {
    importAgentMd(lib, { text: agent("name: dup") });
    for (const name of ["dup", "DUP", "qa", "analyst"]) {
      try {
        importAgentMd(lib, { text: agent(`name: ${name}`) });
        throw new Error("expected conflict");
      } catch (e) {
        expect(e).toBeInstanceOf(LibraryError);
        expect((e as LibraryError).status).toBe(409);
      }
    }
    expect(importedRoles()).toHaveLength(1);
  });

  it("dryRun on a conflicting id reports blocked without throwing", () => {
    importAgentMd(lib, { text: agent("name: dup") });
    const r = importAgentMd(lib, { text: agent("name: dup"), dryRun: true });
    expect(r.preview.blocked).toBe("id_conflict");
    expect(r.created).toBeUndefined();
  });

  it("agent-md modules do not depend on run-manager or run-store (no runs created)", () => {
    const root = path.resolve(__dirname, "..", "..", "src", "core", "roles");
    for (const f of ["agent-md.ts", "agent-md-import.ts"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src).not.toMatch(/run-manager|run-store/);
    }
  });
});
