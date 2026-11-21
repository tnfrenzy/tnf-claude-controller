import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../ui/src/skills/useLibrary", () => ({
  useLibrary: () => ({ lib: null, error: null, reload: async () => undefined }),
}));

import { LibraryPage } from "../../ui/src/pages/LibraryPage";

const html = renderToStaticMarkup(createElement(LibraryPage, { status: null }));

describe("LibraryPage import button", () => {
  it("shows the Import button", () => {
    expect(html).toMatch(/<button[^>]*>Nhập<\/button>/);
  });
  it("keeps the import panel closed initially", () => {
    expect(html).not.toContain("Xem trước");
  });
});
