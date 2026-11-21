import { describe, expect, it } from "vitest";
import { formatClock, hasNarration, readCostUsd, readLastRender, stateIsBusy } from "../../ui/src/components/videostudio/studio-room-logic.js";
import type { VsPlan, VsProject, VsProjectDetail, VsState } from "../../src/core/videostudio/plan-types.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nContext, dicts } from "../../ui/src/i18n.js";
import { VideoStudioRoomBody } from "../../ui/src/components/videostudio/VideoStudioRoomBody.js";

const noop = () => {};
function renderBody(detail: VsProjectDetail, busy = false): string {
  const el = createElement(VideoStudioRoomBody, {
    detail, styles: [], time: 0, playing: false, busy, uploading: false,
    onUpload: noop, onPlayToggle: noop, onTime: noop, onEnded: noop, onSeek: noop, onPlanChange: noop,
    onEditSegment: noop, onGeneratePlan: noop, onNarrate: noop, onRender: noop, onDownload: noop, onDelete: noop,
  });
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, el));
}
const mkPlan = (narration?: string): VsPlan => ({
  version: 1, width: 1920, height: 1080, fps: 30,
  video: [{ id: "c1", kind: "card", srcIn: 0, duration: 5, color: "#123456", cardText: "Xin chao" }],
  audio: [], texts: [], narration,
});
const mkDetail = (extra: Record<string, unknown> = {}, narration?: string, state: VsState = "ready"): VsProjectDetail => ({
  project: { slug: "p", title: "Du an mot", brief: "", styleId: "s", aspect: "16:9", state, createdAt: "", updatedAt: "", ...extra } as VsProject,
  plan: mkPlan(narration),
  assets: [{ rel: "assets/clip-one.mp4", kind: "video", size: 1 }],
});

describe("VideoStudioRoomBody", () => {
  it("shows title, state and timeline", () => {
    const html = renderBody(mkDetail());
    expect(html).toContain("Du an mot");
    expect(html).toContain(dicts.vi.vs_state_ready);
    expect(html).toContain(dicts.vi.vs_tl_add_media);
    expect(html).toContain("Xin chao");
    expect(html).toContain("0:00/0:05");
  });
  it("download button only with lastRender", () => {
    expect(renderBody(mkDetail())).not.toContain(dicts.vi.vs_btn_download);
    expect(renderBody(mkDetail({ lastRender: "out.mp4" }))).toContain(dicts.vi.vs_btn_download);
  });
  it("disables action buttons when busy", () => {
    const html = renderBody(mkDetail({ lastRender: "out.mp4" }, "abc", "rendering"));
    const gen = html.slice(html.lastIndexOf("vs-room-actions"));
    expect(gen.match(/<button/g)?.length).toBe(5);
    expect(gen.match(/<button[^>]*disabled/g)?.length).toBe(5);
  });
  it("narrate hidden without narration, shown with it", () => {
    expect(renderBody(mkDetail({}, ""))).not.toContain(dicts.vi.vs_btn_narrate);
    expect(renderBody(mkDetail({}, "abc"))).toContain(dicts.vi.vs_btn_narrate);
  });
});

describe("VideoStudioPopup", () => {
  it("exports a component", async () => {
    const m = await import("../../ui/src/components/videostudio/VideoStudioPopup.js");
    expect(typeof m.VideoStudioPopup).toBe("function");
  });
});

const project: VsProject = {
  slug: "p", title: "P", brief: "", styleId: "s", aspect: "16:9", state: "draft", createdAt: "", updatedAt: "",
};

describe("studio room logic", () => {
  it("stateIsBusy covers all 8 states", () => {
    const busy: VsState[] = ["planning", "generating", "editing", "rendering"];
    const idle: VsState[] = ["draft", "ready", "done", "failed"];
    for (const s of busy) expect(stateIsBusy(s)).toBe(true);
    for (const s of idle) expect(stateIsBusy(s)).toBe(false);
  });
  it("readLastRender / readCostUsd", () => {
    expect(readLastRender(project)).toBeNull();
    expect(readCostUsd(project)).toBeNull();
    expect(readLastRender({ ...project, lastRender: "out.mp4" } as VsProject)).toBe("out.mp4");
    expect(readCostUsd({ ...project, costUsd: 0.5 } as VsProject)).toBe(0.5);
  });
  it("hasNarration", () => {
    const base = { version: 1, width: 1, height: 1, fps: 1, video: [], audio: [], texts: [] } as VsPlan;
    expect(hasNarration(undefined)).toBe(false);
    expect(hasNarration(null)).toBe(false);
    expect(hasNarration({ ...base, narration: "" })).toBe(false);
    expect(hasNarration({ ...base, narration: "  " })).toBe(false);
    expect(hasNarration({ ...base, narration: "abc" })).toBe(true);
  });
  it("formatClock", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(0)).toBe("0:00");
  });
});
