import fs from "node:fs";
import path from "node:path";
import { projectSlug } from "../run/context-scan.js";
import { isObj } from "../app/util.js";

/**
 * Per-project release configuration: a fixed-type chain of steps run by controller code (never by an agent).
 * Stored at `<dataDir>/projects/<slug>/release.json`. No passwords or tokens are ever stored: only remote
 * name, host, user, port, SSH key path and target directory.
 * Note: `test` is not a step type; it is the npm script `test` run as a `build` step.
 */
export type ReleaseStep =
  | { type: "bump" }
  | { type: "build"; script: string }
  | { type: "tag"; prefix: string }
  | { type: "git-push"; remote: string; branch?: string; tag?: string }
  | { type: "project-script"; scriptPath: string; target: string; keyPath: string; keyEnvName: string; timeoutMin?: number }
  | { type: "ssh-deploy"; host: string; user: string; port: number; keyPath: string; remoteDir: string }
  | { type: "healthcheck"; url: string; expectStatus: number };

export interface ReleaseConfig {
  template?: string;
  extraScripts: string[];
  steps: ReleaseStep[];
}

export class ReleaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseConfigError";
  }
}

export const BUILTIN_SCRIPTS = ["package", "installer", "build:ui", "test"] as const;
export const MAX_EXTRA_SCRIPTS = 10;
export const MAX_STEPS = 20;

const SCRIPT_RE = /^[A-Za-z0-9:_-]+$/;
const REMOTE_RE = /^[A-Za-z0-9._-]+$/;
const HOST_RE = /^[A-Za-z0-9.-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;
const REMOTE_DIR_RE = /^[A-Za-z0-9._/-]+$/;
const PREFIX_RE = /^[A-Za-z0-9._-]{0,16}$/;

export const RELEASE_TEMPLATES: Record<string, ReleaseConfig> = {
  "windows-installer": {
    template: "windows-installer",
    extraScripts: [],
    // test FIRST: a failing test must not leave a "chore(release)" version commit behind (it happened twice).
    steps: [
      { type: "build", script: "test" },
      { type: "bump" },
      { type: "build", script: "package" },
      { type: "build", script: "installer" },
    ],
  },
  "web-vps": {
    template: "web-vps",
    extraScripts: [],
    steps: [
      { type: "bump" },
      { type: "build", script: "test" },
      { type: "tag", prefix: "v" },
      { type: "git-push", remote: "origin" },
      { type: "project-script", scriptPath: "scripts/deploy.sh", target: "deploy@example.com", keyPath: "keys/deploy_key", keyEnvName: "DEPLOY_KEY_PATH" },
      { type: "healthcheck", url: "https://example.com/", expectStatus: 200 },
    ],
  },
};

function noUnknownKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      throw new ReleaseConfigError(`${where}: không chấp nhận trường "${k}" (không lưu mật khẩu hay token trong cấu hình phát hành).`);
    }
  }
}

function str(v: unknown, field: string, where: string): string {
  if (typeof v !== "string" || !v.trim()) throw new ReleaseConfigError(`${where}: thiếu "${field}".`);
  return v.trim();
}

const TARGET_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const REF_RE = /^[A-Za-z0-9._\/-]+$/;
export const MAX_SCRIPT_TIMEOUT_MIN = 30;

/** Branch or tag name: no leading `-` or `+`, no `:`, no whitespace, no `..`. */
function refName(v: unknown, label: string, where: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.startsWith("-") || s.startsWith("+") || s.includes(":") || /\s/.test(s) || s.includes("..") || !REF_RE.test(s)) {
    throw new ReleaseConfigError(`${where}: tên ${label} không hợp lệ (không bắt đầu bằng - hoặc +, không chứa ":" hay khoảng trắng).`);
  }
  return s;
}

function validateStep(raw: unknown, i: number, scripts: Set<string>): ReleaseStep {
  const where = `Bước ${i + 1}`;
  if (!isObj(raw)) throw new ReleaseConfigError(`${where}: phải là một đối tượng.`);
  const type = raw["type"];
  switch (type) {
    case "bump":
      noUnknownKeys(raw, ["type"], where);
      return { type: "bump" };
    case "build": {
      noUnknownKeys(raw, ["type", "script"], where);
      const script = raw["script"] === undefined ? "build:ui" : str(raw["script"], "script", where);
      if (!SCRIPT_RE.test(script) || !scripts.has(script)) {
        throw new ReleaseConfigError(`${where}: script "${script}" không nằm trong danh sách cho phép (${[...scripts].join(", ")}).`);
      }
      return { type: "build", script };
    }
    case "tag": {
      noUnknownKeys(raw, ["type", "prefix"], where);
      const prefix = raw["prefix"] === undefined ? "v" : typeof raw["prefix"] === "string" ? raw["prefix"] : null;
      if (prefix === null || !PREFIX_RE.test(prefix) || prefix.startsWith("-")) throw new ReleaseConfigError(`${where}: tiền tố tag không hợp lệ.`);
      return { type: "tag", prefix };
    }
    case "git-push": {
      noUnknownKeys(raw, ["type", "remote", "branch", "tag"], where);
      const remote = str(raw["remote"], "remote", where);
      if (!REMOTE_RE.test(remote) || remote.startsWith("-") || remote.includes("..")) throw new ReleaseConfigError(`${where}: tên remote không hợp lệ.`);
      const out: ReleaseStep = { type: "git-push", remote };
      if (raw["branch"] !== undefined) out.branch = refName(raw["branch"], "nhánh", where);
      if (raw["tag"] !== undefined) out.tag = refName(raw["tag"], "tag", where);
      return out;
    }
    case "project-script": {
      noUnknownKeys(raw, ["type", "scriptPath", "target", "keyPath", "keyEnvName", "timeoutMin"], where);
      const scriptPath = str(raw["scriptPath"], "scriptPath", where);
      if (
        path.isAbsolute(scriptPath) ||
        /^[A-Za-z]:/.test(scriptPath) ||
        scriptPath.startsWith("/") ||
        scriptPath.startsWith("\\") ||
        scriptPath.startsWith("-") ||
        scriptPath.split(/[\\/]/).includes("..") ||
        scriptPath.includes("..") ||
        /[\r\n\0]/.test(scriptPath) ||
        !scriptPath.endsWith(".sh")
      ) {
        throw new ReleaseConfigError(`${where}: đường dẫn script phải là đường dẫn tương đối trong repo, kết thúc .sh và không chứa "..".`);
      }
      const target = str(raw["target"], "target", where);
      if (!TARGET_RE.test(target)) throw new ReleaseConfigError(`${where}: target phải có dạng user@host.`);
      const keyPath = str(raw["keyPath"], "keyPath", where);
      if (keyPath.startsWith("-") || /[\r\n\0]/.test(keyPath)) throw new ReleaseConfigError(`${where}: đường dẫn khóa SSH không hợp lệ.`);
      const keyEnvName = str(raw["keyEnvName"], "keyEnvName", where);
      if (!ENV_NAME_RE.test(keyEnvName)) throw new ReleaseConfigError(`${where}: tên biến môi trường phải khớp [A-Z_][A-Z0-9_]*.`);
      const out: ReleaseStep = { type: "project-script", scriptPath, target, keyPath, keyEnvName };
      if (raw["timeoutMin"] !== undefined) {
        const t = raw["timeoutMin"];
        if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > MAX_SCRIPT_TIMEOUT_MIN) {
          throw new ReleaseConfigError(`${where}: timeoutMin phải từ 1 đến ${MAX_SCRIPT_TIMEOUT_MIN} phút.`);
        }
        out.timeoutMin = t;
      }
      return out;
    }
    case "ssh-deploy": {
      noUnknownKeys(raw, ["type", "host", "user", "port", "keyPath", "remoteDir"], where);
      const host = str(raw["host"], "host", where);
      if (host.startsWith("-") || host.includes("..") || !HOST_RE.test(host)) throw new ReleaseConfigError(`${where}: host không hợp lệ.`);
      const user = str(raw["user"], "user", where);
      if (user.startsWith("-") || !USER_RE.test(user)) throw new ReleaseConfigError(`${where}: user không hợp lệ.`);
      const port = raw["port"] === undefined ? 22 : raw["port"];
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new ReleaseConfigError(`${where}: port phải từ 1 đến 65535.`);
      const keyPath = str(raw["keyPath"], "keyPath", where);
      if (keyPath.startsWith("-") || keyPath.includes("..") || /[\r\n\0]/.test(keyPath)) throw new ReleaseConfigError(`${where}: đường dẫn khóa SSH không hợp lệ.`);
      const remoteDir = str(raw["remoteDir"], "remoteDir", where);
      if (!REMOTE_DIR_RE.test(remoteDir) || remoteDir.startsWith("-") || remoteDir.includes("..")) throw new ReleaseConfigError(`${where}: thư mục đích không hợp lệ.`);
      return { type: "ssh-deploy", host, user, port, keyPath, remoteDir };
    }
    case "healthcheck": {
      noUnknownKeys(raw, ["type", "url", "expectStatus"], where);
      const url = str(raw["url"], "url", where);
      let ok = false;
      try {
        const u = new URL(url);
        ok = (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
      } catch {
        ok = false;
      }
      if (!ok) throw new ReleaseConfigError(`${where}: url phải là http/https hợp lệ và không chứa tài khoản.`);
      const expectStatus = raw["expectStatus"] === undefined ? 200 : raw["expectStatus"];
      if (typeof expectStatus !== "number" || !Number.isInteger(expectStatus) || expectStatus < 100 || expectStatus > 599) {
        throw new ReleaseConfigError(`${where}: expectStatus phải từ 100 đến 599.`);
      }
      return { type: "healthcheck", url, expectStatus };
    }
    default:
      throw new ReleaseConfigError(`${where}: kiểu bước "${String(type)}" không được hỗ trợ.`);
  }
}

export function validateReleaseConfig(input: unknown): ReleaseConfig {
  if (!isObj(input)) throw new ReleaseConfigError("Cấu hình phát hành phải là một đối tượng JSON.");
  noUnknownKeys(input, ["template", "extraScripts", "steps"], "Cấu hình");
  const extraRaw = input["extraScripts"] === undefined ? [] : input["extraScripts"];
  if (!Array.isArray(extraRaw)) throw new ReleaseConfigError("extraScripts phải là danh sách.");
  if (extraRaw.length > MAX_EXTRA_SCRIPTS) throw new ReleaseConfigError(`Tối đa ${MAX_EXTRA_SCRIPTS} script khai báo thêm.`);
  const extraScripts: string[] = [];
  for (const s of extraRaw) {
    if (typeof s !== "string" || !SCRIPT_RE.test(s)) throw new ReleaseConfigError(`Tên script "${String(s)}" không hợp lệ (chỉ A-Z a-z 0-9 : _ -).`);
    if (!extraScripts.includes(s)) extraScripts.push(s);
  }
  const stepsRaw = input["steps"];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) throw new ReleaseConfigError("Cần ít nhất một bước phát hành.");
  if (stepsRaw.length > MAX_STEPS) throw new ReleaseConfigError(`Tối đa ${MAX_STEPS} bước.`);
  const scripts = new Set<string>([...BUILTIN_SCRIPTS, ...extraScripts]);
  const steps = stepsRaw.map((s, i) => validateStep(s, i, scripts));
  const out: ReleaseConfig = { extraScripts, steps };
  if (input["template"] !== undefined) {
    if (typeof input["template"] !== "string" || !SCRIPT_RE.test(input["template"])) throw new ReleaseConfigError("Tên mẫu không hợp lệ.");
    out.template = input["template"];
  }
  return out;
}

export function releaseConfigPath(dataDir: string, name: string): string {
  return path.join(dataDir, "projects", projectSlug(name), "release.json");
}

export function readReleaseConfig(dataDir: string, name: string): ReleaseConfig | null {
  const file = releaseConfigPath(dataDir, name);
  if (!fs.existsSync(file)) return null;
  try {
    return validateReleaseConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    if (e instanceof ReleaseConfigError) throw e;
    throw new ReleaseConfigError("File release.json bị hỏng, không đọc được JSON.");
  }
}

export function writeReleaseConfig(dataDir: string, name: string, input: unknown): ReleaseConfig {
  const config = validateReleaseConfig(input);
  const file = releaseConfigPath(dataDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}
