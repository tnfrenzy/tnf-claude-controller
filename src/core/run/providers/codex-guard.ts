import { spawn, spawnSync } from "node:child_process";
import { BillingGuardError, type AuthStatus } from "../billing-guard.js";

/**
 * Env vars that would switch Codex CLI to pay-per-token OpenAI API billing.
 * Hard rule of TNF CLI: NEVER use API keys; use ChatGPT OAuth subscription (`codex login`) only.
 */
export const CODEX_FORBIDDEN_ENV_KEYS: readonly string[] = [
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
];

/** Return a copy of env with all OpenAI API billing variables removed. Pure. */
export function sanitizeCodexEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  const forbidden = new Set(CODEX_FORBIDDEN_ENV_KEYS.map((k) => k.toUpperCase()));
  for (const k of Object.keys(out)) {
    if (forbidden.has(k.toUpperCase())) delete out[k];
  }
  return out;
}

export function parseCodexVersion(output: string): string | null {
  const m = /\d+\.\d+\.\d+/.exec(output);
  return m ? m[0] : null;
}

export function readCodexVersion(codexPath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): string | null {
  try {
    const res = spawnSync(codexPath, [...argsPrefix, "--version"], {
      env: sanitizeCodexEnv(env),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (res.error || res.status !== 0) return null;
    return parseCodexVersion(res.stdout ?? "");
  } catch {
    return null;
  }
}

/**
 * Check Codex CLI login status via `codex login status` with API keys stripped.
 * Rejects API-key auth and unauthenticated sessions.
 */
export function checkCodexAuth(
  codexPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  argsPrefix: readonly string[] = [],
): Promise<{ status: AuthStatus; env: NodeJS.ProcessEnv }> {
  const env = sanitizeCodexEnv(baseEnv);
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, [...argsPrefix, "login", "status"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new BillingGuardError("Kiểm tra đăng nhập Codex CLI (`codex login status`) quá thời gian chờ.", "status_failed"));
    }, 15_000);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new BillingGuardError(`Không chạy được Codex CLI: ${e.message}`, "status_failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const combined = `${out}\n${err}`.trim();
      if (/api.?key/i.test(combined) && !/chatgpt/i.test(combined)) {
        reject(
          new BillingGuardError(
            "Codex CLI đang dùng API key (tính phí). TNF CLI chỉ cho phép đăng nhập thuê bao ChatGPT (`codex login`).",
            "api_billing",
          ),
        );
        return;
      }
      if (code !== 0 || /not logged in|logged out|unauthenticated/i.test(combined)) {
        reject(
          new BillingGuardError(
            "Chưa đăng nhập OpenAI Codex CLI. Hãy mở terminal, chạy `codex login` bằng tài khoản ChatGPT thuê bao trước.",
            "not_logged_in",
          ),
        );
        return;
      }
      const status: AuthStatus = {
        loggedIn: true,
        authMethod: "chatgpt_oauth",
        subscriptionType: "chatgpt",
        raw: { provider: "codex", output: combined },
      };
      resolve({ status, env });
    });
  });
}
