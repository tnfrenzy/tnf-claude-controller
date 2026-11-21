import fs from "node:fs";
import path from "node:path";
import type { CliAccountPublic, CliAccountsSettings, CliProviderId } from "../shared-types.js";

export const DEFAULT_CLAUDE_ACCOUNT_ID = "claude-default";
export const DEFAULT_AGY_ACCOUNT_ID = "agy-default";

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export interface CliAccountsFile {
  version: 1;
  accounts: CliAccountPublic[];
  settings?: CliAccountsSettings;
  /** Persistent cooldown deadlines (epoch ms) keyed by accountId so restarts preserve quota backoff. */
  cooldowns?: Record<string, number>;
}

export interface AddCliAccountInput {
  id?: string | undefined;
  label: string;
  provider: CliProviderId;
  /** For Claude: create an isolated CLAUDE_CONFIG_DIR under <dataDir>/cli-profiles/<id>. */
  isolated?: boolean | undefined;
  /** Optional explicit profile directory (validated to be non-empty string). */
  configDir?: string | null | undefined;
  binaryPath?: string | null | undefined;
  defaultModel?: string | null | undefined;
  priority?: number | undefined;
  isDefault?: boolean | undefined;
}

export interface UpdateCliAccountInput {
  label?: string | undefined;
  binaryPath?: string | null | undefined;
  defaultModel?: string | null | undefined;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  isDefault?: boolean | undefined;
}

function slugifyId(raw: string): string {
  const s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return s || "account";
}

function defaultAccount(now = Date.now()): CliAccountPublic {
  return {
    id: DEFAULT_CLAUDE_ACCOUNT_ID,
    label: "Claude Code (Mặc định)",
    provider: "claude",
    configDir: null,
    binaryPath: null,
    defaultModel: null,
    enabled: true,
    isDefault: true,
    priority: 1,
    createdAt: now,
  };
}

/**
 * Persistent store for CLI accounts (`<dataDir>/cli-accounts.json`).
 * Strictly CLI-only (no API keys, no AI Credits).
 * Claude accounts can be isolated via `CLAUDE_CONFIG_DIR` inside `<dataDir>/cli-profiles/<id>`.
 */
export class CliAccountStore {
  private readonly filePath: string;
  private readonly profilesDir: string;

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, "cli-accounts.json");
    this.profilesDir = path.join(dataDir, "cli-profiles");
  }

  private read(): CliAccountsFile {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<CliAccountsFile>;
        if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
          const accounts = raw.accounts
            .filter(
              (a): a is CliAccountPublic =>
                !!a && typeof a.id === "string" && (a.provider === "claude" || a.provider === "antigravity" || a.provider === "codex"),
            )
            .map((a) => ({
              id: a.id,
              label: typeof a.label === "string" && a.label.trim() ? a.label.trim() : a.id,
              provider: a.provider,
              configDir: typeof a.configDir === "string" && a.configDir.trim() ? a.configDir.trim() : null,
              binaryPath: typeof a.binaryPath === "string" && a.binaryPath.trim() ? a.binaryPath.trim() : null,
              defaultModel: typeof a.defaultModel === "string" && a.defaultModel.trim() ? a.defaultModel.trim() : null,
              enabled: a.enabled !== false,
              isDefault: a.isDefault === true,
              priority: typeof a.priority === "number" && Number.isFinite(a.priority) ? Math.max(1, Math.floor(a.priority)) : 10,
              createdAt: typeof a.createdAt === "number" ? a.createdAt : Date.now(),
            }));
          if (accounts.length > 0) {
            if (!accounts.some((a) => a.isDefault)) accounts[0]!.isDefault = true;
            const cooldowns: Record<string, number> = {};
            if (raw.cooldowns && typeof raw.cooldowns === "object") {
              for (const [k, v] of Object.entries(raw.cooldowns)) {
                if (typeof v === "number" && Number.isFinite(v) && v > 0) cooldowns[k] = v;
              }
            }
            return {
              version: 1,
              accounts,
              ...(raw.settings ? { settings: raw.settings } : {}),
              ...(Object.keys(cooldowns).length > 0 ? { cooldowns } : {}),
            };
          }
        }
      }
    } catch {
      /* corrupt or missing -> bootstrap default */
    }
    return { version: 1, accounts: [defaultAccount()] };
  }

  private write(data: CliAccountsFile): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  list(): CliAccountPublic[] {
    return this.read().accounts.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  }

  get(id: string): CliAccountPublic | null {
    return this.read().accounts.find((a) => a.id === id) ?? null;
  }

  getDefault(): CliAccountPublic {
    const list = this.list();
    return list.find((a) => a.isDefault && a.enabled) ?? list.find((a) => a.enabled) ?? list[0] ?? defaultAccount();
  }

  getSettings(): Required<CliAccountsSettings> {
    const s = this.read().settings ?? {};
    return {
      autoFailover: s.autoFailover === true,
      crossProviderFailover: s.crossProviderFailover === true,
    };
  }

  updateSettings(patch: CliAccountsSettings): Required<CliAccountsSettings> {
    const data = this.read();
    const prev = data.settings ?? {};
    const next: CliAccountsSettings = {
      autoFailover: patch.autoFailover !== undefined ? patch.autoFailover === true : prev.autoFailover === true,
      crossProviderFailover:
        patch.crossProviderFailover !== undefined ? patch.crossProviderFailover === true : prev.crossProviderFailover === true,
    };
    data.settings = next;
    this.write(data);
    return { autoFailover: next.autoFailover === true, crossProviderFailover: next.crossProviderFailover === true };
  }

  /** Ensure a default Antigravity CLI account exists (called on-demand or when user adds it). */
  ensureAntigravityAccount(): CliAccountPublic {
    const data = this.read();
    const existing = data.accounts.find((a) => a.provider === "antigravity");
    if (existing) return existing;
    const acc: CliAccountPublic = {
      id: DEFAULT_AGY_ACCOUNT_ID,
      label: "Antigravity CLI (Google OAuth)",
      provider: "antigravity",
      configDir: null,
      binaryPath: null,
      defaultModel: null,
      enabled: true,
      isDefault: false,
      priority: data.accounts.length + 1,
      createdAt: Date.now(),
    };
    data.accounts.push(acc);
    this.write(data);
    return acc;
  }

  add(input: AddCliAccountInput): CliAccountPublic {
    const label = (input.label ?? "").trim().slice(0, 80);
    if (!label) throw new Error("Tên tài khoản CLI không được để trống.");
    if (input.provider !== "claude" && input.provider !== "antigravity" && input.provider !== "codex") {
      throw new Error(`Provider không hợp lệ: ${String(input.provider)} (chỉ hỗ trợ claude, antigravity hoặc codex).`);
    }
    const data = this.read();
    let id = input.id ? input.id.trim().toLowerCase() : slugifyId(`${input.provider}-${label}`);
    if (!ID_RE.test(id)) {
      throw new Error("Mã tài khoản chỉ gồm chữ thường, số, dấu gạch ngang hoặc gạch dưới (1–40 ký tự).");
    }
    if (!input.id) {
      let n = 2;
      const base = id.slice(0, 34);
      while (data.accounts.some((a) => a.id === id)) {
        id = `${base}-${n++}`;
      }
    } else if (data.accounts.some((a) => a.id === id)) {
      throw new Error(`Tài khoản "${id}" đã tồn tại.`);
    }

    let configDir: string | null = null;
    if (input.provider === "claude" || input.provider === "codex") {
      if (typeof input.configDir === "string" && input.configDir.trim()) {
        configDir = path.resolve(input.configDir.trim());
      } else if (input.isolated !== false) {
        configDir = path.join(this.profilesDir, id);
      }
      if (configDir) fs.mkdirSync(configDir, { recursive: true });
    }

    const isDefault = input.isDefault === true;
    if (isDefault) for (const a of data.accounts) a.isDefault = false;

    const acc: CliAccountPublic = {
      id,
      label,
      provider: input.provider,
      configDir,
      binaryPath: typeof input.binaryPath === "string" && input.binaryPath.trim() ? input.binaryPath.trim() : null,
      defaultModel: typeof input.defaultModel === "string" && input.defaultModel.trim() ? input.defaultModel.trim() : null,
      enabled: true,
      isDefault,
      priority: typeof input.priority === "number" && Number.isFinite(input.priority) ? Math.max(1, Math.floor(input.priority)) : data.accounts.length + 1,
      createdAt: Date.now(),
    };
    data.accounts.push(acc);
    if (!data.accounts.some((a) => a.isDefault)) acc.isDefault = true;
    this.write(data);
    return acc;
  }

  update(id: string, patch: UpdateCliAccountInput): CliAccountPublic {
    const data = this.read();
    const acc = data.accounts.find((a) => a.id === id);
    if (!acc) throw new Error(`Không tìm thấy tài khoản CLI "${id}".`);
    if (patch.label !== undefined) {
      const label = patch.label.trim().slice(0, 80);
      if (!label) throw new Error("Tên tài khoản CLI không được để trống.");
      acc.label = label;
    }
    if (patch.binaryPath !== undefined) acc.binaryPath = patch.binaryPath?.trim() || null;
    if (patch.defaultModel !== undefined) acc.defaultModel = patch.defaultModel?.trim() || null;
    if (patch.enabled !== undefined) acc.enabled = patch.enabled === true;
    if (patch.priority !== undefined && Number.isFinite(patch.priority)) acc.priority = Math.max(1, Math.floor(patch.priority));
    if (patch.isDefault === true) {
      for (const a of data.accounts) a.isDefault = a.id === id;
      acc.enabled = true;
    }
    if (!data.accounts.some((a) => a.isDefault && a.enabled)) {
      const firstEnabled = data.accounts.find((a) => a.enabled) ?? data.accounts[0];
      if (firstEnabled) firstEnabled.isDefault = true;
    }
    this.write(data);
    return acc;
  }

  setDefault(id: string): CliAccountPublic {
    return this.update(id, { isDefault: true, enabled: true });
  }

  remove(id: string): boolean {
    const data = this.read();
    const idx = data.accounts.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    if (data.accounts.length <= 1) throw new Error("Không thể xóa tài khoản CLI cuối cùng.");
    const [removed] = data.accounts.splice(idx, 1);
    if (removed?.isDefault && data.accounts.length > 0) {
      const first = data.accounts.find((a) => a.enabled) ?? data.accounts[0]!;
      first.isDefault = true;
    }
    this.write(data);
    return true;
  }

  getCooldownUntil(accountId: string, now = Date.now()): number | null {
    const data = this.read();
    const until = data.cooldowns?.[accountId];
    if (!until || !Number.isFinite(until)) return null;
    if (until <= now) {
      if (data.cooldowns) {
        delete data.cooldowns[accountId];
        this.write(data);
      }
      return null;
    }
    return until;
  }

  markCooldown(accountId: string, untilMs: number): void {
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return;
    const data = this.read();
    const next = { ...(data.cooldowns ?? {}), [accountId]: Math.floor(untilMs) };
    data.cooldowns = next;
    this.write(data);
  }

  clearCooldown(accountId: string): boolean {
    const data = this.read();
    if (!data.cooldowns || !(accountId in data.cooldowns)) return false;
    delete data.cooldowns[accountId];
    this.write(data);
    return true;
  }

  listCooldowns(now = Date.now()): Record<string, number> {
    const data = this.read();
    const out: Record<string, number> = {};
    let dirty = false;
    for (const [k, v] of Object.entries(data.cooldowns ?? {})) {
      if (v > now) out[k] = v;
      else dirty = true;
    }
    if (dirty && data.cooldowns) {
      data.cooldowns = out;
      this.write(data);
    }
    return out;
  }

  /**
   * Build child process environment for a specific CLI account.
   * For isolated Claude accounts, injects `CLAUDE_CONFIG_DIR`.
   * For isolated OpenAI Codex CLI accounts, injects `CODEX_HOME`.
   */
  envForAccount(account: CliAccountPublic, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    if (account.provider === "claude") {
      if (account.configDir) env["CLAUDE_CONFIG_DIR"] = account.configDir;
      else delete env["CLAUDE_CONFIG_DIR"];
    } else if (account.provider === "codex") {
      if (account.configDir) env["CODEX_HOME"] = account.configDir;
      else delete env["CODEX_HOME"];
    }
    return env;
  }

  /**
   * Pick the effective account for a run:
   * 1. explicit `requestedId` (fails if not found or disabled, unless failover finds a replacement)
   * 2. `projectAccountId`
   * 3. global default account
   * If `autoFailover` is enabled and the selected account is cooling down, pick the highest-priority ready fallback.
   */
  resolveAccount(opts: {
    requestedId?: string | null | undefined;
    projectAccountId?: string | null | undefined;
    preferredProvider?: CliProviderId | undefined;
    isCoolingDown?: (accountId: string) => boolean;
  }): CliAccountPublic {
    const accounts = this.list();
    const settings = this.getSettings();
    const cooling = opts.isCoolingDown ?? (() => false);

    let chosen: CliAccountPublic | null = null;
    if (opts.requestedId) {
      chosen = accounts.find((a) => a.id === opts.requestedId) ?? null;
      if (!chosen) throw new Error(`Không tìm thấy tài khoản CLI "${opts.requestedId}".`);
      if (!chosen.enabled) throw new Error(`Tài khoản CLI "${chosen.label}" đang bị tắt.`);
    } else if (opts.projectAccountId) {
      const projAcc = accounts.find((a) => a.id === opts.projectAccountId && a.enabled);
      if (projAcc) chosen = projAcc;
    }
    if (!chosen && opts.preferredProvider) {
      chosen = accounts.find((a) => a.provider === opts.preferredProvider && a.enabled && !cooling(a.id))
        ?? accounts.find((a) => a.provider === opts.preferredProvider && a.enabled)
        ?? null;
    }
    if (!chosen) chosen = this.getDefault();

    if (settings.autoFailover && cooling(chosen.id)) {
      const fallback = accounts.find(
        (a) =>
          a.id !== chosen!.id &&
          a.enabled &&
          !cooling(a.id) &&
          (settings.crossProviderFailover || a.provider === chosen!.provider),
      );
      if (fallback) return fallback;
    }
    return chosen;
  }
}
