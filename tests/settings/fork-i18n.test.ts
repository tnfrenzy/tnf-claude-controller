import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const d = dicts as unknown as Record<string, Record<string, unknown>>;

const REQUIRED = [
  "fork_continue_here",
  "fork_prompt_title",
  "fork_prompt_placeholder",
  "fork_confirm_title",
  "fork_confirm_body",
  "fork_confirm_ok",
  "fork_confirm_cancel",
  "fork_history_from_run",
  "fork_history_from_commit",
  "fork_error_invalid_sha",
  "fork_error_sha_not_on_branch",
  "fork_disk_warning"
];

function placeholders(s: string): string[] {
  return (s.match(/\{[^}]+\}/g) ?? []).slice().sort();
}

function keysWithPrefix(prefix: string): string[] {
  const all = new Set([...Object.keys(d.vi), ...Object.keys(d.en)]);
  return [...all].filter((k) => k.startsWith(prefix));
}

describe("fork i18n keys", () => {
  const keys = keysWithPrefix("fork_");
  it("has at least 12 keys", () => expect(keys.length).toBeGreaterThanOrEqual(12));

  for (const key of keys) {
    it(`${key} exists in vi and en with matching placeholders`, () => {
      const vi = d.vi[key];
      const en = d.en[key];
      expect(typeof vi).toBe("string");
      expect(typeof en).toBe("string");
      expect((vi as string).length).toBeGreaterThan(0);
      expect((en as string).length).toBeGreaterThan(0);
      expect(placeholders(vi as string)).toEqual(placeholders(en as string));
    });
  }

  for (const key of REQUIRED) {
    it(`has required ${key}`, () => {
      expect(typeof d.vi[key]).toBe("string");
      expect(typeof d.en[key]).toBe("string");
    });
  }

  const needs: Record<string, string[]> = {
    fork_prompt_title: ["{sha}"],
    fork_confirm_title: ["{sha}"],
    fork_error_invalid_sha: ["{sha}"],
    fork_confirm_body: ["{branch}", "{sha}", "{run}"],
    fork_error_sha_not_on_branch: ["{sha}", "{branch}"]
  };
  for (const [key, list] of Object.entries(needs)) {
    for (const lang of ["vi", "en"]) {
      it(`${lang}.${key} contains ${list.join(", ")}`, () => {
        const s = d[lang][key] as string;
        for (const p of list) expect(s).toContain(p);
      });
    }
  }

  it("vi disk warning mentions node_modules and worktree", () => {
    const s = d.vi.fork_disk_warning as string;
    expect(s).toContain("node_modules");
    expect(s).toContain("worktree");
  });
});
