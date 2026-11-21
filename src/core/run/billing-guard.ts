import { spawn } from "node:child_process";
import type { AuthMode } from "../app/config.js";

export interface AuthStatus {
  loggedIn: boolean;
  authMethod: string;
  subscriptionType?: string;
  email?: string;
  orgName?: string;
  raw: Record<string, unknown>;
}

export class BillingGuardError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_logged_in" | "api_billing" | "unknown_auth" | "bare_flag" | "status_failed",
  ) {
    super(message);
    this.name = "BillingGuardError";
  }
}

/** Env vars that switch Claude Code to pay-per-token API billing or a third-party provider. */
const BILLING_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY_HELPER",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

const SUBSCRIPTION_METHODS = new Set(["claude.ai", "oauth_token"]);

/** Return a copy of env with billing-related variables removed (subscription mode). */
export function sanitizeEnv(env: NodeJS.ProcessEnv, mode: AuthMode): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  if (mode === "subscription") {
    for (const k of Object.keys(out)) {
      if (BILLING_ENV_KEYS.includes(k.toUpperCase())) delete out[k];
    }
  }
  return out;
}

/** Reject argument lists that contain --bare (it bypasses subscription login). */
export function assertNoBare(args: readonly string[], mode: AuthMode): void {
  if (mode === "subscription" && args.some((a) => a === "--bare" || a.startsWith("--bare="))) {
    throw new BillingGuardError(
      "Cờ --bare bị cấm ở chế độ subscription: nó không dùng đăng nhập thuê bao và cần khóa API.",
      "bare_flag",
    );
  }
}

/** Decide whether the reported auth method is acceptable for the requested mode. */
export function checkAuthMethod(status: AuthStatus, mode: AuthMode): void {
  if (!status.loggedIn || status.authMethod === "none") {
    throw new BillingGuardError(
      "Chưa đăng nhập Claude Code. Chạy `claude` trong PowerShell và đăng nhập bằng tài khoản claude.ai trước.",
      "not_logged_in",
    );
  }
  if (mode === "subscription") {
    if (!SUBSCRIPTION_METHODS.has(status.authMethod)) {
      throw new BillingGuardError(
        `Đang đăng nhập bằng "${status.authMethod}" (tính phí API). Chế độ subscription yêu cầu đăng nhập claude.ai hoặc oauth_token. Hãy gỡ ANTHROPIC_API_KEY hoặc chuyển sang chế độ "api".`,
        "api_billing",
      );
    }
  }
}

export function parseAuthStatus(json: string): AuthStatus {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new BillingGuardError("Không đọc được kết quả `claude auth status`.", "status_failed");
  }
  const out: AuthStatus = {
    loggedIn: raw["loggedIn"] === true,
    authMethod: typeof raw["authMethod"] === "string" ? (raw["authMethod"] as string) : "none",
    raw,
  };
  if (typeof raw["subscriptionType"] === "string") out.subscriptionType = raw["subscriptionType"] as string;
  if (typeof raw["email"] === "string") out.email = raw["email"] as string;
  if (typeof raw["orgName"] === "string") out.orgName = raw["orgName"] as string;
  return out;
}

/** Run `claude auth status` (no shell) and parse the JSON output. */
export function queryAuthStatus(claudePath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): Promise<AuthStatus> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudePath, [...argsPrefix, "auth", "status"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", (e) => reject(new BillingGuardError(`Không chạy được claude: ${e.message}`, "status_failed")));
    child.on("close", () => {
      // exit code is 1 when not logged in but JSON is still printed; parse regardless.
      try {
        resolve(parseAuthStatus(out.trim() || "{}"));
      } catch (e) {
        reject(new BillingGuardError(`claude auth status lỗi: ${err.trim() || String(e)}`, "status_failed"));
      }
    });
  });
}

export interface GuardResult {
  status: AuthStatus;
  env: NodeJS.ProcessEnv;
}

/** Full guard: query auth, validate for mode, return sanitized env for the child process. */
export async function runBillingGuard(
  claudePath: string,
  mode: AuthMode,
  baseEnv: NodeJS.ProcessEnv = process.env,
  argsPrefix: readonly string[] = [],
): Promise<GuardResult> {
  const env = sanitizeEnv(baseEnv, mode);
  const status = await queryAuthStatus(claudePath, env, argsPrefix);
  checkAuthMethod(status, mode);
  return { status, env };
}
