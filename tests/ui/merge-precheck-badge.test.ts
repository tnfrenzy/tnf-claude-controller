import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MergePrecheckBadge, MergePrecheckFiles, mergePrecheckTone } from "../../ui/src/components/run/MergePrecheckBadge.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";
import type { MergePrecheck } from "../../ui/src/types.js";

const render = (precheck: MergePrecheck | null | undefined, onRecheck?: () => void) =>
  renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
      createElement(MergePrecheckBadge, { precheck, onRecheck }),
    ),
  );

const mk = (status: string, files: string[] = [], reason?: string) =>
  ({ status, files, reason, checked_at: 1 }) as unknown as MergePrecheck;

describe("mergePrecheckTone", () => {
  it("is ok only for clean", () => {
    expect(mergePrecheckTone("clean")).toBe("ok");
    expect(mergePrecheckTone("conflict")).toBe("err");
    expect(mergePrecheckTone("unknown")).toBe("muted");
    expect(mergePrecheckTone("weird")).toBe("muted");
    expect(mergePrecheckTone("")).toBe("muted");
  });
});

describe("MergePrecheckBadge", () => {
  it("shows 'chưa kiểm' for null", () => {
    const html = render(null);
    expect(html).toContain("chưa kiểm");
    expect(html).toContain("verdict muted");
  });

  it("renders clean as ok", () => {
    expect(render(mk("clean"))).toContain("verdict ok");
  });

  it("renders conflict with toggle and hidden chips by default", () => {
    const html = render(mk("conflict", ["a.ts", "b.ts"]));
    expect(html).toContain("verdict err");
    expect(html).toContain(dicts.vi.mergePrecheck_expand);
    expect(html).not.toContain("chip");
    expect(html).not.toContain("a.ts");
  });

  it("renders conflict with empty files without toggle", () => {
    const html = render(mk("conflict", []));
    expect(html).not.toContain(dicts.vi.mergePrecheck_expand);
    expect(html).not.toContain(dicts.vi.mergePrecheck_collapse);
    expect(html).toContain("muted");
  });

  it("renders unknown as muted with reason, never ok/err or safe", () => {
    const html = render(mk("unknown", [], "git lỗi"));
    expect(html).toContain("verdict muted");
    expect(html).not.toContain("verdict ok");
    expect(html).not.toContain("verdict err");
    expect(html).toContain("git lỗi");
    const noReason = render(mk("unknown"));
    expect(noReason).toContain(dicts.vi.mergePrecheck_reasonEmpty);
    expect(noReason).not.toContain("an toàn");
  });

  it("treats unexpected or empty status as muted", () => {
    expect(render(mk("weird"))).toContain("verdict muted");
    expect(render(mk(""))).not.toContain("verdict ok");
  });

  it("unknown labels never claim safety", () => {
    expect(dicts.vi.mergePrecheck_unknown).not.toContain("an toàn");
    expect(dicts.en.mergePrecheck_unknown.toLowerCase()).not.toContain("safe");
  });

  it("expanded list caps at 20 files with a 'more' line", () => {
    const files = Array.from({ length: 25 }, (_, i) => `f${String(i).padStart(2, "0")}.ts`);
    const html = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
        createElement(MergePrecheckFiles, { files, open: true }),
      ),
    );
    expect(html).toContain("f19.ts");
    expect(html).not.toContain("f20.ts");
    expect(html).toContain(dicts.vi.mergePrecheck_moreFiles.split("{n}").join("5"));
    expect((html.match(/class="chip"/g) ?? []).length).toBe(20);
  });

  it("escapes HTML in file names", () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
        createElement(MergePrecheckFiles, { files: ["<img src=x onerror=1>.ts"], open: true }),
      ),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders recheck button only with onRecheck", () => {
    expect(render(mk("clean"), () => {})).toContain(dicts.vi.mergePrecheck_recheck);
    expect(render(mk("clean"))).not.toContain(dicts.vi.mergePrecheck_recheck);
  });
});
