import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nextConfirmStep } from "../../ui/src/lib/confirm.js";
import { dicts } from "../../ui/src/i18n.js";

describe("nextConfirmStep", () => {
  it("goes idle -> confirm -> execute and back to idle when done", () => {
    let s = nextConfirmStep("idle", "ask");
    expect(s).toBe("confirm");
    s = nextConfirmStep(s, "confirm");
    expect(s).toBe("execute");
    expect(nextConfirmStep(s, "done")).toBe("idle");
  });
  it("cancel returns to idle and confirm cannot skip the first step", () => {
    expect(nextConfirmStep("confirm", "cancel")).toBe("idle");
    expect(nextConfirmStep("idle", "confirm")).toBe("idle");
  });
});

describe("default floor is not deletable", () => {
  it("LeftPanel hides delete for the default project and i18n has the ground-floor label", () => {
    const src = readFileSync(new URL("../../ui/src/components/LeftPanel.tsx", import.meta.url), "utf8");
    expect(src).toContain('project.name !== "default" && step === "idle"');
    expect((dicts.vi as Record<string, string>).city_ground_floor).toBe("Tầng trệt");
    expect((dicts.en as Record<string, string>).city_ground_floor).toBeTruthy();
  });
});

describe("floor delete i18n keys", () => {
  for (const lang of ["vi", "en"] as const) {
    it(`${lang} has all floor_delete keys`, () => {
      const d = dicts[lang] as Record<string, string>;
      for (const k of ["floor_delete", "floor_delete_confirm1", "floor_delete_confirm2", "floor_delete_done"]) {
        expect(typeof d[k]).toBe("string");
        expect(d[k]!.length).toBeGreaterThan(0);
      }
    });
  }
});
