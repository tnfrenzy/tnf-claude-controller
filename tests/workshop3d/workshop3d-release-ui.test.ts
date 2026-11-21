// UI wiring of the 3D workshop to the engine API: request sheet -> brief, tower floors from sessions, control strip,
// file list, i18n w3i_ parity, safe report rendering.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Workshop3DControls, Workshop3DFiles } from "../../ui/src/components/workshop3d/Workshop3DPopup.js";
import { I18nContext, dicts } from "../../ui/src/i18n.js";
import { workshop3dBadge, workshop3dTowerFloors, MAX_DESIGN3D_FLOORS } from "../../ui/src/office/design3d-floors.js";
import {
  buildWorkshop3DBrief, parseParamValue, sheetFromTemplate, w3dControls, w3dNeedsCadHint, w3dTerminal,
} from "../../ui/src/office/workshop3d-session.js";
import { CityScene } from "../../ui/src/office/CityScene.js";
import { popupFromHash } from "../../ui/src/lib/popup.js";
import { workshop3dFilePath, workshop3dPath } from "../../ui/src/api.js";
import type { Design3DFloor, Workshop3DSession } from "../../ui/src/types.js";

const wrap = (el: ReturnType<typeof createElement>, lang: "vi" | "en" = "vi") =>
  renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang, t: dicts[lang], setLang: () => {} } }, el));
const noop = () => {};
const session = (state: string, extra: Partial<Workshop3DSession["snapshot"]> = {}): Workshop3DSession => ({
  brief: { title: "Cabin" }, snapshot: { state, round: 1, costUsd: 0.123, questions: [], issues: [], note: null, error: null, ...extra }, files: [], renders: [], report: null,
});

describe("request sheet -> brief", () => {
  const base = { title: " Cabin 630 ", object: " cabin thang khách ", rows: [], material: "", purpose: "", detail: "high" as const };
  it("requires a name and a description", () => {
    expect(buildWorkshop3DBrief({ ...base, title: " " })).toEqual({ error: "title" });
    expect(buildWorkshop3DBrief({ ...base, object: "" })).toEqual({ error: "object" });
  });
  it("trims, drops empty rows, parses numbers, keeps text, omits empty material / purpose", () => {
    const r = buildWorkshop3DBrief({ ...base, rows: [{ key: "width_mm", value: "1100" }, { key: "", value: "" }, { key: "tay vịn", value: "mạ vàng" }, { key: "k", value: "1,5" }] });
    expect(r).toEqual({ brief: { title: "Cabin 630", object: "cabin thang khách", params: { width_mm: 1100, "tay vịn": "mạ vàng", k: 1.5 }, detail: "high", attachments: [] } });
  });
  it("a value without a name is an error; more than 50 names is an error", () => {
    expect(buildWorkshop3DBrief({ ...base, rows: [{ key: "", value: "3" }] })).toEqual({ error: "param_key" });
    const rows = Array.from({ length: 51 }, (_, i) => ({ key: `p${i}`, value: "1" }));
    expect(buildWorkshop3DBrief({ ...base, rows })).toEqual({ error: "too_many" });
  });
  it("material and purpose are sent when filled, cut to the server limits", () => {
    const r = buildWorkshop3DBrief({ ...base, material: "inox", purpose: "x".repeat(400), detail: "ultra" });
    expect("brief" in r && r.brief.material).toBe("inox");
    expect("brief" in r && r.brief.purpose?.length).toBe(300);
    expect("brief" in r && r.brief.detail).toBe("ultra");
  });
  it("parseParamValue keeps non-numbers as text", () => {
    expect(parseParamValue(" 2300 ")).toBe(2300);
    expect(parseParamValue("-4.5")).toBe(-4.5);
    expect(parseParamValue("1100x1400")).toBe("1100x1400");
  });
  it("an elevator template fills name, description (sizes filled in, $ not interpreted) and size rows", () => {
    const kit = JSON.parse(readFileSync("config/design3d-kit.json", "utf8")) as { templates: { id: string; label: string; prompt: string; formats: [] }[] };
    for (const tpl of kit.templates) {
      const s = sheetFromTemplate(tpl, "a$&b");
      expect(s.title).toBe(tpl.label);
      expect(s.object).not.toMatch(/\{\{/);
      expect(s.object).toContain("a$&b");
      expect(s.object.length).toBeLessThanOrEqual(400);
      expect(s.rows.map((r) => r.key)).toEqual(["width_mm", "depth_mm", "height_mm"]);
      expect("brief" in buildWorkshop3DBrief({ ...s, purpose: "", detail: "high" })).toBe(true);
    }
    expect(sheetFromTemplate(kit.templates.find((x) => x.id === "landing-door")!).rows[0]!.value).toBe("900");
  });
});

describe("session controls and polling", () => {
  it("pause while working or waiting for quota, resume from paused / stopped / failed, stop until done or stopped", () => {
    expect(w3dControls("modeling")).toEqual({ pause: true, resume: false, stop: true });
    expect(w3dControls("waiting_quota")).toEqual({ pause: true, resume: false, stop: true });
    expect(w3dControls("awaiting_user")).toEqual({ pause: false, resume: false, stop: true });
    expect(w3dControls("paused")).toEqual({ pause: false, resume: true, stop: true });
    expect(w3dControls("failed")).toEqual({ pause: false, resume: true, stop: true });
    expect(w3dControls("stopped")).toEqual({ pause: false, resume: true, stop: false });
    expect(w3dControls("done")).toEqual({ pause: false, resume: false, stop: false });
  });
  it("polling stops only in done / failed / stopped", () => {
    for (const s of ["done", "failed", "stopped"]) expect(w3dTerminal(s)).toBe(true);
    for (const s of ["paused", "awaiting_user", "waiting_quota", "rendering"]) expect(w3dTerminal(s)).toBe(false);
  });
  it("CAD python errors get the install hint", () => {
    expect(w3dNeedsCadHint("Chưa có Python cho công cụ CAD. Cài Python 3.12...")).toBe(true);
    expect(w3dNeedsCadHint("No module named 'trimesh'")).toBe(true);
    expect(w3dNeedsCadHint("Hết hạn mức")).toBe(false);
    expect(w3dNeedsCadHint(null)).toBe(false);
  });
});

describe("Workshop3DControls render", () => {
  it("working: state, cost labelled as an estimate, pause and stop", () => {
    const h = wrap(createElement(Workshop3DControls, { slug: "s", session: session("modeling"), onChanged: noop }));
    expect(h).toContain("Đang dựng hình");
    expect(h).toContain("Chi phí ước tính $0.12");
    expect(h).toContain("không phải hóa đơn");
    expect(h).toContain('data-w3i-action="pause"');
    expect(h).toContain('data-w3i-action="stop"');
    expect(h).not.toContain('data-w3i-action="resume"');
  });
  it("failed with a CAD python error: banner, install hint with the venv path, resume", () => {
    const h = wrap(createElement(Workshop3DControls, { slug: "s", session: session("failed", { error: "Script không dựng được sau 4 lần sửa: Chưa có Python cho công cụ CAD." }), onChanged: noop }));
    expect(h).toContain('role="alert"');
    expect(h).toContain("Chưa có Python cho công cụ CAD");
    expect(h).toContain("D:\\tnf-cad-tools\\cad-venv");
    expect(h).toContain('data-w3i-action="resume"');
  });
  it("awaiting_user: the questions and an answer box", () => {
    const h = wrap(createElement(Workshop3DControls, { slug: "s", session: session("awaiting_user", { questions: ["Kích thước?", "Vật liệu?"] }), onChanged: noop }));
    expect(h).toContain("Kích thước?");
    expect(h).toContain("<textarea");
    expect(h).toContain('data-w3i-action="answer"');
  });
  it("model text (questions, error, note) is escaped, never HTML", () => {
    const h = wrap(createElement(Workshop3DControls, { slug: "s", session: session("awaiting_user", { questions: ["<img src=x onerror=alert(1)>"], note: "<script>x</script>" }), onChanged: noop }));
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;img");
  });
  it("waiting for quota shows when it resumes; English works", () => {
    const h = wrap(createElement(Workshop3DControls, { slug: "s", session: session("waiting_quota", { waitUntil: Date.UTC(2026, 10, 10, 12) }), onChanged: noop }), "en");
    expect(h).toContain("resumes by itself at");
  });
});

describe("Workshop3DFiles", () => {
  it("lists outputs and renders with a download button each, or an empty note", () => {
    const h = wrap(createElement(Workshop3DFiles, { slug: "s", files: ["outputs/model.glb", "outputs/model.usdz"], renders: ["renders/mat_truoc.png"] }));
    for (const f of ["outputs/model.glb", "outputs/model.usdz", "renders/mat_truoc.png"]) expect(h).toContain(`data-w3i-file="${f}"`);
    expect((h.match(/Tải về/g) ?? []).length).toBe(3);
    expect(wrap(createElement(Workshop3DFiles, { slug: "s", files: [], renders: [] }))).toContain("Chưa có tệp xuất.");
  });
  it("file URLs carry no token (the token rides in the header)", () => {
    expect(workshop3dPath("a b")).toBe("/api/workshop3d/a%20b");
    expect(workshop3dFilePath("s", "outputs/model.glb")).toBe("/api/workshop3d/s/file?path=outputs%2Fmodel.glb");
    expect(workshop3dFilePath("s", "x")).not.toContain("token");
  });
});

describe("3D tower floors from workshop sessions", () => {
  it("maps states to badges and waiting sub-labels", () => {
    expect(workshop3dBadge("rendering")).toEqual({ badge: "running", wait: null });
    expect(workshop3dBadge("done")).toEqual({ badge: "done", wait: null });
    expect(workshop3dBadge("failed")).toEqual({ badge: "failed", wait: null });
    expect(workshop3dBadge("stopped")).toEqual({ badge: "failed", wait: "w3i_floor_stopped" });
    expect(workshop3dBadge("awaiting_user")).toEqual({ badge: "idle", wait: "w3i_floor_wait_answer" });
    expect(workshop3dBadge("paused")).toEqual({ badge: "idle", wait: "w3i_floor_paused" });
    expect(workshop3dBadge("waiting_quota")).toEqual({ badge: "idle", wait: "w3i_floor_quota" });
    expect(workshop3dBadge("weird")).toEqual({ badge: "idle", wait: null });
  });
  it("sessions first, then old run floors, capped; broken sessions dropped", () => {
    const runs = [1, 2, 3].map((i) => ({ runId: `r${i}`, title: `Run ${i}`, status: "done", fileCount: 1, primaryFormat: "glb" }) as Design3DFloor);
    const sessions = [{ slug: "s1", title: "Cabin", state: "modeling", costUsd: 0.5 }, { slug: "", title: "x", state: "done" }, { slug: "s2", title: "", state: "awaiting_user" }];
    const f = workshop3dTowerFloors(sessions, runs);
    expect(f.map((x) => `${x.kind}:${x.id}`)).toEqual(["session:s1", "session:s2", "run:r1", "run:r2", "run:r3"]);
    expect(f).toHaveLength(MAX_DESIGN3D_FLOORS);
    expect(f[0]).toMatchObject({ badge: "running", running: true, sub: "~$0.50" });
    expect(f[1]).toMatchObject({ name: "s2", badge: "idle", wait: "w3i_floor_wait_answer", sub: "" });
  });
  it("CityScene draws session floors with their sub-labels", () => {
    const h = wrap(createElement(CityScene, {
      towers: ["TNF Tower", "Tower 2"], floors: [{ id: "default", name: "default", running: false }], design3dFloors: [],
      design3dSessions: [{ slug: "s1", title: "Cabin khách", state: "awaiting_user" }, { slug: "s2", title: "Cửa tầng", state: "rendering" }],
    }));
    expect(h).toContain('data-floor-kind="session"');
    expect(h).toContain("Cabin khách");
    expect(h).toContain("đang chờ trả lời");
    expect(h).toContain("Đang dựng");
  });
  it("#/w3d/<slug> opens the room of that session", () => {
    expect(popupFromHash("#/w3d/20261110-120000-abcdef")).toEqual({ open: "workshop3d", payload: { slug: "20261110-120000-abcdef" } });
  });
});

describe("w3i_ i18n keys", () => {
  const keys = (lang: "vi" | "en") => Object.keys(dicts[lang]).filter((k) => k.startsWith("w3i_")).sort();
  it("vi and en have exactly the same non-empty keys", () => {
    expect(keys("vi")).toEqual(keys("en"));
    expect(keys("vi").length).toBeGreaterThan(40);
    for (const lang of ["vi", "en"] as const) for (const k of keys(lang)) expect(((dicts[lang] as Record<string, string>)[k] ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("every error / floor / detail key the code builds exists", () => {
    for (const k of ["title", "object", "param_key", "too_many"]) expect(dicts.vi[`w3i_err_${k}` as keyof typeof dicts.vi]).toBeTruthy();
    for (const k of ["standard", "high", "ultra"]) expect(dicts.en[`w3i_detail_${k}` as keyof typeof dicts.en]).toBeTruthy();
    for (const k of ["wait_answer", "paused", "quota", "stopped"]) expect(dicts.vi[`w3i_floor_${k}` as keyof typeof dicts.vi]).toBeTruthy();
  });
  it("the old viewer placeholder text is gone", () => {
    expect(Object.keys(dicts.vi)).not.toContain("w3r_viewer_slot");
  });
});

describe("report rendering is sanitised", () => {
  const md = readFileSync("ui/src/components/common/Markdown.tsx", "utf8");
  const popup = readFileSync("ui/src/components/workshop3d/Workshop3DPopup.tsx", "utf8");
  it("REPORT.md goes through Markdown (marked + DOMPurify), the popup has no raw HTML injection", () => {
    expect(popup).toContain("<Markdown source={report} />");
    expect(popup).not.toContain("dangerouslySetInnerHTML");
    expect(md).toContain("DOMPurify.sanitize(");
    for (const tag of ["script", "iframe", "object", "embed", "form", "img"]) expect(md).toContain(`"${tag}"`);
  });
  it("a rebuild from the viewer wakes the popup polling (stopped in done)", () => {
    expect(popup).toContain("<Workshop3DViewer slug={slug} onRebuilt={reload} />");
    expect(readFileSync("ui/src/components/workshop3d/Workshop3DViewer.tsx", "utf8")).toContain("onRebuilt?.();");
  });
  it("the demo room only exists in a dev build", () => {
    expect(readFileSync("ui/src/lib/popup.ts", "utf8")).toContain('head === "w3d-demo" && import.meta.env.DEV');
  });
});
