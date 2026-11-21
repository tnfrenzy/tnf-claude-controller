// UI logic of the variants tab: selection / matrix, slot ids from names, request sheet slots, viewer adapter, i18n parity.
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";
import { buildWorkshop3DBrief, slotIdFromName, slotsFromRows } from "../../ui/src/office/workshop3d-session";
import { configViewerApi } from "../../ui/src/components/workshop3d/variants-api";
import { combos, comboCount, configsBusy, pickMasters, sizeText, syncSelection, type VConfig, type VOption } from "../../ui/src/components/workshop3d/variants-logic";

const opt = (id: string, slot: string, state: VOption["state"] = "ready"): VOption => ({ id, slot, kind: "material", name: id, command: "", state, created: "" });

describe("matrix logic", () => {
  it("counts and lists the product in slot order", () => {
    const sel = { handrail: ["h1", "h2", "h3"], floor: ["f1", "f2", "f3", "f4"], wall: [] };
    expect(comboCount(sel, ["handrail", "wall", "floor"])).toBe(12);
    const all = combos(sel, ["handrail", "wall", "floor"]);
    expect(all).toHaveLength(12);
    expect(all[0]).toEqual({ handrail: "h1", floor: "f1" });
    expect(comboCount({}, ["a"])).toBe(0);
    expect(combos({}, ["a"])).toEqual([]);
  });
  it("selects options that become ready once, keeps the user's unticking", () => {
    const first = syncSelection({}, [opt("a", "s"), opt("b", "s", "building")], new Set());
    expect(first.sel).toEqual({ s: ["a"] });
    const afterUntick = syncSelection({ s: [] }, [opt("a", "s"), opt("b", "s")], first.seen);
    expect(afterUntick.sel).toEqual({ s: ["b"] }); // a stays unticked, b is new
    expect(syncSelection({ s: ["a"] }, [], new Set(["a"])).sel).toEqual({});
  });
  it("masters are finished sessions, the current one first", () => {
    const l = [{ slug: "a", title: "A", state: "done" }, { slug: "b", title: "B", state: "modeling" }, { slug: "c", title: "C", state: "done" }];
    expect(pickMasters(l, "c").map((m) => m.slug)).toEqual(["c", "a"]);
    expect(configsBusy([{ state: "done" }, { state: "running" }] as VConfig[])).toBe(true);
    expect(sizeText({ w: 1100, d: 60.4, h: 80 })).toBe("1100 × 60 × 80 mm");
    expect(sizeText(null)).toBe("—");
  });
});

describe("slots in the request sheet", () => {
  it("derives ASCII ids from Vietnamese names, unique", () => {
    expect(slotIdFromName("Đá sàn")).toBe("da_san");
    expect(slotIdFromName("Tay vịn")).toBe("tay_vin");
    expect(slotIdFromName("???")).toBe("slot");
    expect(slotIdFromName("Tay vịn", new Set(["tay_vin"]))).toBe("tay_vin_2");
    expect(slotsFromRows([{ name: "Tay vịn", type: "part" }, { name: " ", type: "material" }, { name: "Tay vịn", type: "material" }])?.map((s) => s.id)).toEqual(["tay_vin", "tay_vin_2"]);
    expect(slotsFromRows(Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, type: "material" as const })))).toBeNull();
  });
  const sheet = { title: "Cabin", object: "cabin", rows: [], material: "", purpose: "", detail: "high" as const };
  it("puts slots into the brief, omits them when empty, refuses too many", () => {
    const r = buildWorkshop3DBrief({ ...sheet, slots: [{ name: "Tay vịn", type: "part" }, { name: "Đá sàn", type: "material" }] });
    expect("brief" in r && r.brief.slots).toEqual([{ id: "tay_vin", name: "Tay vịn", type: "part" }, { id: "da_san", name: "Đá sàn", type: "material" }]);
    const none = buildWorkshop3DBrief({ ...sheet, slots: [{ name: "", type: "material" }] });
    expect("brief" in none && none.brief.slots).toBeUndefined();
    expect(buildWorkshop3DBrief({ ...sheet, slots: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, type: "material" as const })) })).toEqual({ error: "slots" });
  });
});

describe("config viewer adapter", () => {
  it("serves only the config's model.glb", async () => {
    const cfg = { id: "c-1", name: "Tay vịn: Vàng" } as VConfig;
    const api = configViewerApi("s", cfg, { configGlb: async (s, id) => new Blob([`${s}/${id}`]) });
    expect((await api.detail()).files).toEqual(["outputs/model.glb"]);
    expect(await (await api.file("outputs/model.glb")).text()).toBe("s/c-1");
    await expect(api.file("renders/x.png")).rejects.toThrow();
    await expect(api.rebuild()).rejects.toThrow();
  });
});

describe("i18n parity", () => {
  it("vi and en have the same non-empty wv_ and w3i_slot keys", () => {
    const keys = (l: "vi" | "en") => Object.keys(dicts[l]).filter((k) => k.startsWith("wv_") || k.startsWith("w3i_slot") || k === "w3i_err_slots").sort();
    expect(keys("vi")).toEqual(keys("en"));
    expect(keys("vi").length).toBeGreaterThan(50);
    for (const l of ["vi", "en"] as const) for (const k of keys(l)) expect(((dicts[l] as Record<string, string>)[k] ?? "").trim().length, `${l}.${k}`).toBeGreaterThan(0);
  });
});
