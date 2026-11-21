import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { floorOfficeRunId } from "../../ui/src/office/FloorPopup.js";
import { dicts } from "../../ui/src/i18n.js";

describe("office visibility", () => {
  it("floorOfficeRunId maps run to id", () => {
    expect(floorOfficeRunId(null)).toBeNull();
    expect(floorOfficeRunId({ id: "r1" })).toBe("r1");
  });
  it("FloorPopup and the main stage mount the four-room office", () => {
    expect(readFileSync("ui/src/office/FloorPopup.tsx", "utf8")).not.toContain("OfficeRooms");
    expect(readFileSync("ui/src/office/OfficeStage.tsx", "utf8")).toContain("OfficeRooms");
  });
  it("LeftPanel view toggle is icon-only (label kept as tooltip)", () => {
    const src = readFileSync("ui/src/components/LeftPanel.tsx", "utf8");
    expect(src).not.toContain("view-toggle-text");
    expect(src).toContain("aria-label={viewLabel}");

  });
  it("view labels exist in both languages", () => {
    expect(dicts.vi.view_to_office).toBeTruthy();
    expect(dicts.en.view_to_city).toBeTruthy();
  });
});
