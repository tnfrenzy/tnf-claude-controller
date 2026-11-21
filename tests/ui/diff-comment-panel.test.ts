import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentEditor, CommentList } from "../../ui/src/components/run/DiffCommentPanel.js";
import type { DiffComment } from "../../ui/src/run/diffComments.js";

const noop = () => {};
const mk = (n: number): DiffComment[] =>
  Array.from({ length: n }, (_, i) => ({ file: `src/f${i}.ts`, line: i + 1, side: "new" as const, text: `c${i}` }));

describe("DiffCommentPanel", () => {
  it("empty list renders nothing", () => {
    const html = renderToStaticMarkup(createElement(CommentList, { comments: [], lang: "en", onEdit: noop, onDelete: noop }));
    expect(html).toBe("");
  });
  it("3 comments show 3/50 and file:line", () => {
    const html = renderToStaticMarkup(createElement(CommentList, { comments: mk(3), lang: "vi", onEdit: noop, onDelete: noop }));
    expect(html).toContain("3/50");
    expect(html).toContain("src/f0.ts:1");
    expect(html).toContain("src/f2.ts:3");
  });
  it("disabled flag disables edit/delete buttons", () => {
    const html = renderToStaticMarkup(createElement(CommentList, { comments: mk(1), lang: "en", onEdit: noop, onDelete: noop, disabled: true }));
    expect(html).toContain("disabled");
  });
  it("editor with 2001 chars disables save and shows too-long", () => {
    const html = renderToStaticMarkup(createElement(CommentEditor, { initial: "a".repeat(2001), onSave: noop, onCancel: noop, lang: "en" }));
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Save/);
    expect(html).toContain("exceeds 2000");
  });
  it("editor with 2000 chars is savable", () => {
    const html = renderToStaticMarkup(createElement(CommentEditor, { initial: "a".repeat(2000), onSave: noop, onCancel: noop, lang: "en" }));
    expect(html).not.toMatch(/disabled/);
    expect(html).not.toContain("exceeds");
    expect(html).toContain("2000/2000");
  });
});
