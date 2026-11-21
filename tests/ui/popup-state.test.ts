import { describe, it, expect } from "vitest";
import { popupReducer, popupFromHash, initialPopupState, isPopupId } from "../../ui/src/lib/popup.js";

describe("floor and skill-floor popups", () => {
  it("keeps floor payload", () => {
    const s = popupReducer(initialPopupState, {
      type: "open",
      id: "floor",
      payload: { projectName: "demo", floorNo: 2 },
    });
    expect(s.open).toBe("floor");
    expect(s.payload?.projectName).toBe("demo");
    expect(s.payload?.floorNo).toBe(2);
  });
  it("addSkillFloor replaces floor, close resets", () => {
    const f = popupReducer(initialPopupState, { type: "open", id: "floor", payload: { projectName: "", floorNo: 1 } });
    const t = popupReducer(f, { type: "open", id: "addSkillFloor" });
    expect(t).toEqual({ open: "addSkillFloor" });
    expect(popupReducer(t, { type: "close" })).toEqual({ open: null });
  });
  it("isPopupId knows new ids and drops tower2", () => {
    expect(isPopupId("floor")).toBe(true);
    expect(isPopupId("addSkillFloor")).toBe(true);
    expect(isPopupId("skillFloor")).toBe(true);
    expect(isPopupId("skillOverview")).toBe(true);
    expect(isPopupId("tower2")).toBe(false);
  });
});

describe("popupReducer", () => {
  it("opens when closed", () => {
    expect(popupReducer(initialPopupState, { type: "open", id: "cmd" })).toEqual({ open: "cmd" });
  });
  it("opening a second popup replaces the first", () => {
    const a = popupReducer(initialPopupState, { type: "open", id: "cmd" });
    expect(popupReducer(a, { type: "open", id: "history" })).toEqual({ open: "history" });
  });
  it("close when already closed keeps the same state", () => {
    expect(popupReducer(initialPopupState, { type: "close" })).toBe(initialPopupState);
  });
  it("close clears open popup and payload", () => {
    const a = popupReducer(initialPopupState, { type: "open", id: "run", payload: { runId: "r1" } });
    expect(popupReducer(a, { type: "close" })).toEqual({ open: null });
  });
  it("keeps the payload", () => {
    const a = popupReducer(initialPopupState, { type: "open", id: "cmd", payload: { projectName: "p" } });
    expect(a).toEqual({ open: "cmd", payload: { projectName: "p" } });
  });
  it("toggle closes the same popup and switches otherwise", () => {
    const a = popupReducer(initialPopupState, { type: "toggle", id: "library" });
    expect(a.open).toBe("library");
    expect(popupReducer(a, { type: "toggle", id: "library" }).open).toBeNull();
    expect(popupReducer(a, { type: "toggle", id: "settings" }).open).toBe("settings");
  });
});

describe("popupFromHash", () => {
  it("opens run popup for #/runs/<id>", () => {
    expect(popupFromHash("#/runs/abc")).toEqual({ open: "run", payload: { runId: "abc" } });
  });
  it("ignores #/cmd, token and empty hashes", () => {
    expect(popupFromHash("#/cmd")).toBeNull();
    expect(popupFromHash("#token=xyz")).toBeNull();
    expect(popupFromHash("")).toBeNull();
  });
  it("handles history and library deep links", () => {
    expect(popupFromHash("#/history")).toEqual({ open: "history" });
    expect(popupFromHash("#/library")).toEqual({ open: "library" });
  });
  it("#/office falls back to the main screen (no popup)", () => {
    expect(popupFromHash("#/office")).toBeNull();
    expect(popupFromHash("#/office?run=r9")).toBeNull();
  });
});
