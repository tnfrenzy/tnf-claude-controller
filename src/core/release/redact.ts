const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[ẩn]"],
  [/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+@/g, "$1***@"],
  [/github_pat_[A-Za-z0-9_]{10,}/g, "[ẩn]"],
  [/gh[pousr]_[A-Za-z0-9]{10,}/g, "[ẩn]"],
  [/sk-[A-Za-z0-9_-]{10,}/g, "[ẩn]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [ẩn]"],
  [/((?:password|passwd|token|secret)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1[ẩn]"],
];

/**
 * Mask strings that look like tokens or passwords before anything is logged.
 * `extraValues` are literal values (e.g. declared SSH key paths) that must never appear; both slash styles are masked.
 */
export function redactSecrets(text: string, extraValues: string[] = []): string {
  let out = text;
  // Array.map passes the index as 2nd argument, so tolerate non-arrays.
  for (const v of Array.isArray(extraValues) ? extraValues : []) {
    if (!v || v.length < 3) continue;
    for (const variant of new Set([v, v.replace(/\\/g, "/"), v.replace(/\//g, "\\")])) {
      out = out.split(variant).join("[ẩn]");
    }
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
