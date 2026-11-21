/**
 * Current UI language for plain (non-React) helpers that build user-visible text.
 * App.tsx calls setCurLang on every render; helpers call pick(vi, en) at the moment they build the text.
 * Components should still prefer the i18n dictionary (useT); this exists for pure modules that have no `t`.
 */
export type CurLang = "vi" | "en";
let cur: CurLang = "vi";
export function setCurLang(l: CurLang): void {
  cur = l;
}
export function curLang(): CurLang {
  return cur;
}
export function pick(vi: string, en: string): string {
  return cur === "en" ? en : vi;
}
