import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialPopupState, isPopupId, popupReducer } from "../../ui/src/lib/popup.js";
import { ApiError } from "../../ui/src/api.js";
import { I18nContext, dicts } from "../../ui/src/i18n.js";
import { Design3DPanel, addKitToLibrary, fillDesign3DPrompt } from "../../ui/src/components/workshop3d/Design3DPanel.js";
import { Design3DFloorPanel, filter3DFiles } from "../../ui/src/components/workshop3d/Design3DFloorPanel.js";

const setLang = () => {};
const noop = () => {};
function wrap(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang } }, el),
  );
}
const art = (rel_path: string) => ({ run_id: "r1", rel_path, size: 1, mtime: 0 });

describe("popup ids", () => {
  it("opens design3d and design3dFloor with runId", () => {
    const a = popupReducer(initialPopupState, { type: "open", id: "design3d" });
    expect(a.open).toBe("design3d");
    const b = popupReducer(initialPopupState, { type: "open", id: "design3dFloor", payload: { runId: "r1" } });
    expect(b.open).toBe("design3dFloor");
    expect(b.payload?.runId).toBe("r1");
    expect(isPopupId("design3d")).toBe(true);
    expect(isPopupId("design3dFloor")).toBe(true);
    expect(isPopupId("nope")).toBe(false);
  });
});

describe("fillDesign3DPrompt", () => {
  const tpl = "W{{width}} D{{depth}} H{{height}} M{{material}} W{{width}}";
  it("fills all placeholders", () => {
    expect(fillDesign3DPrompt(tpl, { width: 1100, depth: "1400", height: 2300, material: " inox " }))
      .toBe("W1100 D1400 H2300 Minox W1100");
  });
  it("does not interpret $& in material", () => {
    expect(fillDesign3DPrompt("{{material}}", { width: 1, depth: 1, height: 1, material: "a$&b" })).toBe("a$&b");
  });
  it("clamps to 20000 and limits material to 40 chars", () => {
    expect(fillDesign3DPrompt("{{width}}", { width: 99999, depth: 1, height: 1, material: "" })).toBe("20000");
    expect(fillDesign3DPrompt("{{material}}", { width: 1, depth: 1, height: 1, material: "x".repeat(60) })).toBe("x".repeat(40));
  });
  it("returns null for NaN, empty, zero, negative", () => {
    const ok = { width: 1, depth: 1, height: 1, material: "" };
    expect(fillDesign3DPrompt(tpl, { ...ok, width: NaN })).toBeNull();
    expect(fillDesign3DPrompt(tpl, { ...ok, depth: "" })).toBeNull();
    expect(fillDesign3DPrompt(tpl, { ...ok, height: 0 })).toBeNull();
    expect(fillDesign3DPrompt(tpl, { ...ok, width: -5 })).toBeNull();
    expect(fillDesign3DPrompt(tpl, { ...ok, width: "abc" })).toBeNull();
  });
});

describe("addKitToLibrary", () => {
  it("skips roles already in the library", async () => {
    const calls: string[] = [];
    const n = await addKitToLibrary(["a", "b", "c"], ["b"], async (id) => { calls.push(id); });
    expect(calls).toEqual(["a", "c"]);
    expect(n).toBe(2);
  });
  it("ignores 409 without counting", async () => {
    const calls: string[] = [];
    const n = await addKitToLibrary(["a", "b"], [], async (id) => {
      calls.push(id);
      if (id === "a") throw new ApiError("exists", 409);
    });
    expect(calls).toEqual(["a", "b"]);
    expect(n).toBe(1);
  });
  it("throws and stops on other errors", async () => {
    const calls: string[] = [];
    await expect(addKitToLibrary(["a", "b", "c"], [], async (id) => {
      calls.push(id);
      if (id === "b") throw new ApiError("boom", 500);
    })).rejects.toThrow("boom");
    expect(calls).toEqual(["a", "b"]);
    await expect(addKitToLibrary(["a"], [], async () => { throw new Error("x"); })).rejects.toThrow("x");
  });
});

describe("Design3DPanel static render", () => {
  // The panel is now the 3D workshop request sheet (POST /api/workshop3d); the nine roles are built in, so the old
  // "add the 3D agent set to the Library" list and button are gone (addKitToLibrary stays exported and tested).
  it("shows the request sheet: two build modes, name, description, parameter rows, detail level and create button", () => {
    const h = wrap(createElement(Design3DPanel, {
      kit: { roles: ["cad-modeler"], templates: [{ id: "t1", label: "Mẫu một", prompt: "p {{width}}" }] } as never,
      onCreated: noop,
      onClose: noop,
    }));
    expect(h).not.toContain("data-role=");
    expect(h).not.toContain("Thêm bộ agent 3D vào Thư viện");
    expect(h).toContain("Tạo mẫu");
    expect(h).toContain("Tạo sản phẩm");
    expect(h).toContain("Dựng không gian");
    expect(h).not.toContain("Mẫu một");
    expect(h).not.toContain("Tự do (không dùng mẫu)");
    for (const s of ["Tên vật thể", "Mô tả (một câu)", "Bảng tham số", "Vật liệu", "Mục đích", "Mức chi tiết", "Rất cao"]) expect(h, s).toContain(s);
    expect(h).toContain('data-param-row="0"');
  });
});

describe("filter3DFiles", () => {
  it("keeps model files, drops others", () => {
    const out = filter3DFiles([art("a/b.step"), art("X.STL"), art("notes.md")]).map((a) => a.rel_path);
    expect(out).toEqual(["a/b.step", "X.STL"]);
  });
});

describe("Design3DFloorPanel static render", () => {
  it("shows basenames and buttons", () => {
    const h = wrap(createElement(Design3DFloorPanel, {
      runId: "r1", artifacts: [art("models/deep/car.glb"), art("notes.md")],
      onOpenRun: noop, onOpenFile: noop, onClose: noop,
    }));
    expect(h).toContain("car.glb");
    expect(h).not.toContain(">models/deep/car.glb<");
    expect(h).not.toContain("notes.md");
    expect(h).toContain("Mở run");
    expect(h).toContain("Mở tệp");
  });
  it("has a view button per file and no viewer/canvas when nothing selected", () => {
    const h = wrap(createElement(Design3DFloorPanel, {
      runId: "r1", artifacts: [art("a.stl"), art("b/c.glb")],
      onOpenRun: noop, onOpenFile: noop, onClose: noop,
    }));
    expect(h.match(/data-view="/g)?.length).toBe(2);
    expect(h).toContain(">Xem<");
    expect(h).not.toContain("<canvas");
    expect(h).not.toContain("Đang tải");
  });
  it("shows empty state", () => {
    const h = wrap(createElement(Design3DFloorPanel, {
      runId: "r1", artifacts: [art("notes.md")], onOpenRun: noop, onOpenFile: noop, onClose: noop,
    }));
    expect(h).toContain("Chưa có tệp mô hình");
    expect(h).not.toContain("Mở tệp");
  });
});

describe("d3p_ i18n keys", () => {
  it("same non-empty set in vi and en", () => {
    const keys = (d: Record<string, unknown>) => Object.keys(d).filter((k) => k.startsWith("d3p_")).sort();
    const vi = keys(dicts.vi as never);
    expect(vi.length).toBeGreaterThan(10);
    expect(keys(dicts.en as never)).toEqual(vi);
  });
});
