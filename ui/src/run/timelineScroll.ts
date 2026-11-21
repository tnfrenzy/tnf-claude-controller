export const NEAR_BOTTOM_PX = 40;

export function isNearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function liveLength(live: Record<string, string>): number {
  let n = 0;
  for (const k in live) n += live[k]?.length ?? 0;
  return n;
}
