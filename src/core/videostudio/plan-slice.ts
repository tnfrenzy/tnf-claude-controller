// src/core/videostudio/plan-slice.ts
// A copy of a plan that holds only the part between two times, for the quick range preview. Pure.

import type { VsAudioClip, VsPlan, VsTextItem, VsVideoClip } from "./plan-types.js";

export function sliceDuration(plan: VsPlan): number {
  return plan.video.reduce((s, c) => s + c.duration, 0);
}

/** The part of `plan` between `start` and `end` seconds (clamped to the plan); null when nothing is left. */
export function slicePlan(plan: VsPlan, start: number, end: number): VsPlan | null {
  const total = sliceDuration(plan);
  const a = Math.max(0, Math.min(start, total));
  const b = Math.max(0, Math.min(end, total));
  if (!(b - a >= 0.2)) return null;
  const video: VsVideoClip[] = [];
  let cs = 0;
  plan.video.forEach((c, i) => {
    const ce = cs + c.duration;
    const ps = Math.max(cs, a);
    const pe = Math.min(ce, b);
    if (pe - ps >= 0.05) {
      const sp = c.kind === "video" && typeof c.speed === "number" && c.speed > 0 ? c.speed : 1;
      const piece: VsVideoClip = { ...c, id: `${c.id}-r${i}`, duration: pe - ps };
      if (c.kind === "video") piece.srcIn = (c.srcIn || 0) + (ps - cs) * sp;
      video.push(piece);
    }
    cs = ce;
  });
  if (video.length === 0) return null;
  const texts: VsTextItem[] = [];
  for (const t of plan.texts ?? []) {
    const ts = Math.max(t.start, a);
    const te = Math.min(t.start + t.duration, b);
    if (te - ts >= 0.05) texts.push({ ...t, start: ts - a, duration: te - ts });
  }
  const audio: VsAudioClip[] = [];
  for (const au of plan.audio ?? []) {
    const ps = Math.max(au.start, a);
    const pe = Math.min(au.start + au.duration, b);
    if (pe - ps < 0.05) continue;
    const piece: VsAudioClip = { ...au, start: ps - a, duration: pe - ps, srcIn: (au.srcIn ?? 0) + (ps - au.start) * (au.speed ?? 1) };
    if (ps > au.start) delete piece.fadeIn;
    if (pe < au.start + au.duration) delete piece.fadeOut;
    audio.push(piece);
  }
  return { ...plan, video, texts, audio };
}
