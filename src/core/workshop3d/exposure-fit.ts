// src/core/workshop3d/exposure-fit.ts — automatic exposure compensation of Blender images against the user's reference
// photos (pure logic; the numbers come from color-delta.json written by tools/workshop3d/w3d_palette.py).
// A mirror-heavy cabin renders darker than the photo (measured: whole-image dL* -32 / -37 at the default exposure 0.6).
// The fit turns the whole-image dL* of a view into an exposure change in stops, with a damping factor, a per-pass limit and
// a TOTAL cap so an image is never burnt. Without a delta (no reference image) nothing changes.

/** Whole-image dL* (render - reference) under which / over which a view is worth rendering again. */
export const FIT_DARK_DL = -8;
export const FIT_BRIGHT_DL = 12;
/** Total boost over cfg.exposure, in stops (renders are never pushed past this, never pulled below the floor). */
export const FIT_MAX_BOOST = 2.2;
export const FIT_MIN_BOOST = -1;
/** One pass changes the exposure by at most this many stops. */
export const FIT_MAX_STEP = 1.2;
/** Share of the linear estimate applied: AgX gives about 11 L* per stop, so the estimate is already conservative. */
export const FIT_DAMPING = 1.0;
/** No brightening when this share of the image is already near white (mirrors / lamps would burn). */
export const FIT_MAX_CLIP = 0.08;
/** Passes after the first render (each renders only the views still off). */
export const FIT_MAX_PASSES = 2;

export interface FitView { view: string; dL: number; clip?: number }

const lstarToY = (l: number): number => (l > 8 ? Math.pow((l + 16) / 116, 3) : l / 903.3);

/** Stops to add for a view whose whole-image dL* is `dL` and whose render L* is `renderL` (or null = assume mid-grey 50). */
export function stopsForDelta(dL: number, renderL: number | null = null): number {
  const l = renderL ?? 50;
  const target = Math.min(98, Math.max(2, l - dL));
  const ratio = lstarToY(target) / Math.max(1e-4, lstarToY(Math.min(98, Math.max(2, l))));
  return Math.log2(ratio);
}

export const roundStops = (v: number): number => Math.round(v * 100) / 100;

/**
 * New boost (stops over cfg.exposure) per view that should be rendered again. `current` = the boost each view was rendered
 * with. A view is skipped when its dL is inside the band, when brightening would burn an already clipped image, or when
 * it is already at the cap in the needed direction. Never returns a boost outside [FIT_MIN_BOOST, FIT_MAX_BOOST].
 */
export function planExposureBoosts(views: readonly FitView[], current: Readonly<Record<string, number>> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of views) {
    if (!Number.isFinite(v.dL)) continue;
    const prev = current[v.view] ?? 0;
    let step = 0;
    if (v.dL <= FIT_DARK_DL) {
      if ((v.clip ?? 0) > FIT_MAX_CLIP) continue;
      step = stopsForDelta(v.dL);
    } else if (v.dL >= FIT_BRIGHT_DL) {
      step = stopsForDelta(v.dL);
    } else continue;
    step = Math.max(-FIT_MAX_STEP, Math.min(FIT_MAX_STEP, step * FIT_DAMPING));
    const next = roundStops(Math.max(FIT_MIN_BOOST, Math.min(FIT_MAX_BOOST, prev + step)));
    if (Math.abs(next - prev) < 0.1) continue;
    out[v.view] = next;
  }
  return out;
}

type DeltaFile = { views?: { view?: unknown; regions?: Record<string, { dL?: unknown; clip?: unknown }> }[] } | null;

/** Whole-image dL* of every view of a color-delta.json (mode hq); unusable rows are dropped. */
export function fitViewsFromDelta(delta: unknown): FitView[] {
  const views = (delta as DeltaFile)?.views;
  if (!Array.isArray(views)) return [];
  const out: FitView[] = [];
  for (const v of views) {
    const r = v?.regions?.["toan_anh"];
    if (typeof v?.view !== "string" || typeof r?.dL !== "number" || !Number.isFinite(r.dL)) continue;
    out.push({ view: v.view, dL: r.dL, ...(typeof r.clip === "number" && Number.isFinite(r.clip) ? { clip: r.clip } : {}) });
  }
  return out;
}
