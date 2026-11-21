import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import type { RunManager } from "../../core/run/run-manager.js";
import { runPhasedCoding, type CodingPhaseRole } from "../../core/run/phase-orchestrator.js";
import { getCliProvider } from "../../core/run/providers/registry.js";
import type { CliProviderId, RoleAccountMap } from "../../core/shared-types.js";

export interface CliAccountsRouteHelpers {
  json: (res: ServerResponse, status: number, body: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  isViaTunnel: (req: IncomingMessage) => boolean;
}

/**
 * Modular route handler for CLI Accounts & Role Account Assignments:
 *   GET    /api/cli/accounts
 *   POST   /api/cli/accounts
 *   PUT    /api/cli/accounts/settings
 *   PATCH  /api/cli/accounts/:id
 *   DELETE /api/cli/accounts/:id
 *   POST   /api/cli/accounts/:id/check
 *   POST   /api/cli/accounts/:id/login       (localhost only)
 *   GET    /api/cli/role-accounts
 *   PUT    /api/cli/role-accounts
 *   PUT    /api/projects/:name/account
 *
 * Returns true if the request was handled, false otherwise.
 */
export async function handleCliAccountsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
  method: string,
  manager: RunManager,
  h: CliAccountsRouteHelpers,
): Promise<boolean> {
  if (p === "/api/cli/accounts" && method === "GET") {
    const accounts = manager.cliAccounts.list();
    const settings = manager.cliAccounts.getSettings();
    const modelsByAccount: Record<string, ReturnType<RunManager["modelsForAccount"]>> = {};
    const cooldowns = manager.cliAccounts.listCooldowns();
    for (const a of accounts) {
      modelsByAccount[a.id] = manager.modelsForAccount(a, false);
    }
    h.json(res, 200, {
      accounts,
      settings,
      models_by_account: modelsByAccount,
      role_accounts: manager.getRoleAccounts(),
      cooldowns,
    });
    return true;
  }

  if (p === "/api/cli/accounts" && method === "POST") {
    try {
      const body = await h.readBody(req);
      const provider = body["provider"] as CliProviderId;
      const label = typeof body["label"] === "string" ? body["label"] : "";
      const created = manager.cliAccounts.add({
        ...(typeof body["id"] === "string" && body["id"].trim() ? { id: body["id"].trim() } : {}),
        label,
        provider,
        ...(typeof body["isolated"] === "boolean" ? { isolated: body["isolated"] } : {}),
        ...(typeof body["configDir"] === "string" ? { configDir: body["configDir"] } : {}),
        ...(typeof body["binaryPath"] === "string" ? { binaryPath: body["binaryPath"] } : {}),
        ...(typeof body["defaultModel"] === "string" ? { defaultModel: body["defaultModel"] } : {}),
        ...(typeof body["priority"] === "number" ? { priority: body["priority"] } : {}),
        ...(typeof body["isDefault"] === "boolean" ? { isDefault: body["isDefault"] } : {}),
      });
      h.json(res, 201, { account: created });
    } catch (e) {
      h.json(res, 400, { error: "bad_request", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (p === "/api/cli/accounts/settings" && method === "PUT") {
    try {
      const body = await h.readBody(req);
      const settings = manager.cliAccounts.updateSettings({
        ...(typeof body["autoFailover"] === "boolean" ? { autoFailover: body["autoFailover"] } : {}),
        ...(typeof body["crossProviderFailover"] === "boolean" ? { crossProviderFailover: body["crossProviderFailover"] } : {}),
      });
      h.json(res, 200, { settings });
    } catch (e) {
      h.json(res, 400, { error: "bad_request", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  const accCooldown = /^\/api\/cli\/accounts\/([a-z0-9_-]+)\/cooldown$/.exec(p);
  if (accCooldown && method === "DELETE") {
    const id = accCooldown[1]!;
    manager.clearAccountCooldown(id);
    h.json(res, 200, { ok: true, cooldowns: manager.cliAccounts.listCooldowns() });
    return true;
  }

  const accAction = /^\/api\/cli\/accounts\/([a-z0-9_-]+)\/(check|login)$/.exec(p);
  if (accAction && method === "POST") {
    const id = accAction[1]!;
    const action = accAction[2]!;
    if (action === "check") {
      try {
        const status = await manager.checkAccountStatus(id, true);
        h.json(res, 200, { status });
      } catch (e) {
        h.json(res, 404, { error: "not_found", message: e instanceof Error ? e.message : String(e) });
      }
      return true;
    }
    if (action === "login") {
      if (h.isViaTunnel(req)) {
        h.json(res, 403, { error: "forbidden", message: "Đăng nhập tài khoản CLI chỉ thực hiện được trên máy chạy app." });
        return true;
      }
      const account = manager.cliAccounts.get(id);
      if (!account) {
        h.json(res, 404, { error: "not_found", message: `Không tìm thấy tài khoản CLI "${id}".` });
        return true;
      }
      const provider = getCliProvider(account.provider);
      const env = provider.sanitizeEnv(manager.cliAccounts.envForAccount(account, manager.env));
      const cmd = account.provider === "antigravity" ? "agy" : account.provider === "codex" ? "codex login" : "claude";
      try {
        if (process.platform === "win32") {
          const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", cmd], {
            env,
            detached: true,
            stdio: "ignore",
            windowsHide: false,
            shell: false,
          });
          child.on("error", () => {});
          child.unref();
        }
        h.json(res, 200, { ok: true, account_id: id, command: cmd, config_dir: account.configDir });
      } catch (e) {
        h.json(res, 500, { error: "spawn_failed", message: e instanceof Error ? e.message : String(e) });
      }
      return true;
    }
  }

  const accItem = /^\/api\/cli\/accounts\/([a-z0-9_-]+)$/.exec(p);
  if (accItem && method === "PATCH") {
    try {
      const body = await h.readBody(req);
      const updated = manager.cliAccounts.update(accItem[1]!, {
        ...(typeof body["label"] === "string" ? { label: body["label"] } : {}),
        ...(body["binaryPath"] === null || typeof body["binaryPath"] === "string" ? { binaryPath: body["binaryPath"] as string | null } : {}),
        ...(body["defaultModel"] === null || typeof body["defaultModel"] === "string" ? { defaultModel: body["defaultModel"] as string | null } : {}),
        ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {}),
        ...(typeof body["priority"] === "number" ? { priority: body["priority"] } : {}),
        ...(typeof body["isDefault"] === "boolean" ? { isDefault: body["isDefault"] } : {}),
      });
      h.json(res, 200, { account: updated });
    } catch (e) {
      h.json(res, 400, { error: "bad_request", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (accItem && method === "DELETE") {
    try {
      const removed = manager.cliAccounts.remove(accItem[1]!);
      if (!removed) h.json(res, 404, { error: "not_found", message: "Không tìm thấy tài khoản CLI." });
      else h.json(res, 200, { ok: true });
    } catch (e) {
      h.json(res, 400, { error: "bad_request", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (p === "/api/cli/role-accounts" && method === "GET") {
    h.json(res, 200, { role_accounts: manager.getRoleAccounts() });
    return true;
  }

  if (p === "/api/cli/role-accounts" && method === "PUT") {
    try {
      const body = await h.readBody(req);
      const saved = manager.setRoleAccounts(body["role_accounts"] ?? body);
      h.json(res, 200, { role_accounts: saved });
    } catch (e) {
      h.json(res, 400, { error: "bad_request", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  const projAcc = /^\/api\/projects\/([^/]+)\/account$/.exec(p);
  if (projAcc && method === "PUT") {
    try {
      const name = decodeURIComponent(projAcc[1]!);
      const body = await h.readBody(req);
      const accId = typeof body["account_id"] === "string" && body["account_id"].trim() ? body["account_id"].trim() : null;
      const saved = manager.setProjectAccount(name, accId);
      h.json(res, 200, { project: name, account_id: saved });
    } catch (e) {
      h.json(res, 400, { error: "bad_request", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (p === "/api/runs/phased" && method === "POST") {
    try {
      const body = await h.readBody(req);
      const prompt = typeof body["prompt"] === "string" ? body["prompt"].trim() : "";
      const project = typeof body["project"] === "string" ? body["project"].trim() : "";
      if (!prompt || !project) {
        h.json(res, 400, { error: "bad_request", message: "Cần truyền prompt và project có repo để chạy đa pha." });
        return true;
      }
      const phases = Array.isArray(body["phases"]) ? (body["phases"] as CodingPhaseRole[]) : undefined;
      const phaseAccounts =
        body["phase_accounts"] && typeof body["phase_accounts"] === "object" && !Array.isArray(body["phase_accounts"])
          ? (body["phase_accounts"] as RoleAccountMap)
          : undefined;
      const maxDebugRounds = typeof body["max_debug_rounds"] === "number" ? body["max_debug_rounds"] : undefined;
      const result = await runPhasedCoding(manager, {
        prompt,
        project,
        ...(phases ? { phases } : {}),
        ...(phaseAccounts ? { phaseAccounts } : {}),
        ...(maxDebugRounds !== undefined ? { maxDebugRounds } : {}),
      });
      h.json(res, result.ok ? 200 : 400, result);
    } catch (e) {
      h.json(res, 400, { error: "phased_failed", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  return false;
}
