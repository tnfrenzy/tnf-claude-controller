import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MergePrecheckBadge } from "../../ui/src/components/run/MergePrecheckBadge.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";
import type { MergePrecheck } from "../../ui/src/types.js";

const render = (precheck: MergePrecheck | null | undefined, compact = true) =>
  renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
      createElement(MergePrecheckBadge, { precheck, compact }),
    ),
  );

const mk = (status: string, files: string[] = [], reason?: string) =>
  ({ status, files, reason, checked_at: 1 }) as unknown as MergePrecheck;

describe("MergePrecheckBadge compact", () => {
  it("clean: label, no div, no button", () => {
    const html = render(mk("clean"));
    expect(html).toContain(dicts.vi.mergePrecheck_clean);
    expect(html).not.toContain("<div");
    expect(html).not.toContain("<button");
  });

  it("conflict: file names in title, no chips, no div", () => {
    const html = render(mk("conflict", ["a.ts", "b.ts"]));
    expect(html).toContain('title="a.ts, b.ts"');
    expect(html).not.toContain('class="chip"');
    expect(html).not.toContain("<div");
    expect(html).not.toContain("<button");
  });

  it("conflict: escapes HTML in file names", () => {
    const html = render(mk("conflict", ["<img src=x>.ts"]));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("conflict: caps title at 20 files plus more", () => {
    const files = Array.from({ length: 25 }, (_, i) => `f${String(i).padStart(2, "0")}.ts`);
    const html = render(mk("conflict", files));
    expect(html).toContain("f19.ts");
    expect(html).not.toContain("f20.ts");
    expect(html).toContain(dicts.vi.mergePrecheck_moreFiles.split("{n}").join("5"));
  });

  it("unknown never claims safety", () => {
    const html = render(mk("unknown", [], "git lỗi"));
    expect(html).not.toContain("an toàn");
    expect(html).toContain("git lỗi");
  });

  it("null shows none label", () => {
    expect(render(null)).toContain(dicts.vi.mergePrecheck_none);
  });

  it("non-compact conflict still has expand button", () => {
    expect(render(mk("conflict", ["a.ts"]), false)).toContain(dicts.vi.mergePrecheck_expand);
  });
});
