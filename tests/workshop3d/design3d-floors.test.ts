import { describe, expect, it } from "vitest";
import {
  MAX_DESIGN3D_FLOORS,
  canAddDesign3DFloor,
  design3dBadge,
  design3dFloorsToFloors
} from "../../ui/src/office/design3d-floors.js";
import type { Design3DFloor } from "../../ui/src/types.js";

const mk = (o: Partial<Design3DFloor> & Record<string, unknown> = {}): Design3DFloor =>
  ({ runId: "r1", title: "Bracket", status: "done", fileCount: 3, primaryFormat: "step", ...o }) as Design3DFloor;

describe("design3d-floors", () => {
  it("caps at 5", () => {
    expect(MAX_DESIGN3D_FLOORS).toBe(5);
  });

  it("maps statuses to badges", () => {
    const st = ["queued", "running", "done", "error", "cancelled"] as const;
    const out = design3dFloorsToFloors(st.map((status, i) => mk({ runId: `r${i}`, status })));
    expect(out.map((f) => f.badge)).toEqual(["idle", "running", "done", "failed", "failed"]);
    expect(out.map((f) => f.running)).toEqual([false, true, false, false, false]);
    expect(design3dBadge("weird")).toBe("idle");
  });

  it("builds sub line", () => {
    expect(design3dFloorsToFloors([mk()])[0].sub).toBe("3 file · STEP");
    expect(design3dFloorsToFloors([mk({ fileCount: 1, primaryFormat: "stl" })])[0].sub).toBe("1 file · STL");
    expect(design3dFloorsToFloors([mk({ primaryFormat: "glb" })])[0].sub).toBe("3 file · GLB");
  });

  it("handles invalid fileCount and format", () => {
    expect(design3dFloorsToFloors([mk({ fileCount: NaN })])[0].sub).toBe("0 file · STEP");
    expect(design3dFloorsToFloors([mk({ fileCount: -2 })])[0].sub).toBe("0 file · STEP");
    expect(design3dFloorsToFloors([mk({ primaryFormat: undefined })])[0].sub).toBe("3 file");
    expect(design3dFloorsToFloors([mk({ primaryFormat: 5 as unknown as "stl" })])[0].sub).toBe("3 file");
  });

  it("truncates and falls back title", () => {
    const long = design3dFloorsToFloors([mk({ title: "a".repeat(40) })])[0].name;
    expect(long.length).toBe(34);
    expect(long.endsWith("…")).toBe(true);
    expect(design3dFloorsToFloors([mk({ title: "b".repeat(34) })])[0].name).toBe("b".repeat(34));
    expect(design3dFloorsToFloors([mk({ title: "  " })])[0].name).toBe("r1");
    expect(design3dFloorsToFloors([mk({ title: "" })])[0].name).toBe("r1");
  });

  it("keeps 5 of 7 in order", () => {
    const out = design3dFloorsToFloors(Array.from({ length: 7 }, (_, i) => mk({ runId: `r${i}` })));
    expect(out.map((f) => f.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  });

  it("drops broken items before capping", () => {
    const items = [mk({ runId: "a" }), null, mk({ runId: "" }), mk({ runId: "b" }), mk({ runId: "c" }), mk({ runId: "d" }), mk({ runId: "e" })] as unknown as Design3DFloor[];
    expect(items.length).toBe(7);
    expect(design3dFloorsToFloors(items).map((f) => f.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("canAddDesign3DFloor", () => {
    expect(canAddDesign3DFloor(0)).toBe(true);
    expect(canAddDesign3DFloor(4)).toBe(true);
    expect(canAddDesign3DFloor(5)).toBe(false);
    expect(canAddDesign3DFloor(6)).toBe(false);
  });
});
