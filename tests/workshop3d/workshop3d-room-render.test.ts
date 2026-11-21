import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Workshop3DEmpty, Workshop3DRoom } from "../../ui/src/components/workshop3d/Workshop3DRoom.js";
import { Workshop3DPopup } from "../../ui/src/components/workshop3d/Workshop3DPopup.js";
import { I18nContext, dicts } from "../../ui/src/i18n.js";
import { W3D_ROLE_IDS } from "../../ui/src/office/workshop3d.js";
import { mockWorkshop3DSession, W3D_DEMO_STATES } from "../../ui/src/office/workshop3d-mock.js";
import { pickWorkshop3DSlug } from "../../ui/src/office/useWorkshop3D.js";
import { isPopupId, popupFromHash } from "../../ui/src/lib/popup.js";

const wrap = (el: ReturnType<typeof createElement>, lang: "vi" | "en" = "vi") =>
  renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang, t: dicts[lang], setLang: () => {} } }, el));

describe("Workshop3DRoom", () => {
  it.each([...W3D_DEMO_STATES, "weird_state", ""])("state %s draws the room with all nine characters", (state) => {
    const h = wrap(createElement(Workshop3DRoom, { state, title: "Cabin 630 kg", round: 2, issues: 3 }));
    expect(h).toContain("iso-w3r");
    expect(h).not.toContain("NaN");
    expect(h).not.toContain("undefined");
    for (const id of W3D_ROLE_IDS) expect(h, id).toContain(`data-w3r-person="${id}"`);
    expect(h).toContain("Cabin 630 kg");
  });
  it("podium follows the stage: wireframe, solids, materials, final", () => {
    const stage = (state: string) => (wrap(createElement(Workshop3DRoom, { state, title: "x" })).match(/data-model="([a-z]+)"/) ?? [])[1];
    expect(stage("intake")).toBe("none");
    expect(stage("modeling")).toBe("wire");
    expect(stage("building")).toBe("solid");
    expect(stage("materials")).toBe("material");
    expect(stage("done")).toBe("final");
  });
  it("one issue pin per issue (max 8) and the count in the HUD", () => {
    const pins = (n: number) => (wrap(createElement(Workshop3DRoom, { state: "reviewing", title: "x", issues: n })).match(/data-issue-pin/g) ?? []).length;
    expect(pins(0)).toBe(0);
    expect(pins(3)).toBe(3);
    expect(pins(12)).toBe(8);
  });
  it("shows the questions while awaiting the user, the error when failed", () => {
    expect(wrap(createElement(Workshop3DRoom, { state: "awaiting_user", title: "x", questions: ["Kích thước?"] }))).toContain("Kích thước?");
    expect(wrap(createElement(Workshop3DRoom, { state: "failed", title: "x", error: "Hỏng GLB" }))).toContain("Hỏng GLB");
  });
  it("accessories of the new characters are drawn", () => {
    const h = wrap(createElement(Workshop3DRoom, { state: "modeling", title: "x" }));
    for (const k of ["acc-beret", "acc-ar", "acc-apron", "prop-camera", "prop-loupe", "prop-tablet", "prop-clipboard", "acc-headset"]) expect(h, k).toContain(k);
  });
  it("works in English", () => {
    const h = wrap(createElement(Workshop3DRoom, { state: "rendering", title: "x" }), "en");
    expect(h).toContain("Taking photos");
  });
  it("empty state is friendly, with the room and a hint", () => {
    const h = wrap(createElement(Workshop3DEmpty));
    expect(h).toContain("Chưa có phiên dựng 3D");
    expect(h).toContain("w3r-empty");
  });
});

describe("Workshop3DPopup", () => {
  // The viewer placeholder is replaced by the real "Bàn xem 3D" tab (tests/workshop3d-release-ui.test.ts).
  it("renders the demo popup with the state bar and the room (fake data, labelled as demo)", () => {
    const h = wrap(createElement(Workshop3DPopup, { demo: true, onClose: () => {} }));
    expect(h).toContain('data-demo-state="modeling"');
    expect(h).toContain("iso-w3r");
    expect(h).toContain("Chế độ thử (dữ liệu giả)");
    expect(h).not.toContain("Bàn xem 3D sẽ gắn ở đây");
  });
  it("a real session popup starts by loading the session (no fake data)", () => {
    const h = wrap(createElement(Workshop3DPopup, { slug: "20261110-120000-abcdef", onClose: () => {} }));
    expect(h).toContain("Đang tải phiên…");
    expect(h).not.toContain("data-demo-state");
  });
});

describe("popup id and hash", () => {
  it("workshop3d is a popup id and #/w3d-demo opens it in demo mode", () => {
    expect(isPopupId("workshop3d")).toBe(true);
    expect(popupFromHash("#/w3d-demo")).toEqual({ open: "workshop3d", payload: { demo: true } });
    expect(popupFromHash("#/office")).toBeNull();
  });
});

describe("session helpers", () => {
  it("picks the exact slug, else the most recently updated", () => {
    const list = [{ slug: "a", title: "A", state: "done", updatedAt: 1 }, { slug: "b", title: "B", state: "art", updatedAt: 9 }];
    expect(pickWorkshop3DSlug(list, "a")).toBe("a");
    expect(pickWorkshop3DSlug(list, "zzz")).toBe("b");
    expect(pickWorkshop3DSlug(list)).toBe("b");
    expect(pickWorkshop3DSlug([])).toBeNull();
  });
  it("mock sessions cover every state with the issue count", () => {
    const s = mockWorkshop3DSession("reviewing", 4);
    expect(s.snapshot.issues).toHaveLength(4);
    expect(mockWorkshop3DSession("failed").snapshot.error).toBeTruthy();
    expect(W3D_DEMO_STATES).toHaveLength(16);
  });
});

describe("app wiring and layout rules", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  it("a Design3DTower floor opens the workshop popup and the popup branch sits in the chain", () => {
    expect(app).toContain('onOpen("workshop3d"');
    expect(app).toContain('open === "workshop3d"');
    expect(app.indexOf('open === "workshop3d"')).toBeLessThan(app.lastIndexOf(": null"));
    expect(app).not.toMatch(/<div className="scene"/);
  });
  it("never uses sessionStorage", () => {
    for (const f of ["Workshop3DRoom.tsx", "Workshop3DPopup.tsx", "Workshop3DEquipment.tsx"]) expect(readFileSync(`ui/src/components/workshop3d/${f}`, "utf8")).not.toContain("sessionStorage");
  });
  it("css keeps the room readable on wide and narrow screens", () => {
    const css = readFileSync("ui/src/office/city.css", "utf8");
    expect(css).toContain(".w3r-room");
    expect(css).toMatch(/@media \(max-width: 480px\) \{ \.gym-room \.iso-gym/);
  });
});
