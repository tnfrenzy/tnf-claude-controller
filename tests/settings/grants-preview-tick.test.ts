import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { GROUP_FIELDS } from "../../ui/src/settings/grantsView.js";

const src = readFileSync(new URL("../../ui/src/components/settings/GrantsSection.tsx", import.meta.url), "utf8");
const d = dicts as unknown as Record<string, Record<string, string>>;

describe("grants tab: preview tick", () => {
  it("renders a separate checkbox bound to grants.preview and saved via save()", () => {
    expect(src).toContain('data-testid="grants-preview"');
    expect(src).toContain("checked={g.preview}");
    expect(src).toMatch(/\{ \.\.\.cur, preview: e\.target\.checked \}/);
    expect(src).toContain("t.grants_preview");
    expect(src).toContain("t.grants_preview_hint");
  });
  it("is not part of GROUP_FIELDS", () => {
    expect(GROUP_FIELDS.map((f) => f.key)).not.toContain("preview" as never);
    expect(GROUP_FIELDS).toHaveLength(8);
  });
  it("has vi and en label and hint", () => {
    for (const lang of ["vi", "en"]) for (const k of ["grants_preview", "grants_preview_hint"]) expect(d[lang]![k]!.trim().length).toBeGreaterThan(0);
  });
});
