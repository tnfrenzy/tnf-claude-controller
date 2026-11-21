import fs from "node:fs";
import path from "node:path";
import { slashes } from "../../app/util.js";

export interface AgySettingsPayload {
  /** Hard rule: NEVER spend Google AI Credits when subscription quota runs out. */
  useG1Credits: false;
  /** Hard rule: NEVER route through GEMINI_API_KEY direct provider. */
  modelProvider: "";
  disableSlashCommands: boolean;
  permissions: {
    allow: string[];
    deny: string[];
    ask: string[];
  };
}

/**
 * Always-denied command patterns for Antigravity CLI.
 * Verified in Spike S4: `agy` matches full command lines, so `regex:` is required to block
 * both direct commands (`git push`) and flag-prefixed variants (`git -C . push`, `git -c x=1 push`).
 */
export const AGY_HARD_DENY_RULES: readonly string[] = [
  "command(regex:.*\\bgit\\b.*\\bpush\\b.*)",
  "command(regex:.*\\bgit\\b.*\\breset\\s+--hard\\b.*)",
  "command(regex:.*\\bgit\\b.*\\bclean\\b.*)",
  "command(regex:.*\\bgit\\b.*\\b(checkout|switch)\\s+(main|master)\\b.*)",
  "command(regex:.*\\bgit\\b.*\\bbranch\\s+-D\\b.*)",
  "command(regex:.*\\bgit\\b.*\\bbranch\\s+-d\\s+(main|master)\\b.*)",
  "command(regex:.*\\bgit\\b.*\\b(worktree|remote|rebase|merge)\\b.*)",
  "command(regex:.*\\bgit\\b.*\\bcommit\\b.*(--no-verify|\\s-n\\b).*)",
  "command(regex:.*\\bgit\\b.*(--force|\\s-f\\b).*)",
  "command(regex:.*\\brm\\s+-[a-zA-Z]*[rf][a-zA-Z]*\\b.*)",
  "command(regex:.*\\bRemove-Item\\b.*-Recurse.*)",
  "command(regex:.*\\b(rmdir|del)\\s+/s\\b.*)",
  "command(regex:.*\\bnpm\\s+(publish|install\\s+-g)\\b.*)",
  "command(regex:.*\\b(curl|wget|Invoke-WebRequest)\\b.*)",
  "write_file(.git/)",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a Claude-style `Bash(prefix*)` rule into an Antigravity `command(regex:...)` rule.
 * Returns null if the rule is not a `Bash(...)` rule or is too broad.
 */
export function claudeBashRuleToAgy(rule: string): string | null {
  const m = /^Bash\((.+)\)$/.exec(rule.trim());
  if (!m) return null;
  const inner = m[1]!.trim();
  if (!inner || inner === "*") return null;
  const parts = inner.split("*").map(escapeRegex);
  const pattern = parts.join(".*");
  return `command(regex:^${pattern}$)`;
}

export interface BuildAgySettingsInput {
  cwd: string;
  readOnly?: boolean | undefined;
  /** Mirrors Claude Code's permissionMode: in coding runs ("bypassPermissions"), allow normal commands/writes while keeping all deny rules strictly enforced. */
  permissionMode?: "dontAsk" | "bypassPermissions" | undefined;
  allowedTools?: readonly string[] | undefined;
  disallowedTools?: readonly string[] | undefined;
  addDirs?: readonly string[] | undefined;
  /** Optional extra Claude-style deny-settings.json file to fold in. */
  claudeDenySettingsFile?: string | undefined;
}

/**
 * Build a strict per-run Antigravity CLI `settings.json` payload.
 * - Always sets `useG1Credits: false` and `modelProvider: ""`.
 * - Because Windows host may not have terminal sandbox, uses explicit allow-list + hard deny-list.
 */
export function buildAgySettings(input: BuildAgySettingsInput): AgySettingsPayload {
  const allow: string[] = [];
  const deny: string[] = [...AGY_HARD_DENY_RULES];
  const pushAllow = (r: string) => {
    if (!allow.includes(r)) allow.push(r);
  };
  const pushDeny = (r: string) => {
    if (!deny.includes(r)) deny.push(r);
  };

  const cwdPosix = slashes(input.cwd);
  pushAllow(`read_file(${cwdPosix})`);
  pushAllow("read_file(.)");
  for (const dir of input.addDirs ?? []) {
    if (dir) pushAllow(`read_file(${slashes(dir)})`);
  }

  const tools = input.allowedTools ?? [];
  const allowWeb = tools.some((t) => t === "WebSearch" || t === "WebFetch" || t.startsWith("WebFetch("));
  const hasRead = input.readOnly || tools.length === 0 || tools.some((t) => t === "Read" || t.startsWith("Read("));
  if (hasRead) {
    // Allow read-only access cleanly (matches Claude Code `Read` semantics); write/command remain strictly gated below.
    pushAllow("read_file(*)");
  }

  if (input.readOnly) {
    pushDeny("command(*)");
    pushDeny("write_file(*)");
    pushDeny("execute_url(*)");
    if (allowWeb) pushAllow("read_url(*)");
    else pushDeny("read_url(*)");
  } else {
    const canWrite = input.permissionMode === "bypassPermissions" || tools.some((t) => t === "Write" || t === "Edit" || t.startsWith("Write(") || t.startsWith("Edit("));
    if (canWrite) {
      pushAllow(`write_file(${cwdPosix})`);
      pushAllow("write_file(.)");
      for (const dir of input.addDirs ?? []) {
        if (dir) pushAllow(`write_file(${slashes(dir)})`);
      }
    }
    if (input.permissionMode === "bypassPermissions") {
      // Match Claude Code coding behavior: allow general workspace writes & dev commands; permissions.deny still blocks all dangerous commands and .git/ writes.
      pushAllow("write_file(*)");
      pushAllow("command(*)");
    }
    for (const t of tools) {
      const wm = /^(?:Write|Edit)\((.+?)(?:\/\*\*)?\)$/.exec(t.trim());
      if (wm && wm[1]) {
        pushAllow(`write_file(${slashes(wm[1])})`);
        continue;
      }
      const rm = /^Read\((.+?)(?:\/\*\*)?\)$/.exec(t.trim());
      if (rm && rm[1]) {
        pushAllow(`read_file(${slashes(rm[1])})`);
        continue;
      }
      const cmd = claudeBashRuleToAgy(t);
      if (cmd) pushAllow(cmd);
    }
    if (allowWeb) pushAllow("read_url(*)");
    else pushDeny("execute_url(*)");
  }

  for (const d of input.disallowedTools ?? []) {
    const cmd = claudeBashRuleToAgy(d);
    if (cmd) pushDeny(cmd);
    if (d === "Bash") pushDeny("command(*)");
    if (d === "Write" || d === "Edit") pushDeny("write_file(*)");
  }

  if (input.claudeDenySettingsFile && fs.existsSync(input.claudeDenySettingsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(input.claudeDenySettingsFile, "utf8")) as { permissions?: { deny?: unknown } };
      const list = Array.isArray(parsed.permissions?.deny) ? parsed.permissions.deny : [];
      for (const item of list) {
        if (typeof item !== "string") continue;
        const cmd = claudeBashRuleToAgy(item);
        if (cmd) pushDeny(cmd);
      }
    } catch {
      /* hard deny rules remain in force */
    }
  }

  return {
    useG1Credits: false,
    modelProvider: "",
    disableSlashCommands: true,
    permissions: { allow, deny, ask: [] },
  };
}

/** Write per-run `agy-settings.json` into `dir` (outside run_dir). */
export function writeAgySettingsFile(dir: string, payload: AgySettingsPayload): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "agy-settings.json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}
