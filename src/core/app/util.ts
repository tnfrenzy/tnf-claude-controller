/** Small pure helpers shared across src/core (merged from identical per-module copies). */

/** Backslashes to forward slashes and no trailing slashes. */
export function slashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Lower-case, accent-free form (Vietnamese đ/Đ become d) for accent-insensitive matching. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
}

/** Plain JSON object (not null, not an array). */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
