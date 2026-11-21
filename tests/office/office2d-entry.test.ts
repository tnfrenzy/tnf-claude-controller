import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("the office has no nav button", () => {
  it("the left panel keeps four nav buttons and no office popup", () => {
    expect(fs.readFileSync("ui/src/components/LeftPanel.tsx", "utf8")).not.toContain('onOpen("office2d")');
    expect(fs.readFileSync("ui/src/App.tsx", "utf8")).not.toContain("office2d");
    expect(fs.readFileSync("ui/src/lib/popup.ts", "utf8")).not.toContain("office2d");
  });
  it("the office lives in the main screen stage and the floor popups", () => {
    expect(fs.readFileSync("ui/src/office/OfficeStage.tsx", "utf8")).toContain("OfficeRooms");
    expect(fs.readFileSync("ui/src/office/FloorPopup.tsx", "utf8")).not.toContain("OfficeRooms");
  });
});
