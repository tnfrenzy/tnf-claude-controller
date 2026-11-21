import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_MD_BYTES,
  importBlockedKey,
  importWarningKey,
  isAgentMdFileName,
} from "../../ui/src/skills/library.js";
import type { AgentMdWarning } from "../../ui/src/types.js";
import { MAX_IMPORT_TEXT_BYTES } from "../../src/core/roles/agent-md.js";

describe("library import helpers", () => {
  it("UI and server size limits match and are 131072", () => {
    expect(MAX_IMPORT_MD_BYTES).toBe(MAX_IMPORT_TEXT_BYTES);
    expect(MAX_IMPORT_TEXT_BYTES).toBe(131072);
  });

  it("MAX_IMPORT_MD_BYTES is 131072", () => {
    expect(MAX_IMPORT_MD_BYTES).toBe(131072);
  });

  it("isAgentMdFileName accepts .md/.markdown only", () => {
    for (const n of ["a.md", "SKILL.MD", "x.markdown", "Docs/Agent.Md"]) expect(isAgentMdFileName(n)).toBe(true);
    for (const n of ["a.json", "a.mdx", "md", "", ".md"]) expect(isAgentMdFileName(n)).toBe(false);
  });

  it("importWarningKey maps all warning codes", () => {
    const codes: AgentMdWarning[] = [
      "no_frontmatter", "tools_dropped", "tools_defaulted", "model_dropped",
      "prompt_truncated", "description_truncated", "danger_keyword", "license_unknown",
    ];
    for (const c of codes) expect(importWarningKey(c)).toBe("lib_import_warn_" + c);
  });

  it("importBlockedKey maps blocked codes", () => {
    expect(importBlockedKey("empty")).toBe("lib_import_blocked_empty");
    expect(importBlockedKey("library_full")).toBe("lib_import_blocked_library_full");
    expect(importBlockedKey("id_conflict")).toBe("lib_import_blocked_id_conflict");
    expect(importBlockedKey("license_not_permissive")).toBe("lib_import_blocked_license");
  });
});
