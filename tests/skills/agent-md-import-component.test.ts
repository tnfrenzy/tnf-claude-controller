import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMdImport, showIdField } from "../../ui/src/components/skills/AgentMdImport";

const SRC = path.resolve(__dirname, "..", "..", "ui", "src", "components", "skills", "AgentMdImport.tsx");
const html = renderToStaticMarkup(createElement(AgentMdImport, { onImported: () => undefined }));

describe("AgentMdImport", () => {
  it("renders a textarea", () => {
    expect(html).toContain("<textarea");
  });
  it("has the preview button", () => {
    expect(html).toMatch(/<button[^>]*>Xem trước<\/button>/);
  });
  it("always shows the not-vetted reminder", () => {
    expect(html).toContain("chưa được kiểm an toàn");
  });
  it("import button is disabled before a preview", () => {
    expect(html).toMatch(/<button disabled=""[^>]*>Nhập vào thư viện<\/button>/);
  });
  it("accepts only .md/.markdown files", () => {
    expect(html).toContain('accept=".md,.markdown"');
  });
  it("shows the id field only for role/auto targets", () => {
    expect(showIdField("role")).toBe(true);
    expect(showIdField("auto")).toBe(true);
    expect(showIdField("skill")).toBe(false);
    expect(showIdField("prompt")).toBe(false);
  });
  it("clears the file name when the pasted text is edited", () => {
    expect(readFileSync(SRC, "utf8")).toContain('setText(e.target.value); setFileName(""); reset();');
  });
  it("never renders HTML from the prompt", () => {
    expect(readFileSync(SRC, "utf8")).not.toContain("dangerouslySetInnerHTML");
  });
});
