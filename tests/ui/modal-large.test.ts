import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Modal } from "../../ui/src/components/common/Modal.js";
import { dicts } from "../../ui/src/i18n.js";

const render = (size?: "normal" | "large") =>
  renderToStaticMarkup(createElement(Modal, { title: "Tầng 1 · TNF", sub: "phụ đề", size, onClose: () => {} }, "x"));

describe("Modal size", () => {
  it("large adds ss-modal-lg", () => {
    expect(render("large")).toContain("ss-modal-lg");
  });
  it("default has no ss-modal-lg", () => {
    expect(render()).not.toContain("ss-modal-lg");
    expect(render("normal")).not.toContain("ss-modal-lg");
  });
  it("shows title and sub", () => {
    const html = render("large");
    expect(html).toContain("Tầng 1 · TNF");
    expect(html).toContain("phụ đề");
  });
  it("city.css defines .ss-modal-lg", () => {
    expect(readFileSync("ui/src/office/city.css", "utf8")).toContain(".ss-modal-lg");
  });
  it("vi and en both have the new keys", () => {
    for (const k of ["floor_sub", "floor_flow", "view_to_office", "view_to_city"] as const) {
      expect(dicts.vi[k]).toBeTruthy();
      expect(dicts.en[k]).toBeTruthy();
    }
  });
});
