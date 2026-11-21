import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseView, toggleView, viewReducer } from "../../ui/src/lib/view-mode";
import { PREF_VIEW } from "../../ui/src/lib/prefs";

describe("view-mode", () => {
  it("defaults to city", () => {
    expect(DEFAULT_VIEW).toBe("city");
  });
  it("parseView", () => {
    expect(parseView("")).toBe("city");
    expect(parseView("xyz")).toBe("city");
    expect(parseView("office")).toBe("office");
  });
  it("toggles both ways", () => {
    expect(toggleView("city")).toBe("office");
    expect(toggleView("office")).toBe("city");
    expect(viewReducer("city", { type: "toggle" })).toBe("office");
  });
  it("set valid and invalid", () => {
    expect(viewReducer("city", { type: "set", view: "office" })).toBe("office");
    expect(viewReducer("office", { type: "set", view: "nope" })).toBe("office");
  });
  it("pref key", () => {
    expect(PREF_VIEW).toBe("tnf.view");
  });
});
