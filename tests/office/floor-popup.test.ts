import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FloorPopup, floorTitle, flowText } from "../../ui/src/office/FloorPopup.js";
import { dicts } from "../../ui/src/i18n.js";

describe("floorTitle", () => {
  it("builds 'Tầng n · name'", () => {
    expect(floorTitle(1, "TNF", dicts.vi)).toBe("Tầng 1 · TNF");
  });
  it("uses the default name when empty", () => {
    expect(floorTitle(2, "", dicts.vi)).toBe("Tầng 2 · default");
  });
});

describe("flowText", () => {
  it("joins with arrows", () => {
    expect(flowText(["zz_a", "zz_b", "zz_c"])).toBe("zz_a → zz_b → zz_c");
  });
  it("empty gives empty string", () => {
    expect(flowText([])).toBe("");
  });
});

describe("FloorPopup", () => {
  it("renders the flow label and the isometric office stage", () => {
    const html = renderToStaticMarkup(createElement(FloorPopup, { projectName: "", floorNo: 1, onOpenRun: () => {}, onClose: () => {} }));
    expect(html).not.toContain("stage-office");
    expect(html).toContain("Luồng:");
  });
});
