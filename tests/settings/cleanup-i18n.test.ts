import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const d = dicts as unknown as Record<string, Record<string, unknown>>;

const REASONS = [
  "active",
  "no_worktree",
  "no_branch",
  "no_project",
  "too_recent",
  "shared_worktree",
  "outside_worktrees_dir",
  "missing",
  "uncommitted",
  "unmerged",
  "status_unknown",
  "error"
];

function placeholders(s: string): string[] {
  return (s.match(/\{[^}]+\}/g) ?? []).slice().sort();
}

function keysWithPrefix(...prefixes: string[]): string[] {
  const all = new Set([...Object.keys(d.vi), ...Object.keys(d.en)]);
  return [...all].filter((k) => prefixes.some((p) => k.startsWith(p)));
}

function checkParity(keys: string[]) {
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
}

describe("bulk cleanup i18n keys", () => {
  const keys = keysWithPrefix("cleanup_bulk_", "cleanup_skip_");
  it("has keys", () => expect(keys.length).toBeGreaterThan(10));
  checkParity(keys);
  for (const r of REASONS) {
    it(`has cleanup_skip_${r}`, () => {
      expect(typeof d.vi[`cleanup_skip_${r}`]).toBe("string");
      expect(typeof d.en[`cleanup_skip_${r}`]).toBe("string");
    });
  }
});

describe("usage blocks i18n keys", () => {
  const keys = keysWithPrefix("usage_blocks_");
  it("has keys", () => expect(keys.length).toBeGreaterThanOrEqual(5));
  checkParity(keys);
  it("time_left has {h} and {m}", () => {
    for (const lang of ["vi", "en"]) {
      const s = d[lang].usage_blocks_time_left as string;
      expect(s).toContain("{h}");
      expect(s).toContain("{m}");
    }
  });
  it("vi cost label says estimated", () => {
    expect(d.vi.usage_blocks_cost as string).toContain("ước tính");
  });
});
