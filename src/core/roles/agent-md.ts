// Minimal frontmatter splitter for agent markdown files. No YAML library, no I/O.
import { DEFAULT_EXTRA_TOOLS, MAX_DESCRIPTION, MAX_PROMPT, SAFE_AGENT_TOOLS } from "../run/extras.js";
import { MAX_ITEM_NAME, MAX_LIBRARY_ITEMS,MAX_LIBRARY_ROLES, normalizeName } from "./role-library.js";
import { isPermissiveLicense } from "./agent-finder.js";

export type FrontmatterResult = {
  hasFrontmatter: boolean;
  meta: Record<string, string | string[]>;
  body: string;
};

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' || a === "'") && a === b) return s.slice(1, -1);
  }
  return s;
}

function isContinuation(line: string): boolean {
  return line.trim() === "" || /^\s/.test(line);
}

export function parseFrontmatter(text: string): FrontmatterResult {
  const none: FrontmatterResult = { hasFrontmatter: false, meta: {}, body: text };
  const norm = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/^\s+/, "");
  const lines = norm.split("\n");
  if ((lines[0] ?? "").trimEnd() !== "---") return none;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trimEnd() === "---") {
      close = i;
      break;
    }
  }
  if (close < 0) return none;

  const block = lines.slice(1, close);
  const body = lines.slice(close + 1).join("\n");
  const meta: Record<string, string | string[]> = {};

  let i = 0;
  while (i < block.length) {
    const line = block[i] ?? "";
    i++;
    if (line.trim() === "" || /^\s/.test(line) || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!key) continue;
    const raw = line.slice(colon + 1).trim();

    const cont: string[] = [];
    if (raw === "") {
      // block list items (at column 0 or indented) and indented lines
      while (i < block.length) {
        const nx = block[i] ?? "";
        if (isContinuation(nx) || /^-(\s|$)/.test(nx)) {
          cont.push(nx);
          i++;
        } else break;
      }
      const items = cont
        .map((l) => l.trim())
        .filter((l) => /^-(\s|$)/.test(l))
        .map((l) => unquote(l.slice(1)))
        .filter((l) => l !== "");
      if (items.length > 0) meta[key] = items;
      else {
        const joined = cont.map((l) => l.trim()).filter((l) => l !== "").join(" ");
        meta[key] = joined;
      }
      continue;
    }

    while (i < block.length && isContinuation(block[i] ?? "")) {
      cont.push(block[i] ?? "");
      i++;
    }
    const contTrim = cont.map((l) => l.trim());

    if (/^[|>][+-]?$/.test(raw)) {
      const parts = raw.startsWith("|") ? contTrim : contTrim.filter((l) => l !== "");
      meta[key] = parts.join(raw.startsWith("|") ? "\n" : " ").trim();
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      meta[key] = raw
        .slice(1, -1)
        .split(",")
        .map((p) => unquote(p))
        .filter((p) => p !== "");
      continue;
    }
    const extra = contTrim.filter((l) => l !== "");
    meta[key] = [unquote(raw), ...extra].join(" ");
  }

  return { hasFrontmatter: true, meta, body };
}

export type AgentMdWarning =
  | "no_frontmatter"
  | "tools_dropped"
  | "tools_defaulted"
  | "model_dropped"
  | "prompt_truncated"
  | "description_truncated"
  | "danger_keyword"
  | "license_unknown";

export type AgentMdPreview = {
  kind: "role" | "skill" | "prompt";
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  droppedTools: string[];
  dangerKeywords: string[];
  warnings: AgentMdWarning[];
  license: string | null;
  licenseOk: boolean | null;
  blocked: null | "empty" | "library_full" | "id_conflict" | "license_not_permissive";
};

export type ImportPreviewOptions = {
  filename?: string;
  as?: "role" | "skill" | "prompt";
  id?: string;
  builtinRoles: string[];
  libraryRoleIds: string[];
  libraryItemCount: number;
};

/** Case-insensitive substring match is intentional ("push" also hits "pushed", "git push"). */
export const DANGER_KEYWORDS = [
  "push",
  "rm -rf",
  "rm -r",
  "remove-item -recurse",
  "xóa đệ quy",
  "xoa de quy",
  "đẩy lên remote",
  "curl",
  "wget",
  "bypass",
  "dangerously-skip-permissions",
  "sudo",
  "chmod 777",
] as const;

export const MAX_IMPORT_TEXT_BYTES = 131072;
const MAX_LONG_TEXT_BYTES = 64 * 1024;

function metaStr(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return (Array.isArray(v) ? v.join(" ") : v).trim();
}

/** Cut to at most `max` UTF-8 bytes without splitting a character. */
function cutBytes(s: string, max: number): string {
  if (Buffer.byteLength(s, "utf8") <= max) return s;
  let out = Buffer.from(s, "utf8").subarray(0, max).toString("utf8");
  while (out.endsWith("�")) out = out.slice(0, -1);
  return out;
}

function splitTools(v: string | string[]): string[] {
  const parts = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const part of parts) {
    let cur = "";
    let depth = 0;
    for (const ch of part) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === "," || /\s/.test(ch))) {
        if (cur) out.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function buildImportPreview(text: string, opts: ImportPreviewOptions): AgentMdPreview {
  const { hasFrontmatter, meta, body } = parseFrontmatter(cutBytes(text, MAX_IMPORT_TEXT_BYTES));
  const warnings: AgentMdWarning[] = [];
  const addWarn = (w: AgentMdWarning) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  if (!hasFrontmatter) addWarn("no_frontmatter");

  const filename = opts.filename ?? "";
  const baseName = filename.split(/[\\/]/).pop() ?? "";
  const stem = baseName.replace(/\.[^.]*$/, "");
  const trimmedBody = body.trim();
  const hasToolsKey = "tools" in meta;
  const hasModelKey = "model" in meta;

  let kind: AgentMdPreview["kind"];
  if (opts.as) kind = opts.as;
  else if (baseName.toLowerCase() === "skill.md") kind = "skill";
  else if (!hasToolsKey && !hasModelKey && trimmedBody.length > MAX_PROMPT) kind = "skill";
  else kind = "role";

  const roleId = normalizeName(opts.id || metaStr(meta.name) || stem);
  const name = (metaStr(meta.name) || stem || roleId).slice(0, MAX_ITEM_NAME);
  // skill/prompt ids are generated by RoleLibrary.createItem from the name (opts.id is ignored there)
  const id = kind === "role" ? roleId : normalizeName(name) || "item";

  // tools
  const tools: string[] = [];
  const droppedTools: string[] = [];
  if (hasToolsKey) {
    for (const raw of splitTools(meta.tools as string | string[])) {
      const canon = SAFE_AGENT_TOOLS.find((t) => t.toLowerCase() === raw.toLowerCase());
      if (canon) {
        if (!tools.includes(canon)) tools.push(canon);
      } else if (!droppedTools.includes(raw)) droppedTools.push(raw);
    }
    if (droppedTools.length > 0) addWarn("tools_dropped");
  }
  if (tools.length === 0 && (kind === "role" || hasToolsKey)) {
    tools.push(...DEFAULT_EXTRA_TOOLS);
    addWarn("tools_defaulted");
  }

  // model
  let model: string | undefined;
  if (hasModelKey) {
    const m = metaStr(meta.model);
    if (m && m.toLowerCase() !== "inherit" && /^[A-Za-z0-9._-]{1,64}$/.test(m)) model = m;
    else addWarn("model_dropped");
  }

  // prompt
  let prompt = trimmedBody;
  if (kind === "role") {
    if (prompt.length > MAX_PROMPT) {
      prompt = prompt.slice(0, MAX_PROMPT);
      addWarn("prompt_truncated");
    }
  } else {
    const cut = cutBytes(prompt, MAX_LONG_TEXT_BYTES);
    if (cut !== prompt) {
      prompt = cut;
      addWarn("prompt_truncated");
    }
  }

  // description
  let description = metaStr(meta.description);
  if (!description) {
    description = trimmedBody.split("\n").find((l) => l.trim() !== "")?.trim().replace(/^#+\s*/, "") ?? "";
  }
  if (description.length > MAX_DESCRIPTION) {
    description = description.slice(0, MAX_DESCRIPTION);
    addWarn("description_truncated");
  }

  // danger keywords
  const hay = `${prompt}\n${description}`.normalize("NFC").toLowerCase();
  const dangerKeywords = DANGER_KEYWORDS.filter((k) => hay.includes(k.normalize("NFC")));
  if (dangerKeywords.length > 0) addWarn("danger_keyword");

  // license
  const licenseStr = metaStr(meta.license);
  const hasLicenseKey = licenseStr !== "";
  const license = hasLicenseKey ? licenseStr : null;
  let licenseOk: boolean | null = null;
  if (hasLicenseKey) licenseOk = isPermissiveLicense(license);
  else addWarn("license_unknown");

  // blocked: empty > license_not_permissive > id_conflict > library_full
  let blocked: AgentMdPreview["blocked"] = null;
  const conflict = kind === "role" && id !== "" && (opts.builtinRoles.includes(id) || opts.libraryRoleIds.includes(id));
  const full =
    kind === "role"
      ? opts.libraryRoleIds.length >= MAX_LIBRARY_ROLES
      : opts.libraryItemCount >= MAX_LIBRARY_ITEMS;
  if (prompt === "" || (kind === "role" && (id === "" || description === ""))) blocked = "empty";
  else if (licenseOk === false) blocked = "license_not_permissive";
  else if (conflict) blocked = "id_conflict";
  else if (full) blocked = "library_full";

  const preview: AgentMdPreview = {
    kind,
    id,
    name,
    description,
    prompt,
    tools,
    droppedTools,
    dangerKeywords: [...dangerKeywords],
    warnings,
    license,
    licenseOk,
    blocked,
  };
  if (model !== undefined) preview.model = model;
  return preview;
}
