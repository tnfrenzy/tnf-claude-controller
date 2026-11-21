import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddSkillFloorForm } from "../../ui/src/pages/AddSkillFloorForm";

describe("AddSkillFloorForm required markers", () => {
  const html = renderToStaticMarkup(createElement(AddSkillFloorForm, { onDone: () => undefined }));
  it("has the required note and a red star on every field", () => {
    expect(html).toContain("* bắt buộc");
    // name, input, output, examples legend, 2 pairs x2, pass, rounds = 10 stars
    expect((html.match(/>\*<\/span>/g) ?? []).length).toBe(10);
  });
  it("marks all inputs aria-required and shows no error before submit", () => {
    expect((html.match(/aria-required="true"/g) ?? []).length).toBe(9);
    expect(html).not.toContain('role="alert"');
  });
});
