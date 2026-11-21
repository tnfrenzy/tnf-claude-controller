import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CityScene } from "../../ui/src/office/CityScene";
import { MAX_VS_FLOORS, anyVsBusy, canAddVideoStudio, videoStudioTowerFloors, vsBadge } from "../../ui/src/office/videostudio-floors";
import { popupFromHash, popupReducer, initialPopupState } from "../../ui/src/lib/popup";
import type { VsListItem, VsState } from "../../src/core/videostudio/plan-types";

const item = (n: number, state: VsState): VsListItem => ({
  slug: `video-${n}`,
  title: `Video số ${n}`,
  state,
  aspect: "16:9",
  updatedAt: new Date(Date.UTC(2026, 10, 19, 0, n)).toISOString(),
});

describe("videoStudioTowerFloors", () => {
  it("keeps at most 5 floors and prefers the newest projects", () => {
    const all = Array.from({ length: 8 }, (_, i) => item(i + 1, "draft"));
    const floors = videoStudioTowerFloors(all);
    expect(MAX_VS_FLOORS).toBe(5);
    expect(floors).toHaveLength(5);
    expect(floors.map((f) => f.slug)).toEqual(["video-8", "video-7", "video-6", "video-5", "video-4"]);
  });

  it("maps states to badges: working = running, done = done, failed = failed, the rest = idle", () => {
    for (const s of ["planning", "generating", "editing", "rendering"] as const) expect(vsBadge(s)).toBe("running");
    expect(vsBadge("done")).toBe("done");
    expect(vsBadge("failed")).toBe("failed");
    expect(vsBadge("draft")).toBe("idle");
    expect(vsBadge("ready")).toBe("idle");
    expect(vsBadge("something-new")).toBe("idle");
    const floors = videoStudioTowerFloors([item(1, "rendering"), item(2, "done"), item(3, "failed"), item(4, "ready")]);
    const by = Object.fromEntries(floors.map((f) => [f.slug, f]));
    expect(by["video-1"]).toMatchObject({ badge: "running", running: true });
    expect(by["video-2"]).toMatchObject({ badge: "done", running: false });
    expect(by["video-3"]).toMatchObject({ badge: "failed" });
    expect(by["video-4"]).toMatchObject({ badge: "idle" });
  });

  it("drops broken items and shortens long names", () => {
    const long: VsListItem = { ...item(1, "draft"), title: "x".repeat(60) };
    const broken = { ...item(2, "draft"), slug: "" } as VsListItem;
    const floors = videoStudioTowerFloors([long, broken]);
    expect(floors).toHaveLength(1);
    expect(floors[0]!.name.length).toBeLessThanOrEqual(34);
  });

  it("anyVsBusy and canAddVideoStudio", () => {
    expect(anyVsBusy([item(1, "done")])).toBe(false);
    expect(anyVsBusy([item(1, "done"), item(2, "generating")])).toBe(true);
    expect(canAddVideoStudio(4)).toBe(true);
    expect(canAddVideoStudio(5)).toBe(false);
  });
});

describe("CityScene video tower", () => {
  const base = { towers: ["TNF Tower", "Huấn luyện AI"] as [string, string], floors: [] };

  it("renders the Video Studio tower with its floors when videoStudioFloors is passed", () => {
    const floors = videoStudioTowerFloors([item(1, "rendering"), item(2, "done")]);
    const html = renderToStaticMarkup(createElement(CityScene, { ...base, videoStudioFloors: floors }));
    expect(html).toContain("videostudio-tower");
    expect(html).toContain("XƯỞNG VIDEO");
    expect(html).toContain("Video số 1");
    expect(html).toContain("Video số 2");
    expect(html).toContain("Video mới");
  });

  it("renders an empty tower (with the add button) for an empty list, and no tower when undefined", () => {
    const empty = renderToStaticMarkup(createElement(CityScene, { ...base, videoStudioFloors: [] }));
    expect(empty).toContain("videostudio-tower");
    const none = renderToStaticMarkup(createElement(CityScene, base));
    expect(none).not.toContain("videostudio-tower");
  });

  it("does not show the add button when 5 floors are full", () => {
    const floors = videoStudioTowerFloors(Array.from({ length: 5 }, (_, i) => item(i + 1, "draft")));
    const html = renderToStaticMarkup(createElement(CityScene, { ...base, videoStudioFloors: floors }));
    expect(html).not.toContain("Video mới");
  });

  it("the tower sits between the 3D tower (x 10-180) and the main tower (x 440-740)", () => {
    const src = readFileSync(new URL("../../ui/src/office/CityScene.tsx", import.meta.url), "utf8");
    const m = /const VS = \{ x: (\d+), w: (\d+)/.exec(src);
    expect(m).not.toBeNull();
    const x = Number(m![1]);
    const w = Number(m![2]);
    expect(x).toBeGreaterThan(180);
    expect(x + w).toBeLessThan(440);
  });
});

describe("popup ids and App wiring", () => {
  it("opens the video popups through the reducer", () => {
    const lobby = popupReducer(initialPopupState, { type: "open", id: "videostudio" });
    expect(lobby.open).toBe("videostudio");
    const room = popupReducer(initialPopupState, { type: "open", id: "videostudioFloor", payload: { slug: "video-1" } });
    expect(room).toEqual({ open: "videostudioFloor", payload: { slug: "video-1" } });
  });

  it("lists both ids in POPUP_IDS and keeps the other deep links working", () => {
    const src = readFileSync(new URL("../../ui/src/lib/popup.ts", import.meta.url), "utf8");
    const ids = /const POPUP_IDS[^=]*= \[([^\]]*)\]/.exec(src)![1]!;
    expect(ids).toContain('"videostudio"');
    expect(ids).toContain('"videostudioFloor"');
    expect(popupFromHash("#/history")?.open).toBe("history");
  });

  it("App uses the hook, passes the props to CityScene and opens both popups", () => {
    const src = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
    expect(src).toContain("useVideoStudioFloors");
    expect(src).toContain("videoStudioFloors={videoFloors}");
    expect(src).toContain('onOpen("videostudioFloor"');
    expect(src).toContain("<VideoStudioLobbyPopup");
    expect(src).toContain("<VideoStudioRoomPopup");
    expect(src).toContain("reloadVideoStudio");
  });
});
