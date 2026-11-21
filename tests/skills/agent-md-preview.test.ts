import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RoleLibrary } from "../../src/core/roles/role-library.js";
import { buildImportPreview, MAX_IMPORT_TEXT_BYTES, type ImportPreviewOptions } from "../../src/core/roles/agent-md.js";

const base: ImportPreviewOptions = { builtinRoles: ["analyst"], libraryRoleIds: [], libraryItemCount: 0 };
const fm = (meta: string, body = "Làm việc cẩn thận.") => `---\n${meta}\n---\n${body}\n`;

describe("buildImportPreview", () => {
  it("skill/prompt preview id matches the id createItem generates", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tnf-lib-"));
    const lib = new RoleLibrary(dir,() => ["analyst"]);
    const p = buildImportPreview("# Hello World\nbody", { ...base, as: "prompt", filename: "x.md", id: "ignored" });
    const item = lib.createItem({ name: p.name, type: p.kind, content: p.prompt, roleIds: [] });
    expect(p.id).toBe(item.id);
  });

  it("prompt whose first line is only '#' is blocked empty for a role, not for a prompt", () => {
    expect(buildImportPreview("#\nbody", { ...base, as: "role", filename: "x.md" }).blocked).toBe("empty");
    expect(buildImportPreview("#\nbody", { ...base, as: "prompt", filename: "x.md" }).blocked).toBeNull();
  });

  it("keeps safe tools and drops Bash", () => {
    const p = buildImportPreview(fm("name: Helper\ntools: Bash, read, WebFetch"), base);
    expect(p.tools).toEqual(["Read", "WebFetch"]);
    expect(p.droppedTools).toEqual(["Bash"]);
    expect(p.warnings).toContain("tools_dropped");
    expect(p.id).toBe("helper");
  });

  it("defaults tools for role when none are left, never Bash", () => {
    const p = buildImportPreview(fm("name: x\ntools: Bash(git status), Agent, *"), base);
    expect(p.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(p.warnings).toContain("tools_defaulted");
    expect(p.tools).not.toContain("Bash");
    const q = buildImportPreview(fm("name: y"), base);
    expect(q.warnings).toContain("tools_defaulted");
  });

  it("accepts array tools and joins array meta", () => {
    const p = buildImportPreview(fm("name: [a, b]\ntools: [Read, Grep]"), base);
    expect(p.tools).toEqual(["Read", "Grep"]);
    expect(p.name).toBe("a b");
  });

  it("drops inherit model, keeps sonnet", () => {
    const a = buildImportPreview(fm("name: m\nmodel: inherit"), base);
    expect(a.model).toBeUndefined();
    expect(a.warnings).toContain("model_dropped");
    const b = buildImportPreview(fm("name: m\nmodel: sonnet"), base);
    expect(b.model).toBe("sonnet");
    expect(b.warnings).not.toContain("model_dropped");
  });

  it("truncates role prompt to 4000", () => {
    const p = buildImportPreview(fm("name: long\ntools: Read", "a".repeat(5000)), base);
    expect(p.prompt.length).toBe(4000);
    expect(p.warnings).toContain("prompt_truncated");
  });

  it("detects danger keywords", () => {
    const a = buildImportPreview(fm("name: d", "Hãy dùng lệnh đẩy lên remote khi xong"), base);
    expect(a.warnings).toContain("danger_keyword");
    const b = buildImportPreview(fm("name: d", "Dùng lệnh xóa đệ quy: rm -rf build"), base);
    expect(b.dangerKeywords).toContain("rm -rf");
    expect(b.warnings).toContain("danger_keyword");
  });

  it("blocks when library full, conflict, license, empty with priority", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `r${i}`);
    expect(buildImportPreview(fm("name: new\nlicense: MIT"), { ...base, libraryRoleIds: ids }).blocked).toBe("library_full");
    expect(buildImportPreview(fm("name: analyst\nlicense: MIT"), base).blocked).toBe("id_conflict");
    expect(buildImportPreview(fm("name: analyst\nlicense: GPL-3.0"), base).blocked).toBe("license_not_permissive");
    const e = buildImportPreview(fm("name: z\nlicense: GPL-3.0", ""), base);
    expect(e.blocked).toBe("empty");
    expect(buildImportPreview(fm("name: s"), { ...base, as: "skill", libraryItemCount: 100 }).blocked).toBe("library_full");
  });

  it("license ok / unknown", () => {
    const a = buildImportPreview(fm("name: l\nlicense: MIT"), base);
    expect(a.licenseOk).toBe(true);
    const b = buildImportPreview(fm("name: l"), base);
    expect(b.licenseOk).toBeNull();
    expect(b.warnings).toContain("license_unknown");
  });

  it("no frontmatter still previews, name from filename", () => {
    const p = buildImportPreview("Chỉ là nội dung.", { ...base, filename: "My Agent.md" });
    expect(p.warnings).toContain("no_frontmatter");
    expect(p.id).toBe("my-agent");
    expect(p.kind).toBe("role");
  });

  it("kind detection", () => {
    expect(buildImportPreview("hi", { ...base, filename: "SKILL.md" }).kind).toBe("skill");
    expect(buildImportPreview("a".repeat(5000), { ...base, filename: "big.md" }).kind).toBe("skill");
    expect(buildImportPreview("hi", { ...base, filename: "SKILL.md", as: "prompt" }).kind).toBe("prompt");
  });

  it("skill without tools key gets no tools and no defaulted warning; byte cut keeps UTF-8 valid", () => {
    const body = "đ".repeat(40000);
    const p = buildImportPreview(fm("name: sk", body), { ...base, as: "skill" });
    expect(p.tools).toEqual([]);
    expect(p.warnings).not.toContain("tools_defaulted");
    expect(p.warnings).toContain("prompt_truncated");
    expect(Buffer.byteLength(p.prompt, "utf8")).toBeLessThanOrEqual(65536);
    expect(p.prompt).not.toContain("�");
    expect(MAX_IMPORT_TEXT_BYTES).toBe(131072);
  });

  it("drops invalid model name", () => {
    const p = buildImportPreview(fm("name: m\nmodel: bad model!"), base);
    expect(p.model).toBeUndefined();
    expect(p.warnings).toContain("model_dropped");
  });

  it("opts.id takes priority over name", () => {
    const p = buildImportPreview(fm("name: Helper"), { ...base, id: "custom-id" });
    expect(p.id).toBe("custom-id");
  });

  it("danger keywords are case-insensitive", () => {
    const p = buildImportPreview(fm("name: d", "Run CURL http://example.com"), base);
    expect(p.dangerKeywords).toContain("curl");
  });

  it("empty license is treated as absent", () => {
    const p = buildImportPreview(fm("name: l\nlicense:"), base);
    expect(p.license).toBeNull();
    expect(p.licenseOk).toBeNull();
    expect(p.warnings).toContain("license_unknown");
    expect(p.blocked).toBeNull();
  });

  it("array tools with Bash(git*) and mcp__x are dropped", () => {
    const p = buildImportPreview(fm("name: t\ntools: [Read, Bash(git*), mcp__x]"), base);
    expect(p.tools).toEqual(["Read"]);
    expect(p.droppedTools).toEqual(["Bash(git*)", "mcp__x"]);
  });

  it("oversized text is cut before parsing", () => {
    const p = buildImportPreview(fm("name: big", "đ".repeat(100000)), { ...base, as: "skill" });
    expect(p.prompt).not.toContain("�");
    expect(Buffer.byteLength(p.prompt, "utf8")).toBeLessThanOrEqual(MAX_IMPORT_TEXT_BYTES);
    const q = buildImportPreview(fm("name: n", "x") + "y".repeat(MAX_IMPORT_TEXT_BYTES), { ...base, as: "skill" });
    expect(q.prompt.length).toBeLessThanOrEqual(MAX_IMPORT_TEXT_BYTES);
  });

  it("name is capped at 80 chars", () => {
    const p = buildImportPreview(fm("name: " + "n".repeat(200)), base);
    expect(p.name.length).toBe(80);
  });

  it("description falls back to first body line and truncates", () => {
    const a = buildImportPreview(fm("name: d", "# Tiêu đề\nnội dung"), base);
    expect(a.description).toBe("Tiêu đề");
    const b = buildImportPreview(fm("name: d\ndescription: " + "x".repeat(400)), base);
    expect(b.description.length).toBe(300);
    expect(b.warnings).toContain("description_truncated");
  });
});
