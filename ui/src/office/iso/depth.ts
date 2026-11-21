// Isometric projection, depth ordering and minimal-move diff (ported from
// docs/design/single-screen.html 375-376, 407-424, 446-460). Pure: no DOM.

export const T = 44;
export const CU = 0.866;
export const CV = 0.5;
export const ORIGIN = { x: 450, y: 118 };

export interface ScreenPt { x: number; y: number }

/** Room coords (metres, z in px of height) to screen coords. */
export function project(u: number, v: number, z = 0): ScreenPt {
  return { x: ORIGIN.x + (u - v) * T * CU, y: ORIGIN.y + (u + v) * T * CV - z };
}

/**
 * Depth key is u + v (lock it: along an iso diagonal that sum is constant, so larger means
 * nearer to the viewer). Furniture uses (smallest u) + (largest v) = u + v + d of its footprint
 * (w is ignored); a seated person adds +0.02 so they draw after the chair base (-0.01) but the
 * chair back (+0.06) still draws over them; a person on the sofa (sitting or lying) uses the sofa's
 * key + 0.05 when it is known, otherwise their own position key + 0.02 (seated) / + 0.05 (lying);
 * a standing person adds 0.2. Changing the formula breaks the occlusion of people behind desks.
 */
export const depthKey = (u: number, v: number, bias = 0): number => u + v + bias;

export const CHAIR_BASE_BIAS = -0.01;
export const CHAIR_SEATED_BIAS = 0.02;
export const CHAIR_BACK_BIAS = 0.06;

/** Depth key of a furniture footprint: u (smallest) + v + d (largest v). */
export const furnitureDepth = (r: { u: number; v: number; d: number }): number => r.u + r.v + r.d;

/**
 * Depth key of a person: on the sofa (pose sofa or lie) with a known sofaKey = sofa key + 0.05,
 * lying without a key = position key + 0.05, seated (also sofa without key) = position key + 0.02,
 * standing = +0.2.
 */
export function personDepth(pose: string, pos: { u: number; v: number }, sofaKey?: number): number {
  if ((pose === "lie" || pose === "sofa") && sofaKey !== undefined) return sofaKey + 0.05;
  if (pose === "sofa") return depthKey(pos.u, pos.v, CHAIR_SEATED_BIAS);
  if (pose === "lie") return depthKey(pos.u, pos.v, 0.05);
  if (pose === "sit") return depthKey(pos.u, pos.v, CHAIR_SEATED_BIAS);
  return depthKey(pos.u, pos.v, 0.2);
}

/** Fallback bias (layout px) for a person on a sofa/bench when no sofa rect is known: covers half w + half h of the biggest sofa. */
export const SOFA_FALLBACK_BIAS = 90;

/** Depth bias (px key units, layout coords) added to a staff member's x + y: stand 0.2, sit 0.5 (just after the chair), sofa/lie large. */
export function staffDepthBias(pose: string): number {
  if (pose === "sofa" || pose === "lie") return SOFA_FALLBACK_BIAS;
  if (pose === "sit") return 0.5;
  return 0.2;
}

/**
 * Depth of a staff member in layout px. A person on a sofa locks to the sofa's nearest corner
 * (x + w + y + h, never below its centre key) + 0.5, so they draw after the sofa wherever they
 * sit along it; other poses use position + staffDepthBias.
 */
export function staffDepth(
  pose: string,
  pos: { x: number; y: number },
  sofas: readonly { x: number; y: number; w: number; h: number }[] = [],
): number {
  if (pose === "sofa" || pose === "lie") {
    const m = 12;
    const s = sofas.find((r) => pos.x >= r.x - m && pos.x <= r.x + r.w + m && pos.y >= r.y - m && pos.y <= r.y + r.h + m);
    if (s) return s.x + s.w + s.y + s.h + 0.5;
  }
  return pos.x + pos.y + staffDepthBias(pose);
}

export interface DrawItem { id: string; depth: number }

/** Stable ascending sort by depth (far first); ties broken by id so frames never flicker. */
export function sortedDrawList<I extends DrawItem>(items: readonly I[]): I[] {
  return [...items].sort((a, b) => (a.depth - b.depth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface Placement { x: number; y: number; depth: number }

export const EPS = 0.005;

/**
 * Ids whose placement must be written again. We only touch nodes that really changed:
 * moving a DOM node (re-inserting it) is expensive and restarts that node's CSS animations
 * (steam, beacon, monitor glow), so unchanged nodes are left where they are.
 * New ids count as changed; removed ids are not reported.
 */
export function diffPlacements(prev: ReadonlyMap<string, Placement>, next: ReadonlyMap<string, Placement>): string[] {
  const out: string[] = [];
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p || Math.abs(p.x - n.x) > EPS || Math.abs(p.y - n.y) > EPS || Math.abs(p.depth - n.depth) > EPS) out.push(id);
  }
  return out;
}
