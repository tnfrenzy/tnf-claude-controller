import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const FIXED = [
  "button", "title", "paste", "choose_file", "preview", "confirm",
  "as_role", "as_skill", "as_prompt", "dropped_tools", "danger", "not_vetted", "done",
  "blocked_empty", "blocked_library_full", "blocked_id_conflict", "blocked_license",
].map((k) => `lib_import_${k}`);

const WARN_CODES = [
  "no_frontmatter", "tools_dropped", "tools_defaulted", "model_dropped",
  "prompt_truncated", "description_truncated", "danger_keyword", "license_unknown",
];

// Read the warning codes from the source so a new code without a key fails here.
function sourceWarnCodes(): string[] {
  const src = readFileSync(path.resolve(__dirname, "..", "..", "src", "core", "roles", "agent-md.ts"), "utf8");
  const m = /export type AgentMdWarning\s*=([^;]+);/.exec(src);
  if (!m) throw new Error("AgentMdWarning union not found");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

const WARN = WARN_CODES.map((c) => `lib_import_warn_${c}`);
const ALL = [...FIXED, ...WARN];
const keys = (lang: "vi" | "en") => Object.keys(dicts[lang]).filter((k) => k.startsWith("lib_import_")).sort();
const get = (lang: "vi" | "en", k: string) => (dicts[lang] as Record<string, string>)[k];

describe("lib_import_ i18n keys", () => {
  it("lists 17 fixed keys and 8 warning codes", () => {
    expect(FIXED.length).toBe(17);
    expect(WARN.length).toBe(8);
  });
  it("every key exists in vi and en and is non-empty", () => {
    for (const lang of ["vi", "en"] as const)
      for (const k of ALL) expect((get(lang, k) ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("vi and en have the same lib_import_ key set", () => {
    expect(keys("vi")).toEqual(keys("en"));
    expect(keys("vi")).toEqual([...ALL].sort());
  });
  it("has a warn key for every AgentMdWarning code in the source", () => {
    const codes = sourceWarnCodes();
    expect(codes.length).toBeGreaterThan(0);
    expect([...codes].sort()).toEqual([...WARN_CODES].sort());
    for (const lang of ["vi", "en"] as const)
      for (const c of codes) expect(get(lang, `lib_import_warn_${c}`), `${lang} ${c}`).toBeTruthy();
  });
  it("not_vetted reminder is present", () => {
    expect(get("vi", "lib_import_not_vetted")).toContain("chưa được kiểm an toàn");
    expect(get("en", "lib_import_not_vetted")).toContain("not safety-vetted");
  });
});
