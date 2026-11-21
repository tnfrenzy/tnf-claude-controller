import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectsToFloors, showQueue } from "../../ui/src/office/floors.js";
import { FloorPopup } from "../../ui/src/office/FloorPopup.js";

describe("showQueue", () => {
  it("is false for default, empty name and missing repo", () => {
    expect(showQueue("default", "D:\\repo")).toBe(false);
    expect(showQueue("", "D:\\repo")).toBe(false);
    expect(showQueue("  ", "D:\\repo")).toBe(false);
    expect(showQueue("app", null)).toBe(false);
    expect(showQueue("app", undefined)).toBe(false);
    expect(showQueue("app", "  ")).toBe(false);
  });
  it("is true for a project with a repo", () => {
    expect(showQueue("app", "D:\\repo")).toBe(true);
  });
});

describe("floors hasRepo", () => {
  it("is set only for projects with a repo; default floor unchanged", () => {
    const floors = projectsToFloors([
      { name: "default", running: 0, repo_path: null },
      { name: "a", running: 0, repo_path: "D:\\a" },
      { name: "b", running: 0, repo_path: null },
    ]);
    expect(floors[0]).toEqual({ id: "default", name: "Tầng trệt", running: false });
    expect(floors.find((f) => f.id === "a")?.hasRepo).toBe(true);
    expect(floors.find((f) => f.id === "b")).toEqual({ id: "b", name: "b", running: false });
  });
});

describe("FloorPopup queue mount", () => {
  const base = { projectName: "app", floorNo: 1, onOpenRun: () => undefined, onClose: () => undefined };
  it("renders floor-queue only when hasRepo", () => {
    expect(renderToStaticMarkup(createElement(FloorPopup, { ...base, hasRepo: true }))).toContain("floor-queue");
    expect(renderToStaticMarkup(createElement(FloorPopup, base))).not.toContain("floor-queue");
    expect(renderToStaticMarkup(createElement(FloorPopup, { ...base, projectName: "", hasRepo: true }))).not.toContain("floor-queue");
  });
});
