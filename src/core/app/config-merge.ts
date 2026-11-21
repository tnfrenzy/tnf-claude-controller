/**
 * Pure merge of new default keys into an existing (user) controller config.
 *
 * Rules:
 * - Returns a new deep-cloned object; neither input is mutated.
 * - Recurses into plain objects. Keys present in `defaults` but missing in `existing` are added;
 *   keys already in `existing` keep the user's value untouched (arrays, strings, numbers, null, false).
 * - Protected keys are matched BY NAME AT EVERY LEVEL (so `defaults.coding.*`, `defaults.research.*`
 *   and the top-level aliases are all covered): allowedTools, disallowedTools, permissions, deny,
 *   extraArgs, settingsFile. The existing value is kept verbatim (never merged element-wise, so no
 *   permission or deny entry is added, removed or weakened). When missing in `existing` they are NOT
 *   taken from `defaults`; they stay absent.
 * - `server.allowedOrigins` is also protected: kept as-is when present; when missing it becomes `[]`
 *   (the strict default), never read from `defaults`.
 * - Keys named token / apiKey / secret (case-insensitive, `_` and `-` ignored) are dropped at every
 *   level from the result, so no secret is ever written to the config.
 * - The top-level `models` list (ids offered in the UI) is the one array that follows the release: default entries whose
 *   id is missing are appended, and an entry of a RETIRED id (RETIRED_MODEL_IDS) is replaced by the default list's entries.
 *   Other user entries and their order are kept.
 * - `__proto__`, `constructor` and `prototype` are skipped (prototype pollution guard).
 * - `$comment` and `$allowedOrigins_hint` from defaults are not merged; those in `existing` are kept.
 *
 * Input contract: `existing` must be a plain object, otherwise an Error (Vietnamese) is thrown;
 * a non-object `defaults` is treated as `{}`.
 */

type Json = Record<string, unknown>;

const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
const DEFAULT_ONLY_SKIP = new Set(["$comment", "$allowedOrigins_hint"]);
/** Model ids dropped from the list when a release no longer offers them (Fable 5.1 became Fable 5.2). */
const RETIRED_MODEL_IDS = new Set(["claude-fable-5-1"]);
const PROTECTED = new Set(["allowedTools", "disallowedTools", "permissions", "deny", "extraArgs", "settingsFile"]);

function isPlain(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSensitive(key: string): boolean {
  return /token|apikey|secret/.test(key.toLowerCase().replace(/[_-]/g, ""));
}

function banned(key: string): boolean {
  return DANGEROUS.has(key) || isSensitive(key);
}

function clone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) {
    const out: Json = {};
    for (const k of Object.keys(v)) {
      if (banned(k)) continue;
      out[k] = clone(v[k]);
    }
    return out;
  }
  return v;
}

function mergeModels(existing: unknown, defaults: unknown): unknown {
  if (!Array.isArray(existing) || !Array.isArray(defaults)) return existing;
  const idOf = (m: unknown): string | null => (isPlain(m) && typeof m["id"] === "string" ? (m["id"] as string) : null);
  const out = existing.filter((m) => !RETIRED_MODEL_IDS.has(idOf(m) ?? "")).map(clone);
  const have = new Set(out.map(idOf));
  for (const d of defaults) {
    const id = idOf(d);
    if (id && !have.has(id)) out.push(clone(d));
  }
  return out;
}

function merge(existing: Json, defaults: Json, path: string[]): Json {
  const out: Json = {};
  for (const k of Object.keys(existing)) {
    if (banned(k)) continue;
    const ev = existing[k];
    const dv = Object.prototype.hasOwnProperty.call(defaults, k) ? defaults[k] : undefined;
    const isProtected = PROTECTED.has(k) || (k === "allowedOrigins" && path.join(".") === "server");
    if (k === "models" && path.length === 0) out[k] = mergeModels(ev, dv);
    else if (!isProtected && isPlain(ev) && isPlain(dv)) out[k] = merge(ev, dv, [...path, k]);
    else out[k] = clone(ev);
  }
  for (const k of Object.keys(defaults)) {
    if (banned(k) || DEFAULT_ONLY_SKIP.has(k) || PROTECTED.has(k) || k === "allowedOrigins") continue;
    if (Object.prototype.hasOwnProperty.call(existing, k)) continue;
    const dv = defaults[k];
    // Whole subtree new from defaults: still filter protected/comment/secret keys inside it.
    out[k] = isPlain(dv) ? merge({}, dv, [...path, k]) : clone(dv);
  }
  if (path.join(".") === "server" && !Object.prototype.hasOwnProperty.call(out, "allowedOrigins")) {
    out["allowedOrigins"] = [];
  }
  return out;
}

export function mergeControllerConfig(existing: unknown, defaults: unknown): Json {
  if (!isPlain(existing)) throw new Error("Cấu hình hiện có phải là một đối tượng JSON.");
  const base: Json = isPlain(defaults) ? defaults : {};
  const result = merge(existing, base, []);
  // `server` only in defaults (user config lacks it): still guarantee the strict allowedOrigins default.
  const srv = result["server"];
  if (isPlain(srv) && !Object.prototype.hasOwnProperty.call(existing, "server")) srv["allowedOrigins"] = [];
  return result;
}
