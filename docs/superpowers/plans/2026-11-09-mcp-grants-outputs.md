# MCP, Cấp quyền theo môi trường, Thư mục lưu tệp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cài đặt có tab "Kết nối MCP" và "Cấp quyền" (tick theo môi trường), agent đọc/ghi tệp máy qua Desktop Commander, và mọi tệp AI tạo ra (ngoài code) về một thư mục đổi được, nút "Tải về" thành "Mở tệp".

**Architecture:** Ba mô-đun lõi thuần/ít I/O (`grants.ts`, `mcp-registry.ts`, `outputs.ts`) được test riêng; `run-manager` ghép chúng vào run coding (allowlist, `mcp.json`, `--add-dir`, `--disallowedTools`) và đồng bộ artifact về thư mục lưu khi run kết thúc; `http.ts` thêm route mỏng; UI thêm hai tab + một khối cài đặt và đổi nút ở `RunPage`.

**Tech Stack:** TypeScript (Node ≥ 22, `node:sqlite`), vitest, React + Vite, JSON-RPC stdio tự viết (không thêm dependency).

**Spec:** `docs/superpowers/specs/2026-11-09-mcp-grants-outputs-design.md`

## Global Constraints
- Spawn `claude` và mọi tiến trình **không qua shell**; file cho `--mcp-config` (quy tắc 4 của CLAUDE.md).
- Không dùng `--bare`, không `--dangerously-skip-permissions`; không sửa `~/.claude/settings.json`; không `claude mcp add --scope user`; không cài gói toàn cục (quy tắc 1, 2, 6).
- Thông báo lỗi/UI tiếng Việt, mã/commit tiếng Anh; i18n thêm khóa vào **cả** `vi` và `en` của `ui/src/i18n.ts` (có test parity).
- Đường dẫn thư mục lưu: tuyệt đối, ASCII, không `..` (quy tắc 10). Đường dẫn mở trong Explorer **không** lấy nguyên văn từ request: id run → DB, `rel_path` qua `resolveInside`.
- Mặc định mọi môi trường cũ chạy **y hệt trước** (allowlist = `CODING_ENV_TOOLS`, MCP tắt).
- Chỉ run coding đổi hành vi; research và chia ý tưởng chỉ đọc giữ nguyên.
- Test: `npx vitest run --maxWorkers=1 --testTimeout=120000 <file>`; cuối: `npm run typecheck`, `npm run build:ui`.
- Commit nhỏ: `git -c user.name=dev -c user.email=agent@example.com commit …`, kết thúc thông điệp bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `src/core/grants.ts` (mới) | Kiểu `Grants`, mặc định, sanitize, ánh xạ tick → rule allowlist, `--add-dir`, kế hoạch MCP (`planMcp`) |
| `src/core/mcp-registry.ts` (mới) | Kiểu `McpServer`, mẫu Desktop Commander, validate, đọc/ghi `data/mcp-servers.json`, parse `claude mcp list`, snapshot CLI |
| `src/core/mcp-probe.ts` (mới) | Khởi động máy chủ stdio, `initialize` + `tools/list` (JSON-RPC) |
| `src/core/outputs.ts` (mới) | Thư mục lưu: mặc định/validate, `resolveInside`, `syncRunOutputs`, `explorerArgs` |
| `src/core/permissions.ts` | `buildCodingAllowedTools` nhận thêm `grants?` |
| `src/core/app-settings.ts` | Thêm `outputDir`, `defaultGrants`, `cliMcp` snapshot |
| `src/core/run-store.ts` | Cột `projects.grants` + `getProjectGrants/setProjectGrants` |
| `src/core/run-manager.ts` | Ghép grants + MCP vào run coding; `syncOutputs`, `openOutput`, `setOutputDir` |
| `src/server/http.ts` | Route `/api/mcp*`, `/api/grants/default`, `/api/projects/:n/grants`, `/api/settings/output-dir`, `/api/runs/:id/open-output`, `/api/outputs/save` |
| `ui/src/api.ts`, `ui/src/i18n.ts` | Client API, chuỗi vi/en |
| `ui/src/components/McpSection.tsx`, `GrantsSection.tsx`, `OutputDirSection.tsx` (mới) | Giao diện |
| `ui/src/pages/SettingsPanel.tsx`, `RunPage.tsx` | Tab mới, đổi nút |
| `docs/SPIKE-RESULTS.md`, `docs/PROGRESS.md`, `package.json` | Bằng chứng, phiên bản 0.10.0 |

---

### Task 0: Spike MCP trong `claude -p` (hỏi người dùng trước khi chạy: tốn rất ít hạn mức, model haiku)

**Files:** Create `scripts/spike-mcp.mts`; Modify `docs/SPIKE-RESULTS.md` (thêm mục "MCP").

**Interfaces:** Produces: kết luận Đ/S cho 5 câu hỏi dưới đây; Task 3–4 phụ thuộc kết quả.

Câu hỏi cần trả lời bằng chạy thật (CLI `claude` 2.1.301, `--permission-mode bypassPermissions`, `--setting-sources project`, cwd là một thư mục tạm ngoài repo):
- (a) `--mcp-config <file> --strict-mcp-config` nạp được Desktop Commander (`cmd /c npx -y @wonderwhy-er/desktop-commander@latest`)? Công cụ hiện tên `mcp__desktop-commander__*`?
- (b) Tham số `--mcp-config` là variadic: giá trị đứng sau có bị nuốt không? (thử `--mcp-config file --setting-sources project`.)
- (c) `--disallowedTools mcp__desktop-commander__start_process` chặn được công cụ đó khi `bypassPermissions`? Prefix `mcp__desktop-commander` chặn cả máy chủ?
- (d) Không `--strict-mcp-config` + `--setting-sources project`: máy chủ plugin và connector claude.ai có xuất hiện (xem `system/init` của stream-json, trường `mcp_servers`)?
- (e) Desktop Commander có giới hạn thư mục được không (biến môi trường hoặc tham số dòng lệnh)? Nếu không, mặc định nó đọc cả ổ đĩa.

- [ ] **Step 1:** Viết `scripts/spike-mcp.mts` (file `.mts`, không `tsx -e`): ghi `mcp.json`, chạy `claude -p "Liệt kê công cụ MCP bạn có, không gọi công cụ nào." --model haiku --max-turns 2 --output-format stream-json --verbose --mcp-config <f> --strict-mcp-config --setting-sources project --permission-mode bypassPermissions --disallowedTools mcp__desktop-commander__start_process`, đọc dòng `system`/`init` và in `mcp_servers` + `tools` (lọc `mcp__`). Chạy thêm biến thể không `--strict-mcp-config`.
- [ ] **Step 2:** Chạy: `npx tsx scripts/spike-mcp.mts` (xóa `ANTHROPIC_API_KEY` khỏi env như billing-guard). Ghi đầu ra rút gọn.
- [ ] **Step 3:** Ghi kết quả (a)–(e) vào `docs/SPIKE-RESULTS.md`. **Nếu (d) không đạt:** Task 3 chỉ hiển thị trạng thái connector (không cho tick) và `planMcp` bỏ nhánh `kind:"cli"`; ghi lại trong spec §1. **Nếu (e) không đạt:** UI Cấp quyền hiện cảnh báo "Desktop Commander có quyền toàn bộ ổ đĩa" thay cho giới hạn thư mục. **Nếu (b) đạt nhưng nuốt giá trị:** đặt `--mcp-config` ngay trước một cờ khác (test ở Task 4 đã kiểm).
- [ ] **Step 4:** Commit `docs: MCP spike results`.

---

### Task 1: `grants.ts` — tick → allowlist

**Files:** Create `src/core/grants.ts`; Test `tests/grants.test.ts`; Modify `src/core/permissions.ts`.

**Interfaces:**
- Consumes: `CODING_ENV_TOOLS` (permissions.ts), kiểu `McpServer` (Task 3; khai báo tạm bằng `import type` từ `./mcp-registry.js`, Task 1 và 3 dùng chung tên).
- Produces:
  ```ts
  export type McpAccess = "off" | "read" | "full";
  export interface ExtraDir { path: string; write: boolean }
  export interface Grants { fileWrite: boolean; web: boolean; cmdNode: boolean; cmdPython: boolean; cmdNative: boolean; cmdBasic: boolean; cmdInstall: boolean; gitRestore: boolean; anyProcess: boolean; extraDirs: ExtraDir[]; mcp: Record<string, McpAccess> }
  export const DEFAULT_GRANTS: Grants
  export function sanitizeGrants(raw: unknown): Grants
  export function validateExtraDir(p: string): string | null
  export function grantsToAllowedTools(g: Grants): string[]
  export function grantsAddDirs(g: Grants): string[]
  export function resolveGrants(project: unknown, appDefault: unknown): Grants
  export function mcpPrefix(name: string): string
  export interface McpPlan { config: { mcpServers: Record<string, unknown> } | null; allowed: string[]; disallowed: string[]; strict: boolean }
  export function planMcp(g: Grants, servers: McpServer[]): McpPlan
  ```
  và `buildCodingAllowedTools(o)` có thêm `grants?: Grants`.

- [ ] **Step 1: Viết test lỗi** — `tests/grants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CODING_ENV_TOOLS, buildCodingAllowedTools } from "../src/core/permissions.js";
import { DEFAULT_GRANTS, grantsAddDirs, grantsToAllowedTools, mcpPrefix, planMcp, resolveGrants, sanitizeGrants, validateExtraDir } from "../src/core/grants.js";
import type { McpServer } from "../src/core/mcp-registry.js";

const dc: McpServer = {
  id: "desktop-commander", name: "Desktop Commander", kind: "stdio", command: "cmd", args: ["/c", "npx", "-y", "x"], enabled: true,
  writeTools: ["write_file", "edit_block"], processTools: ["start_process"], blockedTools: ["set_config_value"],
};

describe("grants -> allowlist", () => {
  it("default grants reproduce CODING_ENV_TOOLS exactly", () => {
    expect(new Set(grantsToAllowedTools(DEFAULT_GRANTS))).toEqual(new Set(CODING_ENV_TOOLS));
  });
  it("unticking a group removes only its rules", () => {
    const out = grantsToAllowedTools({ ...DEFAULT_GRANTS, web: false, cmdNode: false });
    expect(out).not.toContain("WebSearch");
    expect(out).not.toContain("Bash(npm *)");
    expect(out).toContain("Bash(pytest*)");
  });
  it("extra dirs add scoped rules and --add-dir", () => {
    const g = { ...DEFAULT_GRANTS, extraDirs: [{ path: "D:\\Docs", write: false }, { path: "D:\\Out", write: true }] };
    const out = grantsToAllowedTools(g);
    expect(out).toContain("Read(D:/Docs/**)");
    expect(out).not.toContain("Edit(D:/Docs/**)");
    expect(out).toContain("Edit(D:/Out/**)");
    expect(out).toContain("Write(D:/Out/**)");
    expect(grantsAddDirs(g)).toEqual(["D:\\Docs", "D:\\Out"]);
  });
  it("buildCodingAllowedTools without grants is unchanged; fileWrite=false drops Edit/Write in the worktree", () => {
    const base = ["Agent", "Read", "Edit", "Write"];
    const o = { base, projectCommands: [], worktreePath: "D:\\wt\\r1", runDir: "D:\\runs\\r1" };
    const legacy = buildCodingAllowedTools(o);
    expect(legacy).toContain("Edit(D:/wt/r1/**)");
    const ro = buildCodingAllowedTools({ ...o, grants: { ...DEFAULT_GRANTS, fileWrite: false } });
    expect(ro).not.toContain("Edit(D:/wt/r1/**)");
    expect(ro).not.toContain("Write(D:/wt/r1/**)");
    expect(ro).toContain("Write(D:/runs/r1/notes/**)");
  });
});

describe("sanitizeGrants / resolveGrants / validateExtraDir", () => {
  it("fills defaults and drops junk", () => {
    const g = sanitizeGrants({ web: false, evil: true, mcp: { a: "full", b: "root" }, extraDirs: [{ path: "D:\\x", write: 1 }, { path: 5 }] });
    expect(g.web).toBe(false);
    expect(g.cmdNode).toBe(true);
    expect(g.mcp).toEqual({ a: "full" });
    expect(g.extraDirs).toEqual([{ path: "D:\\x", write: false }]);
    expect((g as unknown as Record<string, unknown>)["evil"]).toBeUndefined();
  });
  it("project grants win over app default, default over built-in", () => {
    expect(resolveGrants(null, { web: false }).web).toBe(false);
    expect(resolveGrants({ web: true }, { web: false }).web).toBe(true);
    expect(resolveGrants(null, null)).toEqual(DEFAULT_GRANTS);
  });
  it("rejects relative, drive-root and dotdot dirs", () => {
    expect(validateExtraDir("docs")).toMatch(/tuyệt đối/);
    expect(validateExtraDir("D:\\")).toMatch(/gốc/);
    expect(validateExtraDir("D:\\a\\..\\b")).toMatch(/\.\./);
    expect(validateExtraDir("D:\\Docs")).toBeNull();
  });
});

describe("planMcp", () => {
  it("off -> no config, no flags", () => {
    const p = planMcp(DEFAULT_GRANTS, [dc]);
    expect(p.config).toBeNull();
    expect(p.allowed).toEqual([]);
  });
  it("full blocks process tools and config tools unless anyProcess", () => {
    const g = { ...DEFAULT_GRANTS, mcp: { "desktop-commander": "full" as const } };
    const p = planMcp(g, [dc]);
    expect(p.strict).toBe(true);
    expect(p.allowed).toEqual(["mcp__desktop-commander"]);
    expect(p.disallowed).toEqual(expect.arrayContaining(["mcp__desktop-commander__start_process", "mcp__desktop-commander__set_config_value"]));
    expect(p.disallowed).not.toContain("mcp__desktop-commander__write_file");
    expect(p.config).toEqual({ mcpServers: { "desktop-commander": { command: "cmd", args: ["/c", "npx", "-y", "x"] } } });
    const open = planMcp({ ...g, anyProcess: true }, [dc]);
    expect(open.disallowed).not.toContain("mcp__desktop-commander__start_process");
    expect(open.disallowed).toContain("mcp__desktop-commander__set_config_value");
  });
  it("read also blocks write tools", () => {
    const p = planMcp({ ...DEFAULT_GRANTS, mcp: { "desktop-commander": "read" } }, [dc]);
    expect(p.disallowed).toEqual(expect.arrayContaining(["mcp__desktop-commander__write_file", "mcp__desktop-commander__edit_block"]));
  });
  it("cli servers: granted -> non-strict; not granted -> whole server denied", () => {
    const drive: McpServer = { id: "claude.ai Google Drive", name: "claude.ai Google Drive", kind: "cli", enabled: true };
    const slack: McpServer = { id: "plugin:design:slack", name: "plugin:design:slack", kind: "cli", enabled: true };
    const p = planMcp({ ...DEFAULT_GRANTS, mcp: { "claude.ai Google Drive": "full" } }, [drive, slack]);
    expect(p.strict).toBe(false);
    expect(p.config).toBeNull();
    expect(p.allowed).toEqual([mcpPrefix("claude.ai Google Drive")]);
    expect(p.disallowed).toContain("mcp__plugin_design_slack");
    expect(mcpPrefix("claude.ai Google Drive")).toBe("mcp__claude_ai_Google_Drive");
  });
});
```

- [ ] **Step 2:** `npx vitest run --maxWorkers=1 tests/grants.test.ts` → FAIL (module không tồn tại).
- [ ] **Step 3: Viết `src/core/grants.ts`:**

```ts
/** Per-environment permission ticks (spec 2026-11-09 §3). Pure functions, no I/O. */
import type { McpServer } from "./mcp-registry.js";

export type McpAccess = "off" | "read" | "full";
export interface ExtraDir { path: string; write: boolean }
export interface Grants {
  fileWrite: boolean; web: boolean;
  cmdNode: boolean; cmdPython: boolean; cmdNative: boolean; cmdBasic: boolean; cmdInstall: boolean; gitRestore: boolean;
  /** Let MCP "process" tools (Desktop Commander start_process…) run arbitrary commands. Bypasses deny rules: off by default. */
  anyProcess: boolean;
  extraDirs: ExtraDir[];
  mcp: Record<string, McpAccess>;
}

export const BOOL_KEYS = ["fileWrite", "web", "cmdNode", "cmdPython", "cmdNative", "cmdBasic", "cmdInstall", "gitRestore", "anyProcess"] as const;

export const DEFAULT_GRANTS: Grants = {
  fileWrite: true, web: true, cmdNode: true, cmdPython: true, cmdNative: true, cmdBasic: true, cmdInstall: true, gitRestore: true,
  anyProcess: false, extraDirs: [], mcp: {},
};

const b = (...names: string[]) => names.map((n) => `Bash(${n})`);

/** Rules of each group; their union with ALWAYS_RULES equals CODING_ENV_TOOLS (test-enforced). */
export const GROUP_RULES: Record<"web" | "cmdNode" | "cmdPython" | "cmdNative" | "cmdBasic" | "cmdInstall" | "gitRestore", string[]> = {
  web: ["WebSearch", "WebFetch"],
  cmdNode: b("npm *", "npx *", "pnpm *", "yarn *", "tsc*", "vitest*", "eslint*", "prettier*"),
  cmdPython: b("python *", "python3 *", "py *", "pytest*", "pip list*", "pip show*", "uv *"),
  cmdInstall: b("pip install*"),
  cmdNative: b("dotnet *", "cargo *", "go *", "make*"),
  cmdBasic: b("ls*", "dir*", "cat *", "type *", "head *", "tail *", "wc *", "find *", "grep *", "rg *", "echo *", "pwd*", "where *", "which *", "mkdir *", "cp *", "mv *", "touch *", "sort*", "diff *",
    "Get-ChildItem*", "Get-Content*", "Select-String*", "Test-Path*", "Get-Location*", "findstr *"),
  gitRestore: b("git stash*", "git restore*", "git reset*", "git checkout HEAD*"),
};
export const ALWAYS_RULES: string[] = [
  "TodoWrite",
  ...b("git mv*", "git blame*", "git tag*", "git describe*", "git --version*", "git version*", "claude auth status*",
    "powershell -NoProfile -File scripts/start.ps1*", "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1*", "powershell -NoProfile -File scripts/stop.ps1*",
    "git config --get*", "git config --list*", "git cherry-pick*"),
];

function slashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** null when valid, else a Vietnamese reason. */
export function validateExtraDir(p: string): string | null {
  const s = p.trim();
  if (!/^[A-Za-z]:[\\/]/.test(s) && !s.startsWith("/")) return `Thư mục phải là đường dẫn tuyệt đối: "${p}"`;
  if (s.split(/[\\/]/).includes("..")) return `Đường dẫn không được chứa "..": "${p}"`;
  if (/^[A-Za-z]:[\\/]*$/.test(s) || s === "/") return `Không cấp cả ổ đĩa gốc: "${p}"`;
  return null;
}

const ACCESS = new Set(["off", "read", "full"]);

export function sanitizeGrants(raw: unknown): Grants {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Grants = { ...DEFAULT_GRANTS, extraDirs: [], mcp: {} };
  for (const k of BOOL_KEYS) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  if (Array.isArray(r["extraDirs"])) {
    for (const d of r["extraDirs"] as unknown[]) {
      if (typeof d !== "object" || d === null) continue;
      const p = (d as Record<string, unknown>)["path"];
      if (typeof p !== "string" || validateExtraDir(p) !== null) continue;
      out.extraDirs.push({ path: p.trim(), write: (d as Record<string, unknown>)["write"] === true });
    }
  }
  if (typeof r["mcp"] === "object" && r["mcp"] !== null) {
    for (const [k, v] of Object.entries(r["mcp"] as Record<string, unknown>)) {
      if (k.length <= 100 && typeof v === "string" && ACCESS.has(v) && v !== "off") out.mcp[k] = v as McpAccess;
    }
  }
  return out;
}

/** Project grants (if any) win over the app-wide default profile, which wins over the built-in default. */
export function resolveGrants(project: unknown, appDefault: unknown): Grants {
  const hasProject = typeof project === "object" && project !== null && Object.keys(project).length > 0;
  return sanitizeGrants(hasProject ? project : appDefault);
}

/** Everything except Edit/Write/NotebookEdit in the worktree (those depend on `fileWrite`, handled in buildCodingAllowedTools). */
export function grantsToAllowedTools(g: Grants): string[] {
  const out = [...ALWAYS_RULES];
  for (const [k, rules] of Object.entries(GROUP_RULES)) if (g[k as keyof typeof GROUP_RULES]) out.push(...rules);
  for (const d of g.extraDirs) {
    const s = slashes(d.path);
    out.push(`Read(${s}/**)`, `Glob(${s}/**)`, `Grep(${s}/**)`);
    if (d.write) out.push(`Edit(${s}/**)`, `Write(${s}/**)`);
  }
  return out;
}

export function grantsAddDirs(g: Grants): string[] {
  return g.extraDirs.map((d) => d.path);
}

/** Claude Code names MCP tools `mcp__<server with non [A-Za-z0-9_-] replaced by _>__<tool>`. */
export function mcpPrefix(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export interface McpPlan { config: { mcpServers: Record<string, unknown> } | null; allowed: string[]; disallowed: string[]; strict: boolean }

function configEntry(s: McpServer): Record<string, unknown> {
  if (s.kind === "http") return { type: "http", url: s.url, ...(s.headers && Object.keys(s.headers).length ? { headers: s.headers } : {}) };
  return { command: s.command, ...(s.args?.length ? { args: s.args } : {}), ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}) };
}

/**
 * Turn the MCP ticks into `--mcp-config` content and allow/deny rules. Under bypassPermissions only the deny rules
 * actually restrict, so "read" and "no process" are expressed as `--disallowedTools` on the server's known tools.
 * `kind:"cli"` servers (plugin / claude.ai connectors) are managed by the CLI: not written to mcp.json, and every
 * non-granted one is denied as a whole so it cannot be used by accident when strict mode is off.
 */
export function planMcp(g: Grants, servers: McpServer[]): McpPlan {
  const cfg: Record<string, unknown> = {};
  const allowed: string[] = [];
  const disallowed: string[] = [];
  let hasCli = false;
  for (const s of servers) {
    const access = g.mcp[s.id] ?? "off";
    const prefix = mcpPrefix(s.id);
    if (!s.enabled || access === "off") {
      if (s.kind === "cli") disallowed.push(prefix);
      continue;
    }
    if (s.kind === "cli") hasCli = true;
    else cfg[s.id] = configEntry(s);
    allowed.push(prefix);
    for (const t of s.blockedTools ?? []) disallowed.push(`${prefix}__${t}`);
    if (!g.anyProcess) for (const t of s.processTools ?? []) disallowed.push(`${prefix}__${t}`);
    if (access === "read") for (const t of s.writeTools ?? []) disallowed.push(`${prefix}__${t}`);
  }
  const granted = allowed.length > 0;
  return { config: Object.keys(cfg).length ? { mcpServers: cfg } : null, allowed, disallowed: granted ? disallowed : [], strict: !hasCli };
}
```

(Khi không tick máy chủ nào, `disallowed` để rỗng nên run cũ không đổi hành vi.)

- [ ] **Step 4: Sửa `src/core/permissions.ts`** — thêm import và tham số:

```ts
import { grantsToAllowedTools, type Grants } from "./grants.js";
// trong BuildAllowedToolsOptions:
  /** Per-environment ticks; absent = legacy behaviour (CODING_ENV_TOOLS, Edit/Write allowed). */
  grants?: Grants;
// trong buildCodingAllowedTools, thay phần base + NotebookEdit + CODING_ENV_TOOLS:
  const fileWrite = o.grants ? o.grants.fileWrite : true;
  for (const t of o.base) {
    if (t === "Edit") { if (fileWrite) push(`Edit(${wt}/**)`); }
    else if (t === "Write") {
      if (fileWrite) push(`Write(${wt}/**)`);
      push(`Write(${notes}/**)`);
    } else push(t);
  }
  if (fileWrite) push(`NotebookEdit(${wt}/**)`);
  for (const t of o.grants ? grantsToAllowedTools(o.grants) : CODING_ENV_TOOLS) push(t);
```
(Circular import: `grants.ts` chỉ `import type` từ mcp-registry, và không import permissions; `permissions.ts` import grants — không vòng.)

- [ ] **Step 5:** `npx vitest run --maxWorkers=1 tests/grants.test.ts tests/permissions.test.ts` → PASS cả hai.
- [ ] **Step 6:** Commit `feat(grants): per-environment permission ticks to allowlist and MCP plan`.

---

### Task 2: Lưu grants (DB + app settings + manager)

**Files:** Modify `src/core/run-store.ts`, `src/core/app-settings.ts`, `src/core/run-manager.ts`; Test `tests/grants-store.test.ts`.

**Interfaces:**
- Consumes: `sanitizeGrants`, `Grants` (Task 1).
- Produces: `RunStore.getProjectGrants(name): Grants | null`, `RunStore.setProjectGrants(name, g: Grants | null): void`; `AppSettings.defaultGrants?: Grants`, `AppSettings.outputDir?: string`; `RunManager.getGrants(project: string | null): { grants: Grants; source: "project" | "default" | "builtin" }`, `RunManager.setGrants(project: string | "__default__", raw: unknown): Grants`.

- [ ] **Step 1: Test lỗi** — `tests/grants-store.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../src/core/run-store.js";
import { loadAppSettings, saveAppSettings } from "../src/core/app-settings.js";
import { DEFAULT_GRANTS } from "../src/core/grants.js";

describe("project grants", () => {
  it("round-trips and null means 'use default'", () => {
    const s = new RunStore(":memory:");
    s.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(s.getProjectGrants("p")).toBeNull();
    s.setProjectGrants("p", { ...DEFAULT_GRANTS, web: false });
    expect(s.getProjectGrants("p")?.web).toBe(false);
    s.setProjectGrants("p", null);
    expect(s.getProjectGrants("p")).toBeNull();
  });
  it("upsertProject keeps existing grants", () => {
    const s = new RunStore(":memory:");
    s.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: [] });
    s.setProjectGrants("p", { ...DEFAULT_GRANTS, cmdNode: false });
    s.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: ["Bash(x*)"] });
    expect(s.getProjectGrants("p")?.cmdNode).toBe(false);
  });
});

describe("app settings: outputDir + defaultGrants", () => {
  it("persists and sanitizes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-as-"));
    saveAppSettings(dir, { outputDir: "D:\\Out", defaultGrants: { ...DEFAULT_GRANTS, web: false } });
    const s = loadAppSettings(dir);
    expect(s.outputDir).toBe("D:\\Out");
    expect(s.defaultGrants?.web).toBe(false);
  });
});
```

- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: `run-store.ts`:** trong constructor, sau khối migration `runs`, thêm:

```ts
    const pcols = (this.db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
    if (!pcols.includes("grants")) this.db.exec("ALTER TABLE projects ADD COLUMN grants TEXT");
```
`upsertProject` dùng `ON CONFLICT(name) DO UPDATE SET …` không đụng cột `grants` nên giữ nguyên. Thêm hai phương thức (cuối class, trước `getArtifacts` hoặc sau):

```ts
  getProjectGrants(name: string): Grants | null {
    const r = this.db.prepare("SELECT grants FROM projects WHERE name = ?").get(name) as Row | undefined;
    const raw = r?.["grants"];
    if (typeof raw !== "string" || !raw) return null;
    try { return sanitizeGrants(JSON.parse(raw)); } catch { return null; }
  }

  setProjectGrants(name: string, g: Grants | null): void {
    this.db.prepare("UPDATE projects SET grants = ? WHERE name = ?").run(g ? JSON.stringify(g) : null, name);
  }
```
Thêm `import { sanitizeGrants, type Grants } from "./grants.js";` đầu file.

- [ ] **Step 4: `app-settings.ts`:** thêm vào `AppSettings`: `outputDir?: string; defaultGrants?: Grants;`; trong `loadAppSettings`: `if (typeof raw["outputDir"] === "string" && raw["outputDir"]) out.outputDir = raw["outputDir"] as string; if (raw["defaultGrants"] && typeof raw["defaultGrants"] === "object") out.defaultGrants = sanitizeGrants(raw["defaultGrants"]);` (import `sanitizeGrants, type Grants` từ `./grants.js`). `saveAppSettings` không cần đổi (spread).
- [ ] **Step 5: `run-manager.ts`** — thêm (gần `tuning()`):

```ts
  /** Effective grants for an environment (project ticks, else the app default profile, else the built-in default). */
  getGrants(project: string | null): { grants: Grants; source: "project" | "default" | "builtin" } {
    const own = project ? this.store.getProjectGrants(project) : null;
    if (own) return { grants: own, source: "project" };
    const def = loadAppSettings(this.opts.config.dataDir).defaultGrants;
    return def ? { grants: def, source: "default" } : { grants: sanitizeGrants({}), source: "builtin" };
  }

  /** Save ticks for one environment, or the default profile when `project` is "__default__". Extra dirs must exist. */
  setGrants(project: string, raw: unknown): Grants {
    const g = sanitizeGrants(raw);
    for (const d of g.extraDirs) {
      if (!fs.existsSync(d.path) || !fs.statSync(d.path).isDirectory()) throw new Error(`Thư mục không tồn tại: ${d.path}`);
    }
    if (project === "__default__") saveAppSettings(this.opts.config.dataDir, { defaultGrants: g });
    else {
      if (!this.store.getProject(project)) throw new Error("Không tìm thấy môi trường.");
      this.store.setProjectGrants(project, g);
    }
    return g;
  }
```
(import `sanitizeGrants, type Grants` từ `./grants.js`; `fs`, `loadAppSettings`, `saveAppSettings` đã có trong file.)

- [ ] **Step 6:** Chạy test → PASS; `npm run typecheck`.
- [ ] **Step 7:** Commit `feat(grants): persist per-environment grants and default profile`.

---

### Task 3: Registry MCP + probe + parse `claude mcp list`

**Files:** Create `src/core/mcp-registry.ts`, `src/core/mcp-probe.ts`; Test `tests/mcp-registry.test.ts`, `tests/mcp-probe.test.ts`; Create `fixtures/fake-mcp-server.mjs`.

**Interfaces:**
- Produces:
  ```ts
  export type McpKind = "stdio" | "http" | "cli";
  export interface McpServer { id: string; name: string; kind: McpKind; command?: string; args?: string[]; env?: Record<string,string>; url?: string; headers?: Record<string,string>; enabled: boolean; preset?: string; writeTools?: string[]; processTools?: string[]; blockedTools?: string[] }
  export const MCP_PRESETS: Array<Omit<McpServer,"enabled">>
  export function validateMcpServer(raw: unknown): McpServer          // throws Error(Vietnamese)
  export function loadMcpServers(dataDir: string): McpServer[]
  export function saveMcpServers(dataDir: string, list: McpServer[]): void
  export type CliMcpStatus = "connected" | "needs_auth" | "failed" | "not_configured";
  export interface CliMcpItem { name: string; target: string; status: CliMcpStatus; detail?: string }
  export function parseMcpList(stdout: string): CliMcpItem[]
  export function cliItemsToServers(items: CliMcpItem[]): McpServer[]   // kind "cli", enabled = status !== "not_configured"
  export function probeMcp(s: McpServer, timeoutMs?: number): Promise<{ ok: boolean; tools: string[]; error?: string }>
  ```

- [ ] **Step 1: Test lỗi** — `tests/mcp-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MCP_PRESETS, cliItemsToServers, parseMcpList, validateMcpServer } from "../src/core/mcp-registry.js";

const SAMPLE = [
  "Checking MCP server health…",
  "",
  "plugin:pdf-viewer:pdf: npx -y @modelcontextprotocol/server-pdf --stdio - √ Connected",
  "plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication",
  "plugin:design:google calendar:  (HTTP) - - Not configured",
  "plugin:data:definite: https://api.definite.app/v3/mcp/http (HTTP) - × Failed to connect — ECONNRESET: boom",
].join("\n");

describe("parseMcpList", () => {
  it("parses name, target and the four statuses, skipping noise", () => {
    const items = parseMcpList(SAMPLE);
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ["plugin:pdf-viewer:pdf", "connected"],
      ["plugin:design:slack", "needs_auth"],
      ["plugin:design:google calendar", "not_configured"],
      ["plugin:data:definite", "failed"],
    ]);
    expect(items[1]!.target).toBe("https://mcp.slack.com/mcp (HTTP)");
    expect(items[3]!.detail).toMatch(/ECONNRESET/);
  });
  it("maps to cli servers; not_configured ones are disabled", () => {
    const s = cliItemsToServers(parseMcpList(SAMPLE));
    expect(s.every((x) => x.kind === "cli")).toBe(true);
    expect(s.find((x) => x.id === "plugin:design:google calendar")!.enabled).toBe(false);
  });
});

describe("validateMcpServer", () => {
  it("accepts the Desktop Commander preset", () => {
    const p = MCP_PRESETS.find((x) => x.id === "desktop-commander")!;
    expect(validateMcpServer({ ...p, enabled: true }).processTools).toContain("start_process");
    expect(p.blockedTools).toContain("set_config_value");
  });
  it("rejects bad ids, missing command/url, non-http urls, cli kind", () => {
    expect(() => validateMcpServer({ id: "Bad Id", name: "x", kind: "stdio", command: "a" })).toThrow(/id/);
    expect(() => validateMcpServer({ id: "a", name: "x", kind: "stdio" })).toThrow(/lệnh/);
    expect(() => validateMcpServer({ id: "a", name: "x", kind: "http", url: "ftp://x" })).toThrow(/URL/);
    expect(() => validateMcpServer({ id: "a", name: "x", kind: "cli" })).toThrow(/kiểu/);
  });
  it("defaults enabled to true and keeps only string env values", () => {
    const s = validateMcpServer({ id: "a", name: "A", kind: "stdio", command: "node", env: { K: "v", N: 1 } });
    expect(s.enabled).toBe(true);
    expect(s.env).toEqual({ K: "v" });
  });
});
```

`fixtures/fake-mcp-server.mjs` (máy chủ MCP giả, đọc JSON dòng trên stdin):

```js
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "read_file" }, { name: "write_file" }] } });
});
```

`tests/mcp-probe.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeMcp } from "../src/core/mcp-probe.js";

const FAKE = path.resolve(__dirname, "..", "fixtures", "fake-mcp-server.mjs");

describe("probeMcp", () => {
  it("lists tools of a stdio server", async () => {
    const r = await probeMcp({ id: "f", name: "f", kind: "stdio", command: process.execPath, args: [FAKE], enabled: true }, 15_000);
    expect(r).toEqual({ ok: true, tools: ["read_file", "write_file"] });
  });
  it("reports a spawn failure in Vietnamese", async () => {
    const r = await probeMcp({ id: "f", name: "f", kind: "stdio", command: "no-such-binary-xyz", enabled: true }, 5_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Không/);
  });
  it("refuses http/cli servers", async () => {
    const r = await probeMcp({ id: "h", name: "h", kind: "http", url: "https://x", enabled: true });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: `src/core/mcp-registry.ts`:**

```ts
import fs from "node:fs";
import path from "node:path";

export type McpKind = "stdio" | "http" | "cli";
export interface McpServer {
  id: string; name: string; kind: McpKind;
  command?: string; args?: string[]; env?: Record<string, string>;
  url?: string; headers?: Record<string, string>;
  enabled: boolean; preset?: string;
  /** Tool names (without the mcp__ prefix) used by Grants to express "read only" / "no process". */
  writeTools?: string[]; processTools?: string[]; blockedTools?: string[];
}

export const MCP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const MCP_PRESETS: Array<Omit<McpServer, "enabled">> = [
  {
    id: "desktop-commander", name: "Desktop Commander", kind: "stdio", preset: "desktop-commander",
    // On Windows `npx` is npx.cmd: Claude Code needs `cmd /c` to start it.
    command: "cmd", args: ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"],
    writeTools: ["write_file", "edit_block", "create_directory", "move_file", "write_pdf"],
    processTools: ["start_process", "interact_with_process", "read_process_output", "force_terminate", "kill_process", "list_processes", "list_sessions"],
    blockedTools: ["set_config_value"],
  },
];

const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
const strMap = (v: unknown): Record<string, string> | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
  return out;
};

/** Validate one registry entry (kind "cli" entries are never stored). Throws a Vietnamese message. */
export function validateMcpServer(raw: unknown): McpServer {
  if (typeof raw !== "object" || raw === null) throw new Error("Dữ liệu máy chủ MCP không hợp lệ.");
  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  if (!MCP_ID_RE.test(id)) throw new Error("id máy chủ MCP chỉ gồm chữ thường, số, gạch ngang/dưới (tối đa 40 ký tự).");
  const name = typeof r["name"] === "string" ? r["name"].trim() : "";
  if (!name) throw new Error("Thiếu tên máy chủ MCP.");
  const kind = r["kind"];
  if (kind !== "stdio" && kind !== "http") throw new Error("Chỉ lưu được kiểu stdio hoặc http (connector claude.ai/plugin do Claude quản lý).");
  const out: McpServer = { id, name, kind, enabled: r["enabled"] !== false };
  if (kind === "stdio") {
    const command = typeof r["command"] === "string" ? r["command"].trim() : "";
    if (!command) throw new Error("Máy chủ stdio cần lệnh khởi động.");
    out.command = command;
    const args = strList(r["args"]);
    if (args) out.args = args;
    const env = strMap(r["env"]);
    if (env && Object.keys(env).length) out.env = env;
  } else {
    const url = typeof r["url"] === "string" ? r["url"].trim() : "";
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("URL máy chủ MCP phải bắt đầu bằng http:// hoặc https://.");
    out.url = url;
    const headers = strMap(r["headers"]);
    if (headers && Object.keys(headers).length) out.headers = headers;
  }
  if (typeof r["preset"] === "string") out.preset = r["preset"];
  for (const k of ["writeTools", "processTools", "blockedTools"] as const) {
    const l = strList(r[k]);
    if (l) out[k] = l;
  }
  return out;
}

function file(dataDir: string): string {
  return path.join(dataDir, "mcp-servers.json");
}

export function loadMcpServers(dataDir: string): McpServer[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(dataDir), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: McpServer[] = [];
    for (const x of raw) {
      try { out.push(validateMcpServer(x)); } catch { /* skip a hand-broken entry */ }
    }
    return out;
  } catch {
    return [];
  }
}

export function saveMcpServers(dataDir: string, list: McpServer[]): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(dataDir), JSON.stringify(list, null, 2), "utf8");
}

export type CliMcpStatus = "connected" | "needs_auth" | "failed" | "not_configured";
export interface CliMcpItem { name: string; target: string; status: CliMcpStatus; detail?: string }

const TAIL_RE = / - (?:\S+ )?(Connected|Needs authentication|Failed to connect.*|Not configured)$/;

/** Parse `claude mcp list` (lines `<name>: <target> - <glyph> <status>`); noise lines are skipped. */
export function parseMcpList(stdout: string): CliMcpItem[] {
  const items: CliMcpItem[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = TAIL_RE.exec(line);
    const sep = line.indexOf(": ");
    if (!m || sep <= 0) continue;
    const tail = m[1]!;
    const status: CliMcpStatus = tail === "Connected" ? "connected" : tail === "Needs authentication" ? "needs_auth" : tail === "Not configured" ? "not_configured" : "failed";
    const item: CliMcpItem = { name: line.slice(0, sep), target: line.slice(sep + 2, m.index).trim(), status };
    if (status === "failed") item.detail = tail.replace(/^Failed to connect\s*[—-]?\s*/, "");
    items.push(item);
  }
  return items;
}

/** CLI-managed servers as registry rows (used by planMcp to deny the ones that are not granted). */
export function cliItemsToServers(items: CliMcpItem[]): McpServer[] {
  return items.map((i) => ({ id: i.name, name: i.name, kind: "cli" as const, enabled: i.status !== "not_configured" }));
}
```

- [ ] **Step 4: `src/core/mcp-probe.ts`:**

```ts
import { spawn } from "node:child_process";
import type { McpServer } from "./mcp-registry.js";

export interface ProbeResult { ok: boolean; tools: string[]; error?: string }

/** Start a stdio MCP server, run `initialize` + `tools/list` over newline-delimited JSON-RPC, then kill it. No shell. */
export function probeMcp(s: McpServer, timeoutMs = 90_000): Promise<ProbeResult> {
  if (s.kind !== "stdio" || !s.command) return Promise.resolve({ ok: false, tools: [], error: "Chỉ kiểm tra được máy chủ stdio." });
  return new Promise((resolve) => {
    let done = false;
    const child = spawn(s.command!, s.args ?? [], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(s.env ?? {}) } });
    const finish = (r: ProbeResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, tools: [], error: "Hết thời gian chờ máy chủ MCP phản hồi." }), timeoutMs);
    let buf = "";
    const send = (o: unknown): void => { child.stdin.write(JSON.stringify(o) + "\n"); };
    child.on("error", (e) => finish({ ok: false, tools: [], error: `Không khởi động được máy chủ: ${e.message}` }));
    child.on("exit", () => finish({ ok: false, tools: [], error: "Máy chủ MCP thoát trước khi trả lời." }));
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m: { id?: number; result?: { tools?: Array<{ name?: string }> } };
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (m.id === 2) {
          finish({ ok: true, tools: (m.result?.tools ?? []).map((t) => String(t.name)) });
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tnf-controller", version: "1" } } });
  });
}
```

- [ ] **Step 5:** `npx vitest run --maxWorkers=1 tests/mcp-registry.test.ts tests/mcp-probe.test.ts` → PASS.
- [ ] **Step 6:** Commit `feat(mcp): registry, claude mcp list parser and stdio probe`.

---

### Task 4: Nối grants + MCP vào run coding

**Files:** Modify `src/core/run-manager.ts` (khoảng dòng 1216–1252), `src/core/app-settings.ts` (snapshot CLI); Create `src/core/mcp-cli.ts`; Test `tests/mcp-run-wiring.test.ts`.

**Interfaces:**
- Consumes: `resolveGrants`, `grantsToAllowedTools`, `grantsAddDirs`, `planMcp`, `McpPlan` (Task 1); `loadMcpServers`, `cliItemsToServers`, `parseMcpList`, `CliMcpItem` (Task 3); `RunManager.getGrants` (Task 2).
- Produces:
  ```ts
  // src/core/mcp-cli.ts
  export function readCliSnapshot(dataDir: string): { at: number; items: CliMcpItem[] } | null;
  export function runClaudeMcpList(claudePath: string, env: NodeJS.ProcessEnv, timeoutMs?: number): Promise<CliMcpItem[]>;
  export function writeCliSnapshot(dataDir: string, items: CliMcpItem[]): { at: number; items: CliMcpItem[] };
  // run-manager.ts
  export function mcpRunArgs(plan: McpPlan, grants: Grants, runDir: string): { extraArgs: string[]; disallowed: string[]; allowed: string[] }  // writes <runDir>/mcp.json when plan.config
  ```

- [ ] **Step 1: Test lỗi** — `tests/mcp-run-wiring.test.ts` (đặt `mcpRunArgs` trong `src/core/mcp-cli.ts` để test không cần dựng manager):

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GRANTS, planMcp } from "../src/core/grants.js";
import { mcpRunArgs, readCliSnapshot, writeCliSnapshot } from "../src/core/mcp-cli.js";
import { MCP_PRESETS } from "../src/core/mcp-registry.js";

const dc = { ...MCP_PRESETS[0]!, enabled: true };

describe("mcpRunArgs", () => {
  it("nothing granted -> no extra args, no file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const r = mcpRunArgs(planMcp(DEFAULT_GRANTS, [dc]), DEFAULT_GRANTS, dir);
    expect(r).toEqual({ extraArgs: [], disallowed: [], allowed: [] });
    expect(fs.existsSync(path.join(dir, "mcp.json"))).toBe(false);
  });
  it("granted -> mcp.json, strict flag, --mcp-config followed by a flag (variadic safety), add-dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const g = { ...DEFAULT_GRANTS, mcp: { "desktop-commander": "full" as const }, extraDirs: [{ path: "D:\\Docs", write: false }] };
    const r = mcpRunArgs(planMcp(g, [dc]), g, dir);
    const i = r.extraArgs.indexOf("--mcp-config");
    expect(r.extraArgs[i + 1]).toBe(path.join(dir, "mcp.json"));
    expect(r.extraArgs[i + 2]).toMatch(/^--/);
    expect(r.extraArgs).toContain("--strict-mcp-config");
    expect(r.extraArgs).toEqual(expect.arrayContaining(["--add-dir", "D:\\Docs"]));
    expect(JSON.parse(fs.readFileSync(path.join(dir, "mcp.json"), "utf8")).mcpServers["desktop-commander"].command).toBe("cmd");
    expect(r.allowed).toEqual(["mcp__desktop-commander"]);
    expect(r.disallowed).toContain("mcp__desktop-commander__start_process");
  });
  it("only extra dirs -> still emits --add-dir without mcp flags", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const g = { ...DEFAULT_GRANTS, extraDirs: [{ path: "D:\\Docs", write: true }] };
    expect(mcpRunArgs(planMcp(g, [dc]), g, dir).extraArgs).toEqual(["--add-dir", "D:\\Docs"]);
  });
});

describe("cli snapshot", () => {
  it("writes and reads back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-snap-"));
    expect(readCliSnapshot(dir)).toBeNull();
    writeCliSnapshot(dir, [{ name: "a", target: "t", status: "connected" }]);
    expect(readCliSnapshot(dir)?.items[0]?.name).toBe("a");
  });
});
```

- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: `src/core/mcp-cli.ts`:**

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { grantsAddDirs, type Grants, type McpPlan } from "./grants.js";
import { parseMcpList, type CliMcpItem } from "./mcp-registry.js";

const snapFile = (dataDir: string): string => path.join(dataDir, "mcp-cli.json");

export function readCliSnapshot(dataDir: string): { at: number; items: CliMcpItem[] } | null {
  try {
    const v = JSON.parse(fs.readFileSync(snapFile(dataDir), "utf8")) as { at?: number; items?: CliMcpItem[] };
    return typeof v.at === "number" && Array.isArray(v.items) ? { at: v.at, items: v.items } : null;
  } catch {
    return null;
  }
}

export function writeCliSnapshot(dataDir: string, items: CliMcpItem[]): { at: number; items: CliMcpItem[] } {
  const snap = { at: Date.now(), items };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(snapFile(dataDir), JSON.stringify(snap, null, 2), "utf8");
  return snap;
}

/** `claude mcp list` (slow: it health-checks every server). Env must already be stripped of API keys by the caller. */
export function runClaudeMcpList(claudePath: string, env: NodeJS.ProcessEnv, timeoutMs = 90_000): Promise<CliMcpItem[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudePath, ["mcp", "list"], { shell: false, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("`claude mcp list` quá thời gian chờ.")); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Không chạy được claude: ${e.message}`)); });
    child.on("exit", () => { clearTimeout(timer); resolve(parseMcpList(out)); });
  });
}

/**
 * Extra CLI args for one coding run. `--mcp-config` is variadic, so it is always followed by another flag.
 * Writes `<runDir>/mcp.json` only when a registry server is granted.
 */
export function mcpRunArgs(plan: McpPlan, grants: Grants, runDir: string): { extraArgs: string[]; disallowed: string[]; allowed: string[] } {
  const extraArgs: string[] = [];
  if (plan.config) {
    const f = path.join(runDir, "mcp.json");
    fs.writeFileSync(f, JSON.stringify(plan.config, null, 2), "utf8");
    extraArgs.push("--mcp-config", f);
    if (plan.strict) extraArgs.push("--strict-mcp-config");
  }
  for (const d of grantsAddDirs(grants)) extraArgs.push("--add-dir", d);
  return { extraArgs, disallowed: plan.disallowed, allowed: plan.allowed };
}
```
`--mcp-config` là tham số variadic nên giá trị theo sau phải là một cờ khác. Khi strict, `--strict-mcp-config` đứng ngay sau. Khi không strict (có connector), cờ đứng sau là phần tử đầu của `kd.extraArgs` (`--setting-sources`), vì ở Step 4 `mcpExtra` được đặt **trước** `kd.extraArgs`. Thêm vào `tests/mcp-run-wiring.test.ts` một ca khẳng định `defaults.coding.extraArgs[0]` trong `config/controller.json` khớp `/^--/`.

- [ ] **Step 4: `run-manager.ts`.** Thay khối `let allowedTools …` của nhánh coding và `options` như sau.

```ts
    let allowedTools = input.allowedTools ?? kd.allowedTools;
    let mcpExtra: string[] = [];
    let mcpDisallowed: string[] = [];
    if (coding) {
      const { grants } = this.getGrants(coding.project.name);
      allowedTools = buildCodingAllowedTools({ base: allowedTools, projectCommands: coding.project.allowed_commands, worktreePath: coding.worktreePath, runDir, skills, grants });
      const cli = readCliSnapshot(this.opts.config.dataDir)?.items ?? [];
      const plan = planMcp(grants, [...loadMcpServers(this.opts.config.dataDir), ...cliItemsToServers(cli)]);
      const m = mcpRunArgs(plan, grants, runDir);
      mcpExtra = m.extraArgs;
      mcpDisallowed = m.disallowed;
      for (const t of m.allowed) if (!allowedTools.includes(t)) allowedTools.push(t);
      if (input.scout === true) {
        for (const t of buildScoutWebTools()) if (!allowedTools.includes(t)) allowedTools.push(t);
      }
      env = { ...env, ...AGENT_GIT_ENV };
    } else if (readOnly) {
```
Trong `options`:
```ts
      disallowedTools: readOnly ? [...SPLITTER_DISALLOWED_TOOLS] : [...kd.disallowedTools, ...mcpDisallowed].length ? [...kd.disallowedTools, ...mcpDisallowed] : undefined,
      …
      extraArgs: readOnly ? [...] : [...mcpExtra, ...kd.extraArgs],
```
Thêm import `planMcp` (grants.js), `mcpRunArgs, readCliSnapshot` (mcp-cli.js), `loadMcpServers, cliItemsToServers` (mcp-registry.js). Nếu `kd.extraArgs` có kiểu `string[] | undefined`, dùng `...(kd.extraArgs ?? [])`.

- [ ] **Step 5:** Chạy test mới + `tests/permissions.test.ts` + một test run coding sẵn có (tìm bằng `Glob tests/*coding*.test.ts`) → PASS. `npm run typecheck`.
- [ ] **Step 6:** Commit `feat(mcp): wire grants and MCP servers into coding runs`.

---

### Task 5: Thư mục lưu tệp (`outputs.ts` + đồng bộ + mở)

**Files:** Create `src/core/outputs.ts`; Modify `src/core/run-manager.ts`; Test `tests/outputs.test.ts`.

**Interfaces:**
- Consumes: `loadAppSettings`, `saveAppSettings` (Task 2), `RunStore.getArtifacts/scanArtifacts`.
- Produces:
  ```ts
  export function defaultOutputDir(workspaceDir: string): string
  export function validateOutputDir(p: unknown): string            // throws Vietnamese; creates the dir
  export function resolveInside(base: string, rel: string): string | null
  export function syncRunOutputs(runDir: string, outDir: string, runId: string, artifacts: Array<{ rel_path: string }>): number
  export function explorerArgs(target: string, selectFile: boolean): string[]
  // RunManager
  outputDir(): string;  setOutputDir(p: string): string;  syncOutputs(runId: string): number;  openOutput(runId: string, rel?: string): string;  saveOutputFile(group: string, name: string, data: Buffer): string
  ```
  `ManagerOptions.openPath?: (args: { dir: string; select?: string }) => void` (hook test).

- [ ] **Step 1: Test lỗi** — `tests/outputs.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOutputDir, explorerArgs, resolveInside, syncRunOutputs, validateOutputDir } from "../src/core/outputs.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-out-"));

describe("validateOutputDir", () => {
  it("creates an absolute ASCII dir", () => {
    const d = path.join(tmp(), "outputs");
    expect(validateOutputDir(d)).toBe(path.resolve(d));
    expect(fs.statSync(d).isDirectory()).toBe(true);
  });
  it("rejects relative, non-ASCII and dotdot paths", () => {
    expect(() => validateOutputDir("rel/dir")).toThrow(/tuyệt đối/);
    expect(() => validateOutputDir(path.join(tmp(), "Tài liệu"))).toThrow(/ASCII|không dấu/);
    expect(() => validateOutputDir(path.join(tmp(), "a", "..", "b"))).toThrow(/\.\./);
    expect(() => validateOutputDir(42)).toThrow();
  });
});

describe("resolveInside / explorerArgs / defaultOutputDir", () => {
  it("blocks traversal", () => {
    const base = tmp();
    expect(resolveInside(base, "a/b.txt")).toBe(path.join(base, "a", "b.txt"));
    expect(resolveInside(base, "../x")).toBeNull();
  });
  it("builds explorer args", () => {
    expect(explorerArgs("D:\\o\\r1", false)).toEqual(["D:\\o\\r1"]);
    expect(explorerArgs("D:\\o\\r1\\a b.docx", true)).toEqual(['/select,"D:\\o\\r1\\a b.docx"']);
  });
  it("defaults under the workspace", () => {
    expect(defaultOutputDir("D:\\ws")).toBe(path.join("D:\\ws", "outputs"));
  });
});

describe("syncRunOutputs", () => {
  it("copies artifacts, is idempotent, keeps sources", () => {
    const run = tmp();
    const out = tmp();
    fs.mkdirSync(path.join(run, "notes"));
    fs.writeFileSync(path.join(run, "report.md"), "R");
    fs.writeFileSync(path.join(run, "notes", "a.md"), "A");
    const arts = [{ rel_path: "report.md" }, { rel_path: "notes/a.md" }];
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(2);
    expect(fs.readFileSync(path.join(out, "r1", "notes", "a.md"), "utf8")).toBe("A");
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(0);
    fs.writeFileSync(path.join(run, "report.md"), "R2");
    expect(syncRunOutputs(run, out, "r1", arts)).toBe(1);
    expect(fs.existsSync(path.join(run, "report.md"))).toBe(true);
  });
  it("ignores artifacts that escape the run dir", () => {
    const run = tmp();
    const out = tmp();
    expect(syncRunOutputs(run, out, "r1", [{ rel_path: "../../etc/x" }])).toBe(0);
  });
});
```

- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: `src/core/outputs.ts`:**

```ts
import fs from "node:fs";
import path from "node:path";

export function defaultOutputDir(workspaceDir: string): string {
  return path.join(workspaceDir, "outputs");
}

/** Absolute, ASCII (CLAUDE.md rule 10), no `..`; creates the directory and proves it is writable. Returns the resolved path. */
export function validateOutputDir(p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("Thiếu đường dẫn thư mục lưu tệp.");
  const s = p.trim();
  if (!path.isAbsolute(s)) throw new Error("Thư mục lưu tệp phải là đường dẫn tuyệt đối.");
  if (s.split(/[\\/]/).includes("..")) throw new Error('Đường dẫn không được chứa "..".');
  if (!/^[\x20-\x7E]+$/.test(s)) throw new Error("Đường dẫn chỉ nên dùng ký tự ASCII không dấu (quy ước của app).");
  const abs = path.resolve(s);
  try {
    fs.mkdirSync(abs, { recursive: true });
    const probe = path.join(abs, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
  } catch (e) {
    throw new Error(`Không ghi được vào thư mục này: ${e instanceof Error ? e.message : String(e)}`);
  }
  return abs;
}

export function resolveInside(base: string, rel: string): string | null {
  const abs = path.resolve(base, rel);
  const root = path.resolve(base) + path.sep;
  return abs.startsWith(root) ? abs : null;
}

/** Copy each artifact of a run to `<outDir>/<runId>/<rel>`; only newer/different files are copied. Returns the number copied. */
export function syncRunOutputs(runDir: string, outDir: string, runId: string, artifacts: Array<{ rel_path: string }>): number {
  const destRoot = path.join(outDir, runId);
  let copied = 0;
  for (const a of artifacts) {
    const src = resolveInside(runDir, a.rel_path);
    const dst = resolveInside(destRoot, a.rel_path);
    if (!src || !dst || !fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const s = fs.statSync(src);
    if (fs.existsSync(dst)) {
      const d = fs.statSync(dst);
      if (d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  return copied;
}

/** Explorer arguments: a folder, or `/select,"<file>"` to highlight one file (needs windowsVerbatimArguments). */
export function explorerArgs(target: string, selectFile: boolean): string[] {
  return selectFile ? [`/select,"${target}"`] : [target];
}
```

- [ ] **Step 4: `run-manager.ts`** — thêm vào `ManagerOptions`: `openPath?: (a: { dir: string; select?: string }) => void;` và hàm mặc định cạnh `defaultOpenDirectory`:

```ts
function defaultOpenPath(a: { dir: string; select?: string }): void {
  const win = process.platform === "win32";
  const exe = win ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = win && a.select ? explorerArgs(a.select, true) : [a.dir];
  const child = spawn(exe, args, { shell: false, detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: win && !!a.select });
  child.on("error", () => { /* non-fatal */ });
  child.unref();
}
```
Các phương thức mới trong `RunManager` (cạnh `openDir`):

```ts
  /** Where AI-made (non-code) files are collected: Settings value, else <workspace>/outputs. */
  outputDir(): string {
    return loadAppSettings(this.opts.config.dataDir).outputDir ?? defaultOutputDir(this.opts.config.workspaceDir);
  }

  setOutputDir(p: string): string {
    const v = validateOutputDir(p);
    saveAppSettings(this.opts.config.dataDir, { outputDir: v });
    return v;
  }

  /** Mirror a run's artifacts into the output folder (best-effort, never throws). */
  syncOutputs(runId: string): number {
    try {
      const run = this.store.getRun(runId);
      if (!run) return 0;
      return syncRunOutputs(run.run_dir, this.outputDir(), runId, this.store.getArtifacts(runId));
    } catch {
      return 0;
    }
  }

  /** UI "Mở tệp": the path comes from the DB + a checked relative path, never from the request. */
  openOutput(runId: string, rel?: string): string {
    const run = this.store.getRun(runId);
    if (!run) throw new Error("Không tìm thấy lần chạy.");
    this.store.scanArtifacts(runId, run.run_dir);
    this.syncOutputs(runId);
    const dir = path.join(this.outputDir(), runId);
    if (!fs.existsSync(dir)) throw new Error("Lần chạy này chưa có tệp nào để mở.");
    const open = this.opts.openPath ?? defaultOpenPath;
    if (rel) {
      const file = resolveInside(dir, rel);
      if (!file || !fs.existsSync(file)) throw new Error("Không tìm thấy tệp trong thư mục lưu.");
      open({ dir, select: file });
      return file;
    }
    open({ dir });
    return dir;
  }

  /** Save a file made outside a run (skill training exports) under `<outputDir>/<group>/<name>` and highlight it. */
  saveOutputFile(group: string, name: string, data: Buffer): string {
    if (!/^[a-z0-9][a-z0-9_-]{0,60}(\/[a-z0-9][a-z0-9_-]{0,60})?$/.test(group)) throw new Error("Nhóm thư mục không hợp lệ.");
    const bad = validateInboxName(name);
    if (bad) throw new Error(bad);
    const dir = path.join(this.outputDir(), ...group.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    (this.opts.openPath ?? defaultOpenPath)({ dir, select: file });
    return file;
  }
```
Imports: `defaultOutputDir, validateOutputDir, syncRunOutputs, resolveInside, explorerArgs` từ `./outputs.js`; `validateInboxName` từ `./inbox.js`. Trong `handleExit`, ngay sau `this.store.scanArtifacts(runId, runDir);` thêm `this.syncOutputs(runId);`.

- [ ] **Step 5:** Test manager (thêm vào `tests/outputs.test.ts`, mẫu dựng `startServer`/config lấy từ `tests/ops-api.test.ts`, truyền `openPath` ghi lại lời gọi; xem Task 6 Step 1 vì cùng harness — làm hai bước test route ở Task 6). Ở đây chỉ chạy `npx vitest run --maxWorkers=1 tests/outputs.test.ts` → PASS và `npm run typecheck`.
- [ ] **Step 6:** Commit `feat(outputs): output folder, artifact sync and open-file helpers`.

---

### Task 6: Route HTTP

**Files:** Modify `src/server/http.ts`, `src/server/index.ts` (truyền `openPath` nếu có tùy chọn test như `openDirectory`); Test `tests/mcp-grants-api.test.ts`.

**Interfaces:**
- Consumes: mọi thứ ở Task 1–5.
- Produces (REST, đều cần token như route khác):
  - `GET /api/mcp` → `{ servers: McpServer[], presets: Preset[], cli: { at:number, items: CliMcpItem[] } | null }`
  - `POST /api/mcp` body `McpServer` hoặc `{ preset: "desktop-commander" }` → 201 `{ server }`
  - `PUT /api/mcp/:id` body `{enabled?}` hoặc đủ trường → `{ server }`; `DELETE /api/mcp/:id` → `{ ok }`
  - `POST /api/mcp/:id/probe` → `{ ok, tools, error? }`
  - `POST /api/mcp/cli/refresh` → `{ at, items }`; `POST /api/mcp/cli/login` → `{ ok }`
  - `GET /api/grants?project=<tên>` → `{ grants, source }` (không `project` = hồ sơ mặc định); `PUT /api/grants` body `{ project?: string, grants }` → `{ grants }`
  - `GET /api/settings/output-dir` → `{ outputDir, defaultDir }`; `PUT` body `{ outputDir }`
  - `POST /api/runs/:id/open-output` body `{ rel_path? }` → `{ ok, path }`
  - `POST /api/outputs/save` header `x-file-name`, `x-output-group`, thân nhị phân → `{ ok, path }`

- [ ] **Step 1: Test lỗi** — `tests/mcp-grants-api.test.ts`, copy phần `beforeAll` dựng config/`startServer` của `tests/ops-api.test.ts` (đổi tiền tố thư mục tạm `tnf-mcpapi-`, truyền `openPath: (a) => opened.push(a)` qua tùy chọn `startServer` giống `openDirectory`; nếu `startServer` chưa có, thêm tùy chọn `openPath?` cạnh `openDirectory?` ở `src/server/index.ts` dòng 34/50). Các ca:

```ts
const opened: Array<{ dir: string; select?: string }> = [];
// …beforeAll như ops-api.test.ts, thêm openPath: (a) => { opened.push(a); }

it("MCP registry: add preset, toggle, probe error, delete", async () => {
  const add = await fetch(`${base}/api/mcp`, { method: "POST", headers: H, body: JSON.stringify({ preset: "desktop-commander" }) });
  expect(add.status).toBe(201);
  let list = (await (await fetch(`${base}/api/mcp`, { headers: H })).json()) as { servers: Array<{ id: string; enabled: boolean }> };
  expect(list.servers.map((s) => s.id)).toContain("desktop-commander");
  const put = await fetch(`${base}/api/mcp/desktop-commander`, { method: "PUT", headers: H, body: JSON.stringify({ enabled: false }) });
  expect(((await put.json()) as { server: { enabled: boolean } }).server.enabled).toBe(false);
  expect((await fetch(`${base}/api/mcp`, { method: "POST", headers: H, body: JSON.stringify({ id: "Bad Id", name: "x", kind: "stdio", command: "a" }) })).status).toBe(400);
  expect((await fetch(`${base}/api/mcp/desktop-commander`, { method: "DELETE", headers: H })).status).toBe(200);
});

it("grants: default profile and per-project, with 400 for a missing extra dir", async () => {
  started.manager.store.upsertProject({ name: "envA", repo_path: null, base_branch: null, allowed_commands: [] });
  const put = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ project: "envA", grants: { web: false } }) });
  expect(put.status).toBe(200);
  const got = (await (await fetch(`${base}/api/grants?project=envA`, { headers: H })).json()) as { grants: { web: boolean }; source: string };
  expect(got.grants.web).toBe(false);
  expect(got.source).toBe("project");
  const bad = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ project: "envA", grants: { extraDirs: [{ path: path.join(root, "nope"), write: false }] } }) });
  expect(bad.status).toBe(400);
});

it("output dir: change, open-output sends Explorer to the file, traversal refused", async () => {
  const out = path.join(root, "my-outputs");
  expect((await fetch(`${base}/api/settings/output-dir`, { method: "PUT", headers: H, body: JSON.stringify({ outputDir: out }) })).status).toBe(200);
  const runDir = path.join(root, "rundir1");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "report.md"), "hello");
  started.manager.store.createRun({ id: "rid1", status: "done", prompt: "p", mode: "research", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: runDir });
  const r = await fetch(`${base}/api/runs/rid1/open-output`, { method: "POST", headers: H, body: JSON.stringify({ rel_path: "report.md" }) });
  expect(r.status).toBe(200);
  expect(fs.readFileSync(path.join(out, "rid1", "report.md"), "utf8")).toBe("hello");
  expect(opened.at(-1)?.select).toBe(path.join(out, "rid1", "report.md"));
  const bad = await fetch(`${base}/api/runs/rid1/open-output`, { method: "POST", headers: H, body: JSON.stringify({ rel_path: "../../x" }) });
  expect(bad.status).toBe(400);
});

it("outputs/save writes under the group and rejects bad names/groups", async () => {
  const ok = await fetch(`${base}/api/outputs/save`, { method: "POST", headers: { "x-controller-token": TOKEN, "x-file-name": "s1-round-1.docx", "x-output-group": "skills/s1", "content-type": "application/octet-stream" }, body: Buffer.from("zip") });
  expect(ok.status).toBe(200);
  const bad = await fetch(`${base}/api/outputs/save`, { method: "POST", headers: { "x-controller-token": TOKEN, "x-file-name": "x.docx", "x-output-group": "../evil", "content-type": "application/octet-stream" }, body: Buffer.from("z") });
  expect(bad.status).toBe(400);
});
```

- [ ] **Step 2:** Chạy → FAIL (404).
- [ ] **Step 3: `http.ts`.** Đặt khối route **trước** dòng `if (p === "/api/projects" && method === "GET")` (≈1316) cho nhóm MCP/grants/settings; route `open-output` cạnh `open-dir` (≈1686); `outputs/save` cùng khối MCP. Mã:

```ts
    // ---- MCP registry (Settings > Kết nối MCP) ----
    if (p === "/api/mcp" && method === "GET") {
      return json(res, 200, { servers: loadMcpServers(manager.config.dataDir), presets: MCP_PRESETS, cli: readCliSnapshot(manager.config.dataDir) });
    }
    if (p === "/api/mcp" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const preset = typeof body["preset"] === "string" ? MCP_PRESETS.find((x) => x.id === body["preset"]) : undefined;
        if (typeof body["preset"] === "string" && !preset) return json(res, 400, { error: "bad_request", message: "Mẫu MCP không tồn tại." });
        const server = validateMcpServer(preset ? { ...preset, enabled: true } : body);
        const list = loadMcpServers(manager.config.dataDir);
        if (list.some((x) => x.id === server.id)) return json(res, 400, { error: "bad_request", message: "Đã có máy chủ MCP cùng id." });
        saveMcpServers(manager.config.dataDir, [...list, server]);
        return json(res, 201, { server });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    if (p === "/api/mcp/cli/refresh" && method === "POST") {
      try {
        const items = await runClaudeMcpList(manager.claudePathForTools(), stripBillingEnv(process.env));
        return json(res, 200, writeCliSnapshot(manager.config.dataDir, items));
      } catch (e) {
        return json(res, 500, { error: "mcp_list_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/mcp/cli/login" && method === "POST") {
      // OAuth only works inside interactive `claude` (/mcp): open a terminal there for the user.
      spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", "claude"], { shell: false, detached: true, stdio: "ignore", cwd: manager.config.workspaceDir }).unref();
      return json(res, 200, { ok: true });
    }
    const mcpM = /^\/api\/mcp\/([a-z0-9_-]+)(?:\/(probe))?$/.exec(p);
    if (mcpM) {
      const id = mcpM[1]!;
      const list = loadMcpServers(manager.config.dataDir);
      const cur = list.find((x) => x.id === id);
      if (!cur) return json(res, 404, { error: "not_found", message: "Không tìm thấy máy chủ MCP." });
      if (mcpM[2] === "probe" && method === "POST") return json(res, 200, await probeMcp(cur));
      if (!mcpM[2] && method === "PUT") {
        try {
          const server = validateMcpServer({ ...cur, ...((await readBody(req)) as Record<string, unknown>), id });
          saveMcpServers(manager.config.dataDir, list.map((x) => (x.id === id ? server : x)));
          return json(res, 200, { server });
        } catch (e) {
          return json(res, 400, { error: "bad_request", ...errorMessage(e) });
        }
      }
      if (!mcpM[2] && method === "DELETE") {
        saveMcpServers(manager.config.dataDir, list.filter((x) => x.id !== id));
        return json(res, 200, { ok: true });
      }
    }
    // ---- Grants ----
    if (p === "/api/grants" && method === "GET") {
      const project = new URL(req.url ?? "/", "http://localhost").searchParams.get("project");
      return json(res, 200, manager.getGrants(project));
    }
    if (p === "/api/grants" && method === "PUT") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const project = typeof body["project"] === "string" && body["project"] ? body["project"] : "__default__";
        return json(res, 200, { grants: manager.setGrants(project, body["grants"]) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    // ---- Output folder ----
    if (p === "/api/settings/output-dir" && method === "GET") {
      return json(res, 200, { outputDir: manager.outputDir(), defaultDir: defaultOutputDir(manager.config.workspaceDir) });
    }
    if (p === "/api/settings/output-dir" && method === "PUT") {
      try {
        const body = (await readBody(req)) as Record<string, unknown>;
        return json(res, 200, { outputDir: manager.setOutputDir(body["outputDir"] as string), defaultDir: defaultOutputDir(manager.config.workspaceDir) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    if (p === "/api/outputs/save" && method === "POST") {
      try {
        const group = typeof req.headers["x-output-group"] === "string" ? req.headers["x-output-group"] : "";
        const data = await readRawBody(req, 50 * 1024 * 1024);
        return json(res, 200, { ok: true, path: manager.saveOutputFile(group, fileNameHeader(req), data) });
      } catch (e) {
        return json(res, 400, { error: "save_failed", ...errorMessage(e) });
      }
    }
```
Route `open-output` (trong khối `/api/runs/:id/…`, cạnh `open-dir`):

```ts
    if (sub === "open-output" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const rel = typeof body["rel_path"] === "string" && body["rel_path"] ? body["rel_path"] : undefined;
        return json(res, 200, { ok: true, path: manager.openOutput(runId, rel) });
      } catch (e) {
        return json(res, 400, { error: "open_failed", ...errorMessage(e) });
      }
    }
```
Imports ở đầu file: `spawn` (nếu chưa có), `MCP_PRESETS, loadMcpServers, saveMcpServers, validateMcpServer` từ `../core/mcp-registry.js`; `probeMcp` từ `../core/mcp-probe.js`; `readCliSnapshot, writeCliSnapshot, runClaudeMcpList` từ `../core/mcp-cli.js`; `defaultOutputDir` từ `../core/outputs.js`. Thêm hai phương thức vào `RunManager` cho route CLI: `claudePathForTools(): string` (trả `this.claudePath()` đã có hoặc `locateClaude(this.opts.config.claudePath)`) và dùng helper strip env đã có trong `billing-guard.ts` (tìm tên hàm bằng `Grep "ANTHROPIC_API_KEY" src/core/billing-guard.ts`; nếu hàm là `sanitizeEnv`, import đúng tên đó thay cho `stripBillingEnv`).

- [ ] **Step 4:** `npx vitest run --maxWorkers=1 tests/mcp-grants-api.test.ts` → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(api): MCP registry, grants, output folder and open-output routes`.

---

### Task 7: UI — client API, i18n, tab Kết nối MCP

**Files:** Modify `ui/src/api.ts`, `ui/src/i18n.ts`, `ui/src/pages/SettingsPanel.tsx`; Create `ui/src/components/McpSection.tsx`; Test `tests/mcp-ui-i18n.test.ts`.

**Interfaces:**
- Consumes: route Task 6.
- Produces (api.ts): `mcpList()`, `mcpAddPreset(id)`, `mcpAdd(server)`, `mcpSet(id, patch)`, `mcpRemove(id)`, `mcpProbe(id)`, `mcpCliRefresh()`, `mcpCliLogin()`, `grantsGet(project|null)`, `grantsPut(project|null, grants)`, `outputDirGet()`, `outputDirPut(dir)`, `openOutput(runId, rel?)`, `saveToOutputs(path, fileName, group)`; kiểu `McpServerView`, `CliMcpView`, `GrantsView`.

- [ ] **Step 1: Test i18n (lỗi)** — `tests/mcp-ui-i18n.test.ts`: import `{ vi, en }`? Xem cách `tests/cleanup-i18n.test.ts` đọc bảng chuỗi và copy y nguyên mẫu, kiểm tra có đủ khóa sau ở cả hai ngôn ngữ và khác rỗng: `ss_tab_mcp, ss_tab_grants, mcp_title, mcp_add_dc, mcp_probe, mcp_cli_title, mcp_cli_refresh, mcp_cli_login, mcp_cli_login_hint, mcp_cli_none, mcp_status_connected, mcp_status_needs_auth, mcp_status_failed, mcp_status_not_configured, mcp_dc_warn, grants_title, grants_env, grants_default_profile, grants_file_write, grants_web, grants_cmd_node, grants_cmd_python, grants_cmd_native, grants_cmd_basic, grants_cmd_install, grants_git_restore, grants_any_process, grants_any_process_warn, grants_extra_dirs, grants_add_dir, grants_dir_write, grants_mcp, grants_mcp_off, grants_mcp_read, grants_mcp_full, grants_locked_title, grants_locked_list, grants_saved, out_title, out_label, out_default, out_save, out_note, open_file, open_output_dir, out_remote_note`.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: i18n** — thêm vào bảng `vi` và `en` (mỗi khóa hai bản). Bản `vi`:

```ts
  ss_tab_mcp: "Kết nối MCP",
  ss_tab_grants: "Cấp quyền",
  mcp_title: "Máy chủ MCP của app",
  mcp_add_dc: "Thêm Desktop Commander (đọc/ghi tệp trên máy)",
  mcp_probe: "Kiểm tra",
  mcp_cli_title: "Connector của tài khoản Claude và plugin",
  mcp_cli_refresh: "Làm mới danh sách",
  mcp_cli_login: "Đăng nhập connector (mở cửa sổ claude, gõ /mcp)",
  mcp_cli_login_hint: "Bật connector tại claude.ai > Settings > Connectors, rồi đăng nhập ở đây.",
  mcp_cli_none: "Chưa có connector nào. Bấm Làm mới danh sách.",
  mcp_status_connected: "Đã kết nối",
  mcp_status_needs_auth: "Cần đăng nhập",
  mcp_status_failed: "Lỗi kết nối",
  mcp_status_not_configured: "Chưa cấu hình",
  mcp_dc_warn: "Desktop Commander có thể truy cập mọi thư mục trên máy. Công cụ chạy lệnh bị chặn mặc định.",
  grants_title: "Cấp quyền cho môi trường",
  grants_env: "Môi trường",
  grants_default_profile: "Hồ sơ mặc định (môi trường chưa chỉnh riêng)",
  grants_file_write: "Sửa/ghi tệp trong thư mục làm việc của run",
  grants_web: "Tìm kiếm và đọc trang web",
  grants_cmd_node: "Lệnh Node (npm, npx, pnpm, yarn, tsc, vitest…)",
  grants_cmd_python: "Lệnh Python (python, pytest, uv…)",
  grants_cmd_native: "Lệnh .NET, Rust, Go, make",
  grants_cmd_basic: "Lệnh cơ bản (ls, cat, grep, mkdir, cp…)",
  grants_cmd_install: "Cài gói Python (pip install)",
  grants_git_restore: "Git khôi phục (restore, reset, stash)",
  grants_any_process: "Cho phép MCP chạy lệnh tùy ý (nguy hiểm)",
  grants_any_process_warn: "Lệnh chạy qua MCP không bị chặn bởi danh sách cấm (git push, rm -rf…).",
  grants_extra_dirs: "Thư mục ngoài được truy cập",
  grants_add_dir: "Thêm thư mục",
  grants_dir_write: "Cho phép ghi",
  grants_mcp: "Máy chủ MCP",
  grants_mcp_off: "Tắt",
  grants_mcp_read: "Chỉ đọc",
  grants_mcp_full: "Đầy đủ",
  grants_locked_title: "Luôn bị khóa",
  grants_locked_list: "git push, rm -rf, git reset --hard, curl",
  grants_saved: "Đã lưu quyền.",
  out_title: "Thư mục lưu tệp",
  out_label: "Nơi lưu mọi tệp AI tạo ra (trừ code)",
  out_default: "Dùng mặc định",
  out_save: "Lưu thư mục",
  out_note: "Mỗi lần chạy có một thư mục con riêng. Tệp code vẫn nằm trong worktree.",
  open_file: "Mở tệp",
  open_output_dir: "Mở thư mục lưu",
  out_remote_note: "Nút Mở tệp mở thư mục trên máy đang chạy app, không phải trên thiết bị này.",
```
Bản `en`: dịch sát nghĩa (ví dụ `ss_tab_mcp: "MCP connections"`, `open_file: "Open file"`, `open_output_dir: "Open output folder"`, `out_title: "Output folder"`, v.v. đủ cả khóa).

- [ ] **Step 4: `ui/src/api.ts`** — thêm vào đối tượng `api` (và `saveToOutputs` là hàm export):

```ts
export interface McpServerView { id: string; name: string; kind: "stdio" | "http"; command?: string; args?: string[]; url?: string; enabled: boolean; preset?: string; writeTools?: string[]; processTools?: string[] }
export interface CliMcpView { name: string; target: string; status: "connected" | "needs_auth" | "failed" | "not_configured"; detail?: string }
export interface GrantsView {
  fileWrite: boolean; web: boolean; cmdNode: boolean; cmdPython: boolean; cmdNative: boolean; cmdBasic: boolean; cmdInstall: boolean; gitRestore: boolean; anyProcess: boolean;
  extraDirs: Array<{ path: string; write: boolean }>; mcp: Record<string, "off" | "read" | "full">;
}

/** Fetch a file (token in header), post it to the server's output folder and let the server open it in Explorer. */
export async function saveToOutputs(path: string, fileName: string, group: string): Promise<string> {
  const r = await fetch(path, { headers: { "x-controller-token": getToken() ?? "" } });
  if (!r.ok) throw new ApiError(r.statusText, r.status);
  const s = await fetch("/api/outputs/save", { method: "POST", headers: { "x-controller-token": getToken() ?? "", "x-file-name": fileName, "x-output-group": group, "content-type": "application/octet-stream" }, body: await r.blob() });
  const j = (await s.json().catch(() => ({}))) as { message?: string; path?: string };
  if (!s.ok) throw new ApiError(j.message ?? s.statusText, s.status);
  return j.path ?? "";
}
// trong api = { … }:
  mcpList: () => req<{ servers: McpServerView[]; presets: McpServerView[]; cli: { at: number; items: CliMcpView[] } | null }>("/api/mcp"),
  mcpAddPreset: (preset: string) => req<{ server: McpServerView }>("/api/mcp", { method: "POST", body: JSON.stringify({ preset }) }),
  mcpSet: (id: string, patch: Partial<McpServerView>) => req<{ server: McpServerView }>(`/api/mcp/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  mcpRemove: (id: string) => req<{ ok: boolean }>(`/api/mcp/${encodeURIComponent(id)}`, { method: "DELETE" }),
  mcpProbe: (id: string) => req<{ ok: boolean; tools: string[]; error?: string }>(`/api/mcp/${encodeURIComponent(id)}/probe`, { method: "POST", body: "{}" }),
  mcpCliRefresh: () => req<{ at: number; items: CliMcpView[] }>("/api/mcp/cli/refresh", { method: "POST", body: "{}" }),
  mcpCliLogin: () => req<{ ok: boolean }>("/api/mcp/cli/login", { method: "POST", body: "{}" }),
  grantsGet: (project: string | null) => req<{ grants: GrantsView; source: string }>(`/api/grants${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  grantsPut: (project: string | null, grants: GrantsView) => req<{ grants: GrantsView }>("/api/grants", { method: "PUT", body: JSON.stringify({ project: project ?? undefined, grants }) }),
  outputDirGet: () => req<{ outputDir: string; defaultDir: string }>("/api/settings/output-dir"),
  outputDirPut: (outputDir: string) => req<{ outputDir: string; defaultDir: string }>("/api/settings/output-dir", { method: "PUT", body: JSON.stringify({ outputDir }) }),
  openOutput: (id: string, rel?: string) => req<{ ok: boolean; path: string }>(`/api/runs/${encodeURIComponent(id)}/open-output`, { method: "POST", body: JSON.stringify(rel ? { rel_path: rel } : {}) }),
```

- [ ] **Step 5: `ui/src/components/McpSection.tsx`:**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type CliMcpView, type McpServerView } from "../api";
import { useT } from "../i18n";

const STATUS_KEY = { connected: "mcp_status_connected", needs_auth: "mcp_status_needs_auth", failed: "mcp_status_failed", not_configured: "mcp_status_not_configured" } as const;

/** Settings > Kết nối MCP: app-owned servers (Desktop Commander…) and the CLI's own connectors (claude.ai account, plugins). */
export function McpSection() {
  const { t } = useT();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [cli, setCli] = useState<CliMcpView[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.mcpList().then((r) => { setServers(r.servers); setCli(r.cli?.items ?? null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const hasDc = servers.some((s) => s.id === "desktop-commander");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="mcp-section">
      <div className="card">
        <h4>{t.mcp_title}</h4>
        {servers.map((s) => (
          <div className="row" key={s.id}>
            <label className="row">
              <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => void run(() => api.mcpSet(s.id, { enabled: e.target.checked }))} aria-label={s.name} />
              <b>{s.name}</b>
            </label>
            <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => { const r = await api.mcpProbe(s.id); setProbe((p) => ({ ...p, [s.id]: r.ok ? `${r.tools.length} công cụ: ${r.tools.join(", ")}` : (r.error ?? "Lỗi") })); })}>{t.mcp_probe}</button>
            <button type="button" className="mini danger" disabled={busy} onClick={() => void run(() => api.mcpRemove(s.id))}>✕</button>
            {probe[s.id] ? <div className="fine">{probe[s.id]}</div> : null}
          </div>
        ))}
        {!hasDc && <button type="button" disabled={busy} onClick={() => void run(() => api.mcpAddPreset("desktop-commander"))}>{t.mcp_add_dc}</button>}
        <div className="warn fine">{t.mcp_dc_warn}</div>
      </div>
      <div className="card">
        <h4>{t.mcp_cli_title}</h4>
        <div className="muted">{t.mcp_cli_login_hint}</div>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void run(() => api.mcpCliRefresh())}>{busy ? "…" : t.mcp_cli_refresh}</button>
          <button type="button" onClick={() => void run(() => api.mcpCliLogin())}>{t.mcp_cli_login}</button>
        </div>
        {!cli || cli.length === 0 ? <div className="muted">{t.mcp_cli_none}</div> : (
          <ul className="file-list">
            {cli.map((c) => (
              <li key={c.name}><span className="mono">{c.name}</span> <span className={`pill ${c.status === "connected" ? "ok" : c.status === "failed" ? "err" : ""}`}>{t[STATUS_KEY[c.status]]}</span></li>
            ))}
          </ul>
        )}
      </div>
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 6: `SettingsPanel.tsx`** — mở rộng kiểu tab và danh sách: `"people" | "tuning" | "phone" | "auto" | "release" | "mcp" | "grants"` (hai chỗ khai báo ở dòng 32–33), thêm `["mcp", t.ss_tab_mcp], ["grants", t.ss_tab_grants]` vào `tabs`, và hai panel `role="tabpanel"` theo mẫu `phone`: `<McpSection />` và `<GrantsSection />` (Task 8). Import hai component.
- [ ] **Step 7:** `npx vitest run --maxWorkers=1 tests/mcp-ui-i18n.test.ts tests/i18n-parity.test.ts`, `npm run typecheck`, `npm run build:ui` → đều qua.
- [ ] **Step 8:** Commit `feat(ui): MCP connections tab`.

---

### Task 8: UI — tab Cấp quyền, khối Thư mục lưu tệp, đổi nút tải về

**Files:** Create `ui/src/components/GrantsSection.tsx`, `ui/src/components/OutputDirSection.tsx`; Modify `ui/src/pages/SettingsPanel.tsx`, `ui/src/pages/RunPage.tsx` (dòng ≈632–660), `ui/src/components/SkillFloorPopup.tsx:277`, `ui/src/components/SampleFiles.tsx:24`, `ui/src/components/GenerativeTrainForm.tsx:144`; Test `tests/grants-ui-logic.test.ts`; Create `ui/src/grantsView.ts`.

**Interfaces:**
- Consumes: `api.grantsGet/Put`, `api.mcpList`, `api.openOutput`, `saveToOutputs` (Task 7); `projects` từ `api` (hàm liệt kê môi trường đã có, tìm bằng `Grep "projects" ui/src/api.ts`).
- Produces: `ui/src/grantsView.ts`: `export const GROUP_FIELDS: Array<{ key: keyof GrantsView & string; labelKey: string }>`, `export function setMcpAccess(g: GrantsView, id: string, access: "off"|"read"|"full"): GrantsView`, `export function toggleDir(g: GrantsView, path: string, write: boolean): GrantsView`, `export function isLocalHost(h: string): boolean`.

- [ ] **Step 1: Test lỗi** — `tests/grants-ui-logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GROUP_FIELDS, isLocalHost, setMcpAccess, toggleDir } from "../ui/src/grantsView";
import type { GrantsView } from "../ui/src/api";

const base: GrantsView = { fileWrite: true, web: true, cmdNode: true, cmdPython: true, cmdNative: true, cmdBasic: true, cmdInstall: true, gitRestore: true, anyProcess: false, extraDirs: [], mcp: {} };

describe("grantsView", () => {
  it("setMcpAccess sets and clears (off removes the key)", () => {
    const g = setMcpAccess(base, "desktop-commander", "read");
    expect(g.mcp).toEqual({ "desktop-commander": "read" });
    expect(setMcpAccess(g, "desktop-commander", "off").mcp).toEqual({});
    expect(base.mcp).toEqual({});
  });
  it("toggleDir adds a dir then removes it", () => {
    const a = toggleDir(base, "D:\\Docs", false);
    expect(a.extraDirs).toEqual([{ path: "D:\\Docs", write: false }]);
    expect(toggleDir(a, "D:\\Docs", false).extraDirs).toEqual([]);
  });
  it("GROUP_FIELDS lists every boolean tick except anyProcess and fileWrite handled separately", () => {
    expect(GROUP_FIELDS.map((f) => f.key)).toEqual(["fileWrite", "web", "cmdNode", "cmdPython", "cmdNative", "cmdBasic", "cmdInstall", "gitRestore"]);
  });
  it("isLocalHost", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("my-pc.tailnet.ts.net")).toBe(false);
  });
});
```

- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: `ui/src/grantsView.ts`:**

```ts
import type { GrantsView } from "./api";

export const GROUP_FIELDS: Array<{ key: keyof GrantsView & string; labelKey: string }> = [
  { key: "fileWrite", labelKey: "grants_file_write" },
  { key: "web", labelKey: "grants_web" },
  { key: "cmdNode", labelKey: "grants_cmd_node" },
  { key: "cmdPython", labelKey: "grants_cmd_python" },
  { key: "cmdNative", labelKey: "grants_cmd_native" },
  { key: "cmdBasic", labelKey: "grants_cmd_basic" },
  { key: "cmdInstall", labelKey: "grants_cmd_install" },
  { key: "gitRestore", labelKey: "grants_git_restore" },
];

export function setMcpAccess(g: GrantsView, id: string, access: "off" | "read" | "full"): GrantsView {
  const mcp = { ...g.mcp };
  if (access === "off") delete mcp[id];
  else mcp[id] = access;
  return { ...g, mcp };
}

export function toggleDir(g: GrantsView, path: string, write: boolean): GrantsView {
  const has = g.extraDirs.some((d) => d.path === path);
  return { ...g, extraDirs: has ? g.extraDirs.filter((d) => d.path !== path) : [...g.extraDirs, { path, write }] };
}

export function isLocalHost(h: string): boolean {
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}
```

- [ ] **Step 4: `GrantsSection.tsx`:**

```tsx
import { useEffect, useState } from "react";
import { api, type GrantsView, type McpServerView, type CliMcpView } from "../api";
import { useT } from "../i18n";
import { GROUP_FIELDS, setMcpAccess, toggleDir } from "../grantsView";

/** Settings > Cấp quyền: tick permissions per environment ("" = the default profile). */
export function GrantsSection() {
  const { t } = useT();
  const [envs, setEnvs] = useState<string[]>([]);
  const [env, setEnv] = useState<string>("");
  const [g, setG] = useState<GrantsView | null>(null);
  const [src, setSrc] = useState("");
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [cli, setCli] = useState<CliMcpView[]>([]);
  const [dir, setDir] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.projects().then((r) => setEnvs(r.projects.map((p) => p.name))).catch(() => undefined);
    api.mcpList().then((r) => { setServers(r.servers); setCli((r.cli?.items ?? []).filter((c) => c.status !== "not_configured")); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    setG(null);
    api.grantsGet(env || null).then((r) => { setG(r.grants); setSrc(r.source); }).catch((e: Error) => setErr(e.message));
  }, [env]);

  const save = (next: GrantsView) => {
    setG(next);
    setErr(null);
    api.grantsPut(env || null, next).then(() => { setMsg(t.grants_saved); setTimeout(() => setMsg(null), 2000); }).catch((e: Error) => setErr(e.message));
  };
  if (!g) return err ? <div className="error">{err}</div> : null;

  const accessOf = (id: string) => g.mcp[id] ?? "off";
  const mcpRows = [
    ...servers.map((s) => ({ id: s.id, label: s.name, canRead: (s.writeTools?.length ?? 0) > 0 })),
    ...cli.map((c) => ({ id: c.name, label: c.name, canRead: false })),
  ];

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="grants-section">
      <h4>{t.grants_title}</h4>
      <label className="row">
        <span>{t.grants_env}</span>
        <select value={env} onChange={(e) => setEnv(e.target.value)} aria-label={t.grants_env}>
          <option value="">{t.grants_default_profile}</option>
          {envs.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {env && src !== "project" ? <div className="fine muted">{t.grants_default_profile}</div> : null}
      {GROUP_FIELDS.map((f) => (
        <label className="row" key={f.key}>
          <input type="checkbox" checked={g[f.key] as boolean} onChange={(e) => save({ ...g, [f.key]: e.target.checked })} />
          <span>{(t as Record<string, string>)[f.labelKey]}</span>
        </label>
      ))}
      <div>
        <b>{t.grants_extra_dirs}</b>
        {g.extraDirs.map((d) => (
          <div className="row" key={d.path}>
            <span className="mono">{d.path}</span>
            <label className="row"><input type="checkbox" checked={d.write} onChange={(e) => save({ ...g, extraDirs: g.extraDirs.map((x) => (x.path === d.path ? { ...x, write: e.target.checked } : x)) })} /> {t.grants_dir_write}</label>
            <button type="button" className="mini danger" onClick={() => save(toggleDir(g, d.path, d.write))}>✕</button>
          </div>
        ))}
        <div className="row">
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="D:\Tai-lieu" aria-label={t.grants_add_dir} />
          <button type="button" disabled={!dir.trim()} onClick={() => { save(toggleDir(g, dir.trim(), false)); setDir(""); }}>{t.grants_add_dir}</button>
        </div>
      </div>
      <div>
        <b>{t.grants_mcp}</b>
        {mcpRows.length === 0 ? <div className="muted fine">{t.mcp_cli_none}</div> : null}
        {mcpRows.map((m) => (
          <div className="row" key={m.id}>
            <span className="mono">{m.label}</span>
            <select value={accessOf(m.id)} aria-label={m.label} onChange={(e) => save(setMcpAccess(g, m.id, e.target.value as "off" | "read" | "full"))}>
              <option value="off">{t.grants_mcp_off}</option>
              {m.canRead ? <option value="read">{t.grants_mcp_read}</option> : null}
              <option value="full">{t.grants_mcp_full}</option>
            </select>
          </div>
        ))}
        <label className="row">
          <input type="checkbox" checked={g.anyProcess} onChange={(e) => save({ ...g, anyProcess: e.target.checked })} />
          <span className="warn">{t.grants_any_process}</span>
        </label>
        {g.anyProcess ? <div className="error fine">{t.grants_any_process_warn}</div> : null}
      </div>
      <div className="muted fine"><b>{t.grants_locked_title}:</b> {t.grants_locked_list}</div>
      {msg ? <div className="ok fine">{msg}</div> : null}
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
```
(`api.projects()` — dùng đúng tên hàm liệt kê project hiện có trong `api.ts`; xác nhận bằng `Grep "api/projects" ui/src/api.ts` và chỉnh nếu khác. Class `ok` có thể chưa tồn tại: dùng `muted` nếu không có.)

- [ ] **Step 5: `OutputDirSection.tsx`:**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

/** Settings: where every AI-made (non-code) file is collected. */
export function OutputDirSection() {
  const { t } = useT();
  const [cur, setCur] = useState("");
  const [def, setDef] = useState("");
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.outputDirGet().then((r) => { setCur(r.outputDir); setDef(r.defaultDir); setVal(r.outputDir); }).catch((e: Error) => setErr(e.message)); }, []);
  const save = (dir: string) => { setErr(null); api.outputDirPut(dir).then((r) => { setCur(r.outputDir); setVal(r.outputDir); }).catch((e: Error) => setErr(e.message)); };
  return (
    <div className="card" data-testid="output-dir">
      <h4>{t.out_title}</h4>
      <div className="muted">{t.out_label}</div>
      <div className="row">
        <input style={{ flex: 1 }} value={val} onChange={(e) => setVal(e.target.value)} aria-label={t.out_title} />
        <button type="button" disabled={!val.trim() || val === cur} onClick={() => save(val)}>{t.out_save}</button>
        <button type="button" disabled={cur === def} onClick={() => save(def)}>{t.out_default}</button>
      </div>
      <div className="fine">{t.out_note}</div>
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
```
Trong `SettingsPanel.tsx` thêm `<OutputDirSection />` ngay sau `<CleanupSection />` và panel `grants` với `<GrantsSection />`.

- [ ] **Step 6: `RunPage.tsx`** — thêm `import { isLocalHost } from "../grantsView";` và hàm:

```tsx
  const openOut = async (rel?: string) => {
    setErr(null);
    try {
      const r = await api.openOutput(id, rel);
      setNotice(`${t.opened}: ${r.path}`);
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  const local = isLocalHost(window.location.hostname);
```
Thay phần dòng 632–644:

```tsx
              {artifacts.length > 0 && (
                <div className="row" style={{ justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="primary" onClick={() => void openOut()}>{t.open_output_dir}</button>
                  {!local && <button onClick={() => void fetchDownload(api.artifactsZipPath(id), `${id}-artifacts.zip`)}>⤓ {t.download_all}</button>}
                </div>
              )}
              {!local && <p className="muted fine">{t.out_remote_note}</p>}
              <ul className="file-list">
                {artifacts.map((a) => (
                  <li key={a.rel_path}>
                    <a href="#" onClick={(e) => { e.preventDefault(); void openFile(a.rel_path); }}>{a.rel_path}</a> <span className="muted">({fmtSize(a.size)})</span>{" "}
                    <button className="tiny" onClick={() => void openOut(a.rel_path)}>{t.open_file}</button>
                    {!local && <button className="tiny" title={t.download} onClick={() => void fetchDownload(api.artifactPath(id, a.rel_path), `${id}-${a.rel_path.replace(/[\\/]/g, "_")}`)}>⤓</button>}
                  </li>
                ))}
              </ul>
```
Và nút `⤓ {t.download}` của khung xem tệp (dòng ≈659): đổi thành `<button onClick={() => void openOut(fileView.name)}>{t.open_file}</button>` (với `fileView.name` là `rel_path` — kiểm bằng đọc đoạn quanh dòng 655–660; nếu tên là đã `_` hóa thì dùng `a.rel_path` lưu sẵn trong state).
- [ ] **Step 7: Ba nơi tải skill** — thay `api.downloadSkillZip(slug)` (SkillFloorPopup:277), `api.downloadSkillsGenSample(...)` (SampleFiles:24), `api.downloadSkillsGenMd(slug)` (GenerativeTrainForm:144) bằng phiên bản lưu vào thư mục: thêm vào `api.ts`:

```ts
  saveSkillZip: (slug: string) => saveToOutputs(skillZipPath(slug), `${slug}.zip`, `skills/${slug}`),
  saveSkillsGenSample: (slug: string, n: number, format: string) =>
    saveToOutputs(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/rounds/${n}/sample/${format}`, `${slug}-round-${n}.${format === "step" ? "step" : format}`, `skills/${slug}`),
  saveSkillsGenMd: (slug: string) => saveToOutputs(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/md`, `${slug}.md`, `skills/${slug}`),
```
và đổi ba chỗ gọi tương ứng; nhãn nút dùng `t.open_file` (khóa `skillg_download_file` giữ cho chế độ điện thoại: `isLocalHost` false thì vẫn gọi `api.download…` cũ). Slug phải khớp `^[a-z0-9][a-z0-9_-]{0,60}$` (đã đúng với slug của skill; nếu slug có ký tự khác, server trả 400 và UI hiện lỗi).
- [ ] **Step 8:** `npx vitest run --maxWorkers=1 tests/grants-ui-logic.test.ts tests/i18n-parity.test.ts`; `npm run typecheck`; `npm run build:ui` → qua.
- [ ] **Step 9:** Xác minh giao diện thật: `.\scripts\start.ps1 -Demo -NoOpen`, mở địa chỉ có `#token=`, vào Cài đặt: thấy hai tab mới, tick một ô → "Đã lưu quyền.", đổi thư mục lưu → lưu được; mở một run có tệp → nút "Mở tệp" gọi explorer (xem `data/` hoặc log). Kiểm khung 375 px và ≥ 1280 px (CLAUDE.md). Chụp ảnh vào `docs/screens/7.0-*.jpg`.
- [ ] **Step 10:** Commit `feat(ui): grants tab, output folder setting and open-file buttons`.

---

### Task 9: Nghiệm thu, tài liệu, phát hành 0.10.0

**Files:** Modify `docs/PROGRESS.md`, `docs/HANDOVER.md`, `docs/superpowers/specs/2026-11-09-mcp-grants-outputs-design.md`, `CLAUDE.md`, `package.json` (+ lock); Test: toàn bộ.

- [ ] **Step 1:** Cập nhật spec: bỏ "Filesystem chính thức" khỏi mẫu có sẵn (chỉ Desktop Commander, YAGNI vì cần tham số thư mục) và ghi kết quả spike (a)–(e) từ Task 0.
- [ ] **Step 2:** `npx vitest run --maxWorkers=1 --testTimeout=120000` → toàn bộ PASS; `npm run typecheck`; `npm run build:ui`. Ghi số liệu thật vào PROGRESS.
- [ ] **Step 3:** Smoke thật (hỏi người dùng trước, tốn hạn mức): thêm Desktop Commander, tick "Đầy đủ" cho một môi trường, chạy `npm run smoke -- --yes --coding --project <tên>` với lệnh "liệt kê thư mục D:\\Docs rồi ghi tóm tắt vào report.md"; xác nhận: stream có công cụ `mcp__desktop-commander__list_directory`, `start_process` bị từ chối, `report.md` xuất hiện ở `<thư mục lưu>\<run-id>\`. Ghi bằng chứng.
- [ ] **Step 4:** Thêm mục "Cập nhật 2026-11-09 (0.10.0)" vào `CLAUDE.md` (3–4 dòng: tab MCP/Cấp quyền, `grants`, thư mục lưu, quy tắc "không dùng `claude mcp add --scope user`") và `docs/HANDOVER.md`.
- [ ] **Step 5:** Nâng `version` thành `0.10.0` trong `package.json` + `package-lock.json`; **không** chạy `npm run package`/`installer` khi chưa được hỏi.
- [ ] **Step 6:** Commit `chore: release 0.10.0 (MCP connections, grants, output folder)`.

---

## Self-review (đối chiếu spec)

- §1 Kết nối MCP: Task 3 (registry, parse, probe), Task 6 (route, đăng nhập mở terminal), Task 7 (tab); spike (a)–(d) ở Task 0. Mẫu Filesystem được bỏ có chủ đích (Task 9 Step 1 sửa spec).
- §2 Desktop Commander: preset + chặn công cụ process/`set_config_value` trong `planMcp` (Task 1), nối vào run (Task 4); giới hạn thư mục tùy kết quả (e) → cảnh báo UI (`mcp_dc_warn`).
- §3 Cấp quyền: `Grants`, mặc định = `CODING_ENV_TOOLS` (test), cột `projects.grants`, hồ sơ mặc định, API, UI (Task 1, 2, 6, 8). Khóa vĩnh viễn: hiển thị tĩnh vì `deny-settings.json` đã chặn và deny thắng allow.
- §4 Thư mục lưu: Task 5 (đồng bộ, mở), Task 6 (route), Task 8 (UI, đổi nút, chế độ điện thoại, nút tải skill).
- §5 Kiểm thử/phát hành: Task 9.
- Kiểu nhất quán: `Grants`/`McpAccess`/`McpServer`/`McpPlan`/`CliMcpItem` định nghĩa ở Task 1/3 và dùng đúng tên ở Task 4–8; `openPath` cùng chữ ký ở Task 5–6.
- Rủi ro đã nêu: tên hàm strip env và hàm liệt kê project trong `api.ts` phải xác nhận khi làm (ghi chú ở Task 6 Step 3 và Task 8 Step 4).
