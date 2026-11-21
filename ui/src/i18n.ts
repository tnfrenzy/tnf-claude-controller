import { createContext, useContext } from "react";
import { vi, type Dict } from "./i18n/vi";
import { en } from "./i18n/en";

export type Lang = "vi" | "en";
export type { Dict };

export const dicts: Record<Lang, Dict> = { vi, en };

export const I18nContext = createContext<{ lang: Lang; t: Dict; setLang: (l: Lang) => void }>({ lang: "vi", t: vi, setLang: () => {} });
export const useT = () => useContext(I18nContext);

export function statusLabel(t: Dict, s: string): string {
  const key = `status_${s}` as keyof Dict;
  return t[key] ?? s;
}

/** Display name of a role id; unknown roles return the id itself. Pure, no React. */
export function roleLabel(roleId: string, lang: Lang): string {
  const key = `role_${roleId}`;
  const d = dicts[lang] as Record<string, string>;
  return Object.hasOwn(d, key) && typeof d[key] === "string" && d[key] ? d[key] : roleId;
}
