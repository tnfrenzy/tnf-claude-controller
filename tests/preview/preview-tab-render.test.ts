import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PreviewTab } from "../../ui/src/components/run/PreviewTab";

describe("PreviewTab smoke render", () => {
  it("renders the initial (form) state without touching window", () => {
    const html = renderToString(createElement(PreviewTab, { runId: "r1", project: "p" }));
    expect(html).toContain("preview-tab");
    expect(html).toContain("Chụp ảnh");
    expect(html).toContain("Cho phép chạy ứng dụng");
  });
});
