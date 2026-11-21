import { afterEach, describe, expect, it, vi } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { PREF_OFFICE_ZOOM, loadOfficeZoom, saveOfficeZoom } from "../../ui/src/lib/prefs.js";
import { ZOOM_MAX } from "../../ui/src/office/zoom.js";

function stubStore(store: Record<string, string>): void {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
}

describe("office zoom prefs and labels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("zoom label keys exist in vi and en", () => {
    for (const lang of ["vi", "en"] as const) {
      for (const k of ["office_zoom_in", "office_zoom_out", "office_zoom_reset"] as const) {
        expect(dicts[lang][k].length).toBeGreaterThan(0);
      }
    }
    expect(dicts.vi.office_zoom_reset).toBe("Vừa khung");
  });

  it("returns null for missing or junk value", () => {
    const store: Record<string, string> = {};
    stubStore(store);
    expect(loadOfficeZoom()).toBeNull();
    store[PREF_OFFICE_ZOOM] = "abc";
    expect(loadOfficeZoom()).toBeNull();
  });

  it("clamps out-of-range value", () => {
    stubStore({ [PREF_OFFICE_ZOOM]: "999" });
    expect(loadOfficeZoom()).toBe(ZOOM_MAX);
  });

  it("saves through remember and reads back", () => {
    const store: Record<string, string> = {};
    stubStore(store);
    saveOfficeZoom(1.5);
    expect(store[PREF_OFFICE_ZOOM]).toBe("1.5");
    expect(loadOfficeZoom()).toBe(1.5);
  });
});
