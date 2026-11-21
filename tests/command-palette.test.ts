import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPalette } from "../ui/src/components/CommandPalette";
import { I18nContext, dicts } from "../ui/src/i18n";

const t = dicts.vi;

const data = { projects: [{ name: "proj-alpha" }] } as never;

function render(open: boolean, over: { initialData?: unknown; shortcuts?: Record<string, string> } = {}): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { lang: "vi", t, setLang: () => {} } },
      createElement(CommandPalette, { open, onClose: () => {}, onAction: () => {}, initialData: (over.initialData ?? data) as never, ...(over.shortcuts ? { shortcuts: over.shortcuts } : {}) }),
    ),
  );
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    expect(render(false)).toBe("");
  });

  it("renders page and env groups and the project, with no run group", () => {
    const html = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain(t.palette_group_pages);
    expect(html).toContain(t.palette_group_envs);
    expect(html).not.toContain(t.palette_group_runs);
    expect(html).toContain("proj-alpha");
  });

  it("escapes html in project names", () => {
    const html = render(true, { initialData: { projects: [{ name: "<img src=x onerror=1>" }] } });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("shows Alt+ hints from the shortcuts prop", () => {
    const html = render(true, { shortcuts: { "page:cmd": "R", "env:proj-alpha": "P" } });
    expect(html).toContain("Alt+R");
    expect(html).toContain("Alt+P");
  });
});
