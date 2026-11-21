import { describe, expect, it } from "vitest";
import { project } from "../../ui/src/office/iso/depth.js";
import { LIE_LIFT, lieRotation, poseGeometry } from "../../ui/src/office/iso/pose-geom.js";

const AXES = ["u", "v"] as const;
const FACES = [1, -1] as const;

describe("lieRotation", () => {
  it("matches the projected axes", () => {
    expect(Math.abs(lieRotation("u", 1) - 120)).toBeLessThan(0.5);
    expect(Math.abs(lieRotation("u", -1) - -60)).toBeLessThan(0.5);
    expect(Math.abs(lieRotation("v", 1) - -120)).toBeLessThan(0.5);
    expect(Math.abs(lieRotation("v", -1) - 60)).toBeLessThan(0.5);
  });
  it("head vector follows the axis times face", () => {
    for (const axis of AXES) for (const face of FACES) {
      const r = (lieRotation(axis, face) * Math.PI) / 180;
      const head = [Math.sin(r), -Math.cos(r)];
      const a = project(0, 0);
      const b = axis === "u" ? project(1, 0) : project(0, 1);
      const vx = (b.x - a.x) * face, vy = (b.y - a.y) * face;
      const len = Math.hypot(vx, vy);
      const cos = (head[0]! * vx + head[1]! * vy) / len;
      expect(cos).toBeGreaterThan(0.999);
    }
  });
  it("is not the old 118 constant", () => {
    expect(Math.abs(lieRotation("u", 1) - 118)).toBeGreaterThanOrEqual(1);
  });
});

describe("poseGeometry", () => {
  it("legsOverTorso only for sit and sofa", () => {
    expect(poseGeometry("sit", 1).legsOverTorso).toBe(true);
    expect(poseGeometry("sofa", 1).legsOverTorso).toBe(true);
    expect(poseGeometry("stand", 1).legsOverTorso).toBe(false);
    expect(poseGeometry("lie", 1).legsOverTorso).toBe(false);
  });
  it("shadow is off only for lie", () => {
    expect(poseGeometry("lie", 1).shadow).toBe(false);
    expect(poseGeometry("stand", 1).shadow).toBe(true);
  });
  it("lie lifts and rotates, others do not", () => {
    const l = poseGeometry("lie", 1);
    expect(l.lift).toBe(LIE_LIFT);
    expect(l.rotate).toBe(lieRotation("u", 1));
    for (const p of ["stand", "sit", "sofa"] as const) {
      expect(poseGeometry(p, 1)).toMatchObject({ lift: 0, rotate: 0 });
    }
  });
  it("returns all four keys for every pose", () => {
    for (const p of ["stand", "sit", "sofa", "lie"] as const) {
      expect(Object.keys(poseGeometry(p, -1)).sort()).toEqual(["legsOverTorso", "lift", "rotate", "shadow"]);
    }
  });
});
