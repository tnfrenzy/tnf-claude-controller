import { spawn, spawnSync } from "node:child_process";
import { BillingGuardError, type AuthStatus } from "../billing-guard.js";
import type { CliModelChoice } from "../../shared-types.js";
import { DEFAULT_AGY_MODELS, inferModelTier } from "./model-distribution.js";

/**
 * Env vars that would route Antigravity CLI to paid API keys, Vertex AI, or GCP ADC.
 * Hard rule of TNF CLI: NEVER use API keys or AI Credits; use CLI Google OAuth subscription only.
 */
export const AGY_FORBIDDEN_ENV_KEYS: readonly string[] = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "AGY_ADC_AUTH",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_GEMINI_BASE_URL",
];

/** Strip all API-key / Vertex / ADC env vars from child process env. Pure. */
export function sanitizeAgyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  const forbidden = new Set(AGY_FORBIDDEN_ENV_KEYS.map((k) => k.toUpperCase()));
  for (const k of Object.keys(out)) {
    if (forbidden.has(k.toUpperCase())) delete out[k];
  }
  return out;
}

/** Extract semver x.y.z from `agy --version` output. */
export function parseAgyVersion(output: string): string | null {
  const m = /\d+\.\d+\.\d+/.exec(output);
  return m ? m[0] : null;
}

export function readAgyVersion(agyPath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): string | null {
  try {
    const res = spawnSync(agyPath, [...argsPrefix, "--version"], {
      env: sanitizeAgyEnv(env),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (res.error || res.status !== 0) return null;
    return parseAgyVersion(res.stdout ?? "");
  } catch {
    return null;
  }
}

/**
 * Parse `agy models` stdout (`<slug>\t<Display Label>` per line).
 * Skips header lines like "Fetching available models...".
 */
export function parseAgyModelsOutput(output: string): CliModelChoice[] {
  const out: CliModelChoice[] = [];
  const seen = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("\t")) continue;
    const [idRaw, labelRaw] = line.split("\t");
    const id = (idRaw ?? "").trim();
    const label = (labelRaw ?? id).trim();
    if (!id || seen.has(id) || !/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(id)) continue;
    seen.add(id);
    out.push({ id, label, tier: inferModelTier(id) });
  }
  return out;
}

/** Synchronous cached-friendly model query for `agy models`. Falls back to DEFAULT_AGY_MODELS on error. */
export function listAgyModelsSync(
  agyPath: string,
  env: NodeJS.ProcessEnv,
  fallback: readonly CliModelChoice[] = DEFAULT_AGY_MODELS,
  argsPrefix: readonly string[] = [],
): CliModelChoice[] {
  try {
    const res = spawnSync(agyPath, [...argsPrefix, "models"], {
      env: sanitizeAgyEnv(env),
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    if (res.status === 0 && res.stdout) {
      const parsed = parseAgyModelsOutput(res.stdout);
      if (parsed.length > 0) return parsed;
    }
  } catch {
    /* fall through to fallback */
  }
  return fallback.length ? fallback.map((m) => ({ ...m })) : DEFAULT_AGY_MODELS.map((m) => ({ ...m }));
}

/**
 * Probe Antigravity CLI authentication by running `agy models` with sanitized env.
 * Succeeding with model list proves the CLI has a valid Google OAuth keyring session
 * (and we never use GEMINI_API_KEY or AI Credits).
 */
export function checkAgyAuth(
  agyPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  argsPrefix: readonly string[] = [],
): Promise<{ status: AuthStatus; env: NodeJS.ProcessEnv; models: CliModelChoice[] }> {
  const env = sanitizeAgyEnv(baseEnv);
  return new Promise((resolve, reject) => {
    const child = spawn(agyPath, [...argsPrefix, "models"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new BillingGuardError("Kiểm tra đăng nhập Antigravity CLI (`agy models`) quá thời gian chờ.", "status_failed"));
    }, 20_000);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new BillingGuardError(`Không chạy được Antigravity CLI: ${e.message}`, "status_failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const combined = `${out}\n${err}`;
      if (/authentication required|not logged in|please sign in|login required/i.test(combined)) {
        reject(
          new BillingGuardError(
            "Chưa đăng nhập Antigravity CLI. Hãy mở PowerShell, chạy `agy` và đăng nhập tài khoản Google trước.",
            "not_logged_in",
          ),
        );
        return;
      }
      if (code !== 0 && !out.trim()) {
        reject(new BillingGuardError(`Antigravity CLI báo lỗi: ${err.trim() || `mã thoát ${code}`}`, "status_failed"));
        return;
      }
      const models = parseAgyModelsOutput(out);
      const status: AuthStatus = {
        loggedIn: true,
        authMethod: "google_oauth",
        subscriptionType: "antigravity",
        raw: { provider: "antigravity", modelCount: models.length, useG1Credits: false },
      };
      resolve({ status, env, models });
    });
  });
}
