import { isObj } from "../app/util.js";
/** Planner queue: schema check for the idea-splitter output (docs/PLANNER-QUEUE.md section 2). Pure, no I/O. */

export const QUEUE_SPLITTER_ROLE = "idea-splitter";

export const QUEUE_MAX_COMMANDS = 20;
/** Commands the controller appends itself (integrate + final-review) when `queue.splitter.autoIntegrate` is on. */
export const QUEUE_AUTO_COMMANDS = 2;
/** Splitter's own cap when the controller appends its 2 commands, so the batch stays within QUEUE_MAX_COMMANDS. */
export const SPLITTER_OWN_MAX_COMMANDS = QUEUE_MAX_COMMANDS - QUEUE_AUTO_COMMANDS;

export interface QueueReference {
  url: string;
  title: string;
  note: string;
}

/** "coding" (default, worktree run) or "research" (read-only run, no commit). */
export type QueueCommandKind = "coding" | "research";
export const QUEUE_COMMAND_KINDS: readonly QueueCommandKind[] = ["coding", "research"];

export interface QueueInterface {
  /** Id of the command that provides it. */
  owner: string;
  name: string;
  description: string;
}

/** Shared frame of one idea batch: every command's run sees it (docs/PLANNER-QUEUE.md section 2b). */
export interface QueueBlueprint {
  goal: string;
  constraints: string[];
  architecture: string;
  interfaces: QueueInterface[];
}

export interface QueueCommand {
  id: string;
  title: string;
  body: string;
  files: string[];
  dependsOn: string[];
  parallelGroup?: string;
  verify: string;
  size: 1 | 2;
  references?: QueueReference[];
  warnings?: string[];
  consumes?: string[];
  produces?: string[];
  acceptance?: string[];
  kind?: QueueCommandKind;
}

export type SplitterResult =
  | { ok: true; commands: QueueCommand[]; blueprint?: QueueBlueprint; warnings?: string[] }
  | { ok: false; error: string };

const ID_RE = /^[a-z0-9_-]{1,32}$/;
const COMMAND_KEYS = new Set([
  "id", "title", "body", "files", "dependsOn", "parallelGroup", "verify", "size", "references",
  "consumes", "produces", "acceptance", "kind",
]);
const BLUEPRINT_KEYS = new Set(["goal", "constraints", "architecture", "interfaces"]);
const INTERFACE_KEYS = new Set(["owner", "name", "description"]);
export const QUEUE_MAX_ACCEPTANCE = 5;
const CONTRACT_ITEM_MAX = 300;
const CONTRACT_LIST_MAX = 20;
/** A verify that starts with one of these looks like a command a shell can run. */
const RUNNABLE_VERIFY_RE = /^(?:npm|npx|pnpm|yarn|node|tsc|vitest|jest|pytest|python3?|py|dotnet|go|cargo|make|mvn|gradle|deno|bun|powershell|pwsh|bash|sh|php|composer|ruby|bundle|\.\/|\.\\)(?:\s|$)/i;
const REFERENCE_KEYS = new Set(["url", "title", "note"]);
export const QUEUE_MAX_REFERENCES = 5;

interface SafetyRule {
  re: RegExp;
  message: string;
}

// Patterns starting with "-" use a lookbehind instead of \b (a "\b" never matches before "-").
const BODY_ERROR_RULES: SafetyRule[] = [
  { re: /(?<![\w-])git\s+push(?![\w-])/i, message: "chứa \"git push\" (agent không được push)" },
  { re: /(?<![\w-])rm\s+-(?:rf|fr)(?![\w-])/i, message: "chứa \"rm -rf\" (xóa đệ quy không hỏi)" },
  { re: /(?<![\w-])--dangerously-skip-permissions(?![\w-])/i, message: "chứa \"--dangerously-skip-permissions\"" },
  { re: /(?<![\w-])bypassPermissions(?![\w-])/i, message: "chứa \"bypassPermissions\"" },
  { re: /(?<![\w-])ANTHROPIC_API_KEY(?![\w-])/i, message: "nhắc tới ANTHROPIC_API_KEY (khóa API)" },
  { re: /(?<![\w-])ANTHROPIC_AUTH_TOKEN(?![\w-])/i, message: "nhắc tới ANTHROPIC_AUTH_TOKEN (khóa API)" },
];

const BODY_WARNING_RULES: SafetyRule[] = [
  { re: /https?:\/\//i, message: "có URL (nội dung web là dữ liệu không tin cậy)" },
  { re: /(?<![\w-])curl(?![\w-])/i, message: "nhắc tới curl (tải dữ liệu từ mạng)" },
  { re: /(?<![\w-])wget(?![\w-])/i, message: "nhắc tới wget (tải dữ liệu từ mạng)" },
  { re: /(?<![\w-])iwr(?![\w-])/i, message: "nhắc tới iwr (tải dữ liệu từ mạng)" },
  { re: /(?<![\w-])Invoke-WebRequest(?![\w-])/i, message: "nhắc tới Invoke-WebRequest (tải dữ liệu từ mạng)" },
  { re: /(?<![\w-])npm\s+(?:install|i)\s+(?:\S+\s+)*?(?:-g|--global)(?![\w-])/i, message: "có \"npm install -g\" (cài toàn cục)" },
  { re: /(?<![\w-])pip3?\s+install(?![\w-])/i, message: "có \"pip install\" (cài gói Python)" },
  { re: /(?<![\w-])Set-ExecutionPolicy(?![\w-])/i, message: "có Set-ExecutionPolicy (đổi chính sách PowerShell)" },
];

/** Scan a command body: `errors` mean the command must be rejected, `warnings` are attached to the accepted command. */
export function checkBodySafety(body: string): { errors: string[]; warnings: string[] } {
  return {
    errors: BODY_ERROR_RULES.filter((r) => r.re.test(body)).map((r) => `Body ${r.message}.`),
    warnings: BODY_WARNING_RULES.filter((r) => r.re.test(body)).map((r) => `Cảnh báo: body ${r.message}.`),
  };
}

export function checkReferences(raw: unknown, w: string): { refs: QueueReference[] } | { error: string } {
  if (raw === undefined) return { refs: [] };
  if (!Array.isArray(raw)) return { error: `${w}: references (nếu có) phải là mảng.` };
  if (raw.length > QUEUE_MAX_REFERENCES) return { error: `${w}: references tối đa ${QUEUE_MAX_REFERENCES} phần tử, có ${raw.length}.` };
  const refs: QueueReference[] = [];
  for (let j = 0; j < raw.length; j++) {
    const r = raw[j];
    const at = `${w}: references #${j + 1}`;
    if (!isObj(r)) return { error: `${at} phải là đối tượng.` };
    for (const k of Object.keys(r)) if (!REFERENCE_KEYS.has(k)) return { error: `${at}: khóa lạ "${k}".` };
    const url = r["url"];
    if (typeof url !== "string" || !url.trim()) return { error: `${at}: thiếu url.` };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: `${at}: url không hợp lệ.` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: `${at}: url chỉ nhận http hoặc https.` };
    const title = r["title"] ?? "";
    if (typeof title !== "string" || title.length > 120) return { error: `${at}: title phải là chuỗi tối đa 120 ký tự.` };
    const note = r["note"] ?? "";
    if (typeof note !== "string" || note.length > 200) return { error: `${at}: note phải là chuỗi tối đa 200 ký tự.` };
    refs.push({ url, title, note });
  }
  return { refs };
}

function badPath(p: string): string | null {
  if (p.includes("\\")) return "dùng dấu '/' thay cho '\\'";
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return "không được là đường dẫn tuyệt đối";
  const parts = p.split("/");
  if (parts.includes("..")) return "không được chứa '..'";
  if (parts.some((s) => s.toLowerCase() === ".git")) return "không được trỏ vào .git";
  return null;
}

export const DEFAULT_VERIFY = "Chạy typecheck và test nhắm đích của phần vừa đổi.";
const VERIFY_MAX = 300;
const TITLE_MAX = 120;

/** Trim to `max` characters, ending with an ellipsis when something was cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Validate the parsed JSON returned by idea-splitter. Stops at the first error (Vietnamese message).
 * Harmless slips are repaired instead of throwing the whole batch away (one empty `verify` once voided 11 good commands):
 * a missing or empty `verify` gets DEFAULT_VERIFY, and a too long `title` or `verify` is cut. Everything that affects safety
 * or structure (ids, paths, dependencies, forbidden patterns in `body`) is still rejected.
 */
export function validateSplitterOutput(raw: unknown, opts: { maxCommands?: number } = {}): SplitterResult {
  const fail = (error: string): SplitterResult => ({ ok: false, error });
  if (!isObj(raw)) return fail("Kết quả phải là một đối tượng JSON dạng {\"commands\": [...]}.");
  for (const k of Object.keys(raw)) if (k !== "commands" && k !== "blueprint") return fail(`Khóa lạ ở gốc: "${k}".`);
  const list = raw["commands"];
  if (!Array.isArray(list)) return fail("Thiếu mảng \"commands\".");
  if (list.length === 0) return fail("Danh sách lệnh rỗng.");
  const max = Math.min(QUEUE_MAX_COMMANDS, opts.maxCommands ?? QUEUE_MAX_COMMANDS);
  if (list.length > max) {
    return fail(`Lệnh quá lớn: ${list.length} lệnh con, tối đa ${max}. Hãy chia ý tưởng nhỏ hơn.`);
  }
  let blueprint: QueueBlueprint | undefined;
  if (raw["blueprint"] !== undefined) {
    const bp = checkBlueprint(raw["blueprint"]);
    if ("error" in bp) return fail(bp.error);
    blueprint = bp.blueprint;
  }

  const out: QueueCommand[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const at = `Lệnh #${i + 1}`;
    if (!isObj(c)) return fail(`${at}: phải là đối tượng.`);
    for (const k of Object.keys(c)) if (!COMMAND_KEYS.has(k)) return fail(`${at}: khóa lạ "${k}".`);
    const id = c["id"];
    if (typeof id !== "string" || !ID_RE.test(id)) return fail(`${at}: id phải khớp [a-z0-9_-] dài 1-32 ký tự.`);
    if (ids.has(id)) return fail(`${at}: id "${id}" bị trùng.`);
    ids.add(id);
    const w = `Lệnh "${id}"`;
    const rawTitle = c["title"];
    if (typeof rawTitle !== "string" || !rawTitle.trim()) return fail(`${w}: title phải là chuỗi không rỗng.`);
    const title = clip(rawTitle.trim(), TITLE_MAX);
    const body = c["body"];
    if (typeof body !== "string" || !body.trim() || body.length > 4000) return fail(`${w}: body phải là chuỗi không rỗng, tối đa 4000 ký tự.`);
    const safety = checkBodySafety(body);
    if (safety.errors.length) return fail(`${w}: bị từ chối. ${safety.errors.join(" ")}`);
    const refCheck = checkReferences(c["references"], w);
    if ("error" in refCheck) return fail(refCheck.error);
    const files = c["files"];
    if (!Array.isArray(files) || files.length === 0 || files.length > 20) return fail(`${w}: files phải là mảng 1-20 đường dẫn.`);
    for (const f of files) {
      if (typeof f !== "string" || !f.trim()) return fail(`${w}: files chỉ nhận chuỗi không rỗng.`);
      const why = badPath(f);
      if (why) return fail(`${w}: đường dẫn "${f}" ${why}.`);
    }
    const dep = c["dependsOn"];
    if (!Array.isArray(dep) || dep.some((d) => typeof d !== "string")) return fail(`${w}: dependsOn phải là mảng id.`);
    const pg = c["parallelGroup"];
    if (pg !== undefined && (typeof pg !== "string" || !pg.trim())) return fail(`${w}: parallelGroup (nếu có) phải là chuỗi không rỗng.`);
    const rawVerify = c["verify"];
    if (rawVerify !== undefined && rawVerify !== null && typeof rawVerify !== "string") return fail(`${w}: verify (nếu có) phải là chuỗi.`);
    const hasVerify = typeof rawVerify === "string" && rawVerify.trim() !== "";
    const verify = hasVerify ? clip((rawVerify as string).trim(), VERIFY_MAX) : DEFAULT_VERIFY;
    const warnings = [...safety.warnings];
    if (!hasVerify) warnings.push("Cảnh báo: verify trống, đã dùng câu mặc định; nên ghi một lệnh chạy được (ví dụ npx vitest run tests/x.test.ts).");
    else if (!RUNNABLE_VERIFY_RE.test(verify)) warnings.push("Cảnh báo: verify không giống một lệnh chạy được (ví dụ npx vitest run tests/x.test.ts).");
    const size = c["size"];
    if (size !== 1 && size !== 2) return fail(`${w}: size chỉ được là 1 hoặc 2.`);
    const contract: Partial<Pick<QueueCommand, "consumes" | "produces" | "acceptance">> = {};
    for (const key of ["consumes", "produces", "acceptance"] as const) {
      if (c[key] === undefined) continue;
      const max = key === "acceptance" ? QUEUE_MAX_ACCEPTANCE : CONTRACT_LIST_MAX;
      const list = checkStringList(c[key], `${w}: ${key}`, key === "acceptance" ? 1 : 0, max);
      if ("error" in list) return fail(list.error);
      const bad = checkBodySafety(list.items.join("\n")).errors;
      if (bad.length) return fail(`${w}: ${key} bị từ chối. ${bad.join(" ")}`);
      contract[key] = list.items;
    }
    const kind = c["kind"];
    if (kind !== undefined && !QUEUE_COMMAND_KINDS.includes(kind as QueueCommandKind)) {
      return fail(`${w}: kind chỉ được là ${QUEUE_COMMAND_KINDS.join(" hoặc ")}.`);
    }
    const cmd: QueueCommand = {
      id, title, body, files: [...(files as string[])], dependsOn: [...(dep as string[])], verify, size,
      references: refCheck.refs, warnings, ...contract,
    };
    if (typeof pg === "string") cmd.parallelGroup = pg;
    if (kind !== undefined) cmd.kind = kind as QueueCommandKind;
    out.push(cmd);
  }

  for (const c of out) {
    for (const d of c.dependsOn) {
      if (d === c.id) return fail(`Lệnh "${c.id}": dependsOn không được tự trỏ vào chính nó.`);
      if (!ids.has(d)) return fail(`Lệnh "${c.id}": dependsOn trỏ tới id không tồn tại "${d}".`);
    }
  }

  // Cycle detection (DFS, 0 = new, 1 = visiting, 2 = done).
  const byId = new Map(out.map((c) => [c.id, c]));
  const state = new Map<string, number>();
  const visit = (id: string): string | null => {
    state.set(id, 1);
    for (const d of byId.get(id)!.dependsOn) {
      const s = state.get(d) ?? 0;
      if (s === 1) return d;
      if (s === 0) {
        const hit = visit(d);
        if (hit) return hit;
      }
    }
    state.set(id, 2);
    return null;
  };
  for (const c of out) {
    if ((state.get(c.id) ?? 0) === 0) {
      const hit = visit(c.id);
      if (hit) return fail(`dependsOn có vòng phụ thuộc quanh lệnh "${hit}".`);
    }
  }

  const batchWarnings: string[] = [];
  for (const itf of blueprint?.interfaces ?? []) {
    if (!ids.has(itf.owner)) batchWarnings.push(`Cảnh báo: blueprint.interfaces "${itf.name}" thuộc lệnh không tồn tại "${itf.owner}".`);
  }
  return { ok: true, commands: out, ...(blueprint ? { blueprint } : {}), ...(batchWarnings.length ? { warnings: batchWarnings } : {}) };
}

function checkStringList(raw: unknown, at: string, min: number, max: number): { items: string[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: `${at} phải là mảng chuỗi.` };
  if (raw.length < min || raw.length > max) return { error: `${at} cần ${min}-${max} phần tử, có ${raw.length}.` };
  const items: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !v.trim()) return { error: `${at} chỉ nhận chuỗi không rỗng.` };
    items.push(clip(v.trim(), CONTRACT_ITEM_MAX));
  }
  return { items };
}

/** Shape + safety check of the splitter's optional `blueprint` (its text reaches every command's prompt). */
export function checkBlueprint(raw: unknown): { blueprint: QueueBlueprint } | { error: string } {
  const at = "blueprint";
  if (!isObj(raw)) return { error: `${at} phải là đối tượng {goal, constraints, architecture, interfaces}.` };
  for (const k of Object.keys(raw)) if (!BLUEPRINT_KEYS.has(k)) return { error: `${at}: khóa lạ "${k}".` };
  const goal = raw["goal"];
  // Descriptive text is clipped, never a reason to throw away a whole (paid) split.
  if (typeof goal !== "string" || !goal.trim()) return { error: `${at}.goal phải là chuỗi không rỗng.` };
  const arch = raw["architecture"] ?? "";
  if (typeof arch !== "string") return { error: `${at}.architecture phải là chuỗi.` };
  const cons = raw["constraints"] === undefined ? { items: [] } : checkStringList(raw["constraints"], `${at}.constraints`, 0, CONTRACT_LIST_MAX);
  if ("error" in cons) return cons;
  const rawItf = raw["interfaces"] ?? [];
  if (!Array.isArray(rawItf) || rawItf.length > 40) return { error: `${at}.interfaces phải là mảng tối đa 40 phần tử.` };
  const interfaces: QueueInterface[] = [];
  for (let i = 0; i < rawItf.length; i++) {
    const it = rawItf[i];
    const w = `${at}.interfaces #${i + 1}`;
    if (!isObj(it)) return { error: `${w} phải là đối tượng.` };
    for (const k of Object.keys(it)) if (!INTERFACE_KEYS.has(k)) return { error: `${w}: khóa lạ "${k}".` };
    const owner = it["owner"];
    const name = it["name"];
    const description = it["description"] ?? "";
    if (typeof owner !== "string" || !owner.trim()) return { error: `${w}: thiếu owner (id lệnh).` };
    if (typeof name !== "string" || !name.trim()) return { error: `${w}: name phải là chuỗi không rỗng.` };
    if (typeof description !== "string") return { error: `${w}: description phải là chuỗi.` };
    interfaces.push({ owner: owner.trim(), name: clip(name.trim(), 200), description: clip(description.trim(), 500) });
  }
  const blueprint: QueueBlueprint = { goal: clip(goal.trim(), 1000), constraints: cons.items, architecture: clip(arch.trim(), 3000), interfaces };
  const text = [blueprint.goal, blueprint.architecture, ...blueprint.constraints, ...interfaces.flatMap((x) => [x.name, x.description])].join("\n");
  const bad = checkBodySafety(text).errors;
  if (bad.length) return { error: `${at} bị từ chối. ${bad.join(" ").replace(/Body /g, "")}` };
  return { blueprint };
}

// ---- Independence check (section 3) and waves (section 6) ----

export interface IndependenceResult {
  independent: boolean;
  reason?: string;
}

function normPath(p: string): string {
  let s = p.trim().replace(/\\/g, "/").toLowerCase();
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}

function globToRegex(glob: string): RegExp {
  const g = normPath(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!;
    if (ch === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function pathsOverlap(a: string, b: string): boolean {
  const x = normPath(a);
  const y = normPath(b);
  if (x === y) return true;
  if (x.endsWith("/") && y.startsWith(x)) return true;
  if (y.endsWith("/") && x.startsWith(y)) return true;
  return false;
}

/** Hotspot patterns (as given) touched by the command's files. */
function hotspotsOf(c: QueueCommand, hotspots: string[]): Set<string> {
  const hit = new Set<string>();
  for (const h of hotspots) {
    const re = globToRegex(h);
    if (c.files.some((f) => re.test(normPath(f)))) hit.add(h);
  }
  return hit;
}

/** All transitive dependencies (ancestors) of a command id. */
function ancestors(id: string, byId: Map<string, QueueCommand>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(byId.get(id)?.dependsOn ?? [])];
  while (stack.length) {
    const d = stack.pop()!;
    if (seen.has(d)) continue;
    seen.add(d);
    stack.push(...(byId.get(d)?.dependsOn ?? []));
  }
  return seen;
}

/**
 * Two commands are independent when neither depends on the other (transitively, when `all` is given),
 * their files do not overlap, and they do not share a hotspot.
 */
export function checkIndependence(
  a: QueueCommand,
  b: QueueCommand,
  hotspots: string[],
  all?: QueueCommand[],
): IndependenceResult {
  const byId = new Map((all ?? [a, b]).map((c) => [c.id, c]));
  if (ancestors(a.id, byId).has(b.id) || ancestors(b.id, byId).has(a.id)) {
    return { independent: false, reason: `"${a.id}" và "${b.id}" phụ thuộc nhau (trực tiếp hoặc bắc cầu).` };
  }
  for (const f of a.files) {
    for (const g of b.files) {
      if (pathsOverlap(f, g)) return { independent: false, reason: `"${a.id}" và "${b.id}" cùng sửa "${f}" / "${g}".` };
    }
  }
  const ha = hotspotsOf(a, hotspots);
  for (const h of hotspotsOf(b, hotspots)) {
    if (ha.has(h)) return { independent: false, reason: `"${a.id}" và "${b.id}" cùng chạm điểm nóng "${h}".` };
  }
  return { independent: true };
}

export interface WaveEntry {
  id: string;
  wave: number;
  /** Vietnamese reasons the command was pushed to a later wave or split from its parallelGroup. */
  reasons: string[];
}

export interface WaveOptions {
  maxParallel?: number;
  hotspots: string[];
}

/**
 * Wave per command: lowest wave = 1 + max(wave of dependsOn), then pushed later while a command already placed in
 * that wave conflicts (files / hotspot). parallelGroup is only a hint and ignored. maxParallel never splits waves.
 * Deterministic. Input must already pass validateSplitterOutput (acyclic).
 */
export function computeWaves(commands: QueueCommand[], opts: WaveOptions): WaveEntry[] {
  // Stable topological order: repeatedly take the first listed command whose deps are all placed.
  const order: QueueCommand[] = [];
  const done = new Set<string>();
  while (order.length < commands.length) {
    const next = commands.find((c) => !done.has(c.id) && c.dependsOn.every((d) => done.has(d)));
    if (!next) throw new Error("dependsOn có vòng phụ thuộc.");
    order.push(next);
    done.add(next.id);
  }

  const wave = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  const placed: QueueCommand[] = [];
  for (const c of order) {
    const rs: string[] = [];
    let w = 1 + Math.max(0, ...c.dependsOn.map((d) => wave.get(d) ?? 0));
    for (;;) {
      const clash = placed.find((p) => wave.get(p.id) === w && !checkIndependence(c, p, opts.hotspots, commands).independent);
      if (!clash) break;
      rs.push(`Đẩy từ đợt ${w} sang đợt ${w + 1}: ${checkIndependence(c, clash, opts.hotspots, commands).reason}`);
      w++;
    }
    wave.set(c.id, w);
    reasons.set(c.id, rs);
    placed.push(c);
  }

  // parallelGroup hint split from group-mates connected by an edge.
  for (const c of commands) {
    if (!c.parallelGroup) continue;
    for (const o of commands) {
      if (o.id === c.id || o.parallelGroup !== c.parallelGroup) continue;
      if (wave.get(o.id) !== wave.get(c.id) && !checkIndependence(c, o, opts.hotspots, commands).independent) {
        reasons.get(c.id)!.push(`Tách khỏi nhóm song song "${c.parallelGroup}" (với "${o.id}"): có cạnh nối.`);
      }
    }
  }
  return commands.map((c) => ({ id: c.id, wave: wave.get(c.id)!, reasons: reasons.get(c.id)! }));
}
