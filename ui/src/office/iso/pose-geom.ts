// Pure pose geometry for IsoPerson (no React). Screen-space approximation: the lying body is a
// rotated 2D shape whose head points along the furniture axis projected on screen.
import { project } from './depth';

export type PoseName = 'stand' | 'sit' | 'sofa' | 'lie';
export type LieAxis = 'u' | 'v';

/** Half of the torso thickness (rx = 17): the body centre sits this high above the surface. */
export const LIE_LIFT = 17;

/**
 * Height (px) of a bench/sofa cushion top above the floor (gym rest bench: legs 11 + pad 5).
 * Callers that anchor the person at the floor add this for a seated-on-furniture pose. A lying person
 * is already lifted by LIE_LIFT inside IsoPerson (torso bottom = anchor), so the anchor must be the
 * surface height and is not lifted twice.
 */
export const SEAT_SURFACE_Z = 16;

export interface PoseGeometry {
  lift: number;
  rotate: number;
  legsOverTorso: boolean;
  shadow: boolean;
}

/** Normalise an angle in degrees to (-180, 180]. */
function norm(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * SVG rotation that turns the upright head vector (0,-1) onto the projected furniture axis times face.
 * rotate(r) maps (0,-1) to (sin r, -cos r), so r = 90 + atan2(dy, dx) in degrees.
 */
export function lieRotation(axis: LieAxis, face: 1 | -1): number {
  const a = project(0, 0);
  const b = axis === 'u' ? project(1, 0) : project(0, 1);
  const dx = (b.x - a.x) * face;
  const dy = (b.y - a.y) * face;
  const r = 90 + (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.round(norm(r) * 10) / 10;
}

export function poseGeometry(pose: PoseName, face: 1 | -1, axis: LieAxis = 'u'): PoseGeometry {
  switch (pose) {
    case 'lie':
      return { lift: LIE_LIFT, rotate: lieRotation(axis, face), legsOverTorso: false, shadow: false };
    case 'sit':
    case 'sofa':
      return { lift: 0, rotate: 0, legsOverTorso: true, shadow: true };
    default:
      return { lift: 0, rotate: 0, legsOverTorso: false, shadow: true };
  }
}
