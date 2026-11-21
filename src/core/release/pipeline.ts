import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { commitFiles, remoteExists } from "../git/git.js";
import { planPublish } from "../app/publish.js";
import type { ReleaseConfig } from "./config.js";
import { findIscc, INNO_MISSING_MSG } from "./inno.js";
import { findGitBash, minimalScriptEnv } from "./bash-locator.js";
import { findNodeToolchain, NODE_MISSING_MSG } from "./node-locator.js";
import { checkReleasePreconditions, checkScriptFormat, checkScriptReady } from "./preconditions.js";
import { redactSecrets } from "./redact.js";

export interface CommandResult {
  exitCode: number;
  output: string;
  /** Set to "timeout" when the runner killed the process for exceeding timeoutMs. */
  error?: string;
}
/** Injectable command runner: argv array, never a shell string. */
export type CommandRunner = (argv: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<CommandResult>;

export interface PlannedCommand {
  stepIndex: number;
  type: string;
  description: string;
  argv: string[];
  cwd: string;
}

export interface ReleaseTargets {
  remote?: string;
  deploy?: string;
  url?: string;
}

export class ReleasePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleasePlanError";
  }
}

/** npm without a shell: [node.exe, npm-cli.js] of a Node that really has npm (the installed controller's own node.exe has none). */
export function npmCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const t = findNodeToolchain(env);
  if (!t) throw new ReleasePlanError(NODE_MISSING_MSG);
  return [t.node, t.npmCli];
}

export interface PlanInput {
  repoPath: string;
  baseBranch: string;
  config: ReleaseConfig;
  /** Version the release will have (after bump). */
  version: string;
  isccPath?: string | undefined;
  bashPath?: string | null | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

function readScripts(repoPath: string): Record<string, unknown> {
  const pj = path.join(repoPath, "package.json");
  if (!fs.existsSync(pj)) throw new ReleasePlanError("Project không có package.json, không thể chạy bước build.");
  try {
    const parsed = JSON.parse(fs.readFileSync(pj, "utf8")) as { scripts?: Record<string, unknown> };
    return parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    throw new ReleasePlanError("package.json không đọc được (JSON hỏng).");
  }
}

export function installerExePath(repoPath: string, version: string): string {
  return path.join(repoPath, "build", `TNF-CLI-Setup-${version}.exe`);
}

/** Exact commands (argv arrays) the pipeline will run, in order. Pure apart from reading package.json. */
export function buildReleasePlan(i: PlanInput): PlannedCommand[] {
  const cwd = i.repoPath;
  const scripts = readScripts(i.repoPath);
  const out: PlannedCommand[] = [];
  i.config.steps.forEach((s, idx) => {
    const add = (description: string, argv: string[]) => out.push({ stepIndex: idx, type: s.type, description, argv, cwd });
    switch (s.type) {
      case "bump":
        add(`Tăng version lên ${i.version} (package.json, package-lock.json) và commit`, ["git", "commit", "-m", `chore(release): ${i.version}`]);
        break;
      case "build":
        if (s.script === "installer") {
          add(`Đóng gói Setup.exe bằng Inno Setup (${i.version})`, [i.isccPath ?? "ISCC", `/DMyAppVersion=${i.version}`, "installer/setup.iss"]);
        } else {
          if (!(s.script in scripts)) throw new ReleasePlanError(`package.json không có script "${s.script}" (bước ${idx + 1}).`);
          add(`npm run ${s.script}`, [...npmCommand(i.env), "run", s.script]);
        }
        break;
      case "tag":
        add(`Gắn tag ${s.prefix}${i.version}`, ["git", "tag", `${s.prefix}${i.version}`]);
        break;
      case "git-push":
        {
          const branch = s.branch ?? i.baseBranch;
          if (branch.startsWith("-") || branch.startsWith("+") || branch.includes(":")) throw new ReleasePlanError(`Bước ${idx + 1}: tên nhánh không hợp lệ.`);
          add(`Đẩy nhánh ${branch} lên ${s.remote}`, ["git", "push", s.remote, branch]);
          const tagStep = i.config.steps.find((t) => t.type === "tag");
          const tagName = s.tag ?? (tagStep && tagStep.type === "tag" ? `${tagStep.prefix}${i.version}` : null);
          if (tagName) {
            if (tagName.startsWith("-") || tagName.startsWith("+") || tagName.includes(":")) throw new ReleasePlanError(`Bước ${idx + 1}: tên tag không hợp lệ.`);
            add(`Đẩy tag ${tagName} lên ${s.remote}`, ["git", "push", s.remote, tagName]);
          }
        }
        break;
      case "project-script":
        try {
          checkScriptFormat(s);
        } catch (e) {
          throw new ReleasePlanError(`Bước ${idx + 1}: ${e instanceof Error ? e.message : String(e)}`);
        }
        add(`Chạy ${s.scriptPath} cho ${s.target} bằng bash (biến môi trường: ${s.keyEnvName}, tối đa ${s.timeoutMin ?? 30} phút)`, [i.bashPath ?? "bash", s.scriptPath, s.target]);
        break;
      case "ssh-deploy":
        add(`Triển khai lên ${s.user}@${s.host}:${s.remoteDir}`, [
          "ssh", "-i", s.keyPath, "-p", String(s.port), "-o", "BatchMode=yes", `${s.user}@${s.host}`, "--", `cd ${s.remoteDir} && git pull --ff-only`,
        ]);
        break;
      case "healthcheck":
        add(`Kiểm tra ${s.url} trả về ${s.expectStatus}`, ["GET", s.url]);
        break;
    }
  });
  return out;
}

export function releaseTargets(config: ReleaseConfig): ReleaseTargets {
  const t: ReleaseTargets = {};
  for (const s of config.steps) {
    if (s.type === "git-push") t.remote = s.remote;
    if (s.type === "ssh-deploy") t.deploy = `${s.host}:${s.remoteDir}`;
    if (s.type === "healthcheck") t.url = s.url;
  }
  return t;
}

export interface PreconditionResult {
  ok: boolean;
  message?: string;
}

export function runPreconditions(o: { repoPath: string; baseBranch: string; branch?: string | null }): PreconditionResult {
  try {
    checkReleasePreconditions({ repo: o.repoPath, base: o.baseBranch, branch: o.branch ?? null });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export interface DryRunResult {
  dryRun: true;
  ok: boolean;
  preconditions: PreconditionResult;
  version: string;
  plan: PlannedCommand[];
  targets: ReleaseTargets;
  error?: string;
}

/** Changes nothing: reads git state and package.json only. */
export function dryRunRelease(o: { repoPath: string; baseBranch: string; config: ReleaseConfig; branch?: string | null; isccPath?: string; env?: NodeJS.ProcessEnv }): DryRunResult {
  const preconditions = runPreconditions(o);
  const targets = releaseTargets(o.config);
  let version = "";
  let plan: PlannedCommand[] = [];
  let error: string | undefined;
  try {
    const p = planPublish(o.repoPath);
    version = o.config.steps.some((s) => s.type === "bump") ? p.next : p.previous;
    plan = buildReleasePlan({ repoPath: o.repoPath, baseBranch: o.baseBranch, config: o.config, version, isccPath: o.isccPath, bashPath: findGitBash(o.env ?? process.env), env: o.env });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { dryRun: true, ok: preconditions.ok && !error, preconditions, version, plan, targets, ...(error ? { error } : {}) };
}

// ---------------------------------------------------------------- real run

export type StepStatus = "ok" | "failed" | "skipped" | "running";

export interface StepLog {
  index: number;
  type: string;
  description: string;
  argv: string[][];
  status: StepStatus;
  exitCode: number | null;
  output: string;
  /** Healthcheck result; a failure is only reported, never rolled back. */
  health?: { ok: boolean; status: number | null };
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReleaseArtifact {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleaseLog {
  id: string;
  project: string;
  status: "success" | "failed" | "running";
  version: string;
  startedAt: string;
  endedAt: string;
  /** Rewritten every few seconds while the release runs; a silent log means the server died (see reconcileStaleRelease). */
  heartbeatAt?: string;
  error?: string;
  steps: StepLog[];
  warnings: string[];
  artifact?: ReleaseArtifact;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; redirect?: "manual" | "follow" }) => Promise<{ status: number }>;

/** Default runner: spawn without a shell, collect output. */
export const defaultRunner: CommandRunner = (argv, opts) =>
  new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd!, args, { cwd: opts.cwd, shell: false, windowsHide: true, ...(opts.env ? { env: opts.env } : {}) });
    let output = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === "win32" && child.pid) {
          try {
            spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: false, windowsHide: true, stdio: "ignore" });
          } catch {
            child.kill();
          }
        } else child.kill("SIGKILL");
      }, opts.timeoutMs);
    }
    const add = (d: Buffer) => {
      output += d.toString("utf8");
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 127, output: output + String(e.message) });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) resolve({ exitCode: 124, output: output + "\ntimeout", error: "timeout" });
      else resolve({ exitCode: code ?? 1, output });
    });
  });

const MAX_OUTPUT = 4000;
const tail = (s: string, extra: string[] = []) => redactSecrets(s.length > MAX_OUTPUT ? "…" + s.slice(-MAX_OUTPUT) : s, extra);
const SCRIPT_TIMEOUT_MS = 30 * 60 * 1000;

export function newReleaseId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${ts}-${crypto.randomBytes(3).toString("hex")}`;
}

export function releaseLogPath(dataDir: string, id: string): string {
  return path.join(dataDir, "releases", id, "log.json");
}

export function readReleaseLog(dataDir: string, id: string): ReleaseLog | null {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
  const f = releaseLogPath(dataDir, id);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as ReleaseLog;
  } catch {
    return null;
  }
}

/** A running release whose log has been silent this long is considered dead (the server that ran it stopped). */
export const RELEASE_STALE_MS = 5 * 60 * 1000;

/**
 * Pure: a log that says "running" but has not been rewritten for `staleMs` was abandoned (server closed or crashed mid-release).
 * Returns the repaired log (failed, with an explanation) or null when the log is fine.
 */
export function reconcileStaleRelease(log: ReleaseLog, now: number = Date.now(), staleMs: number = RELEASE_STALE_MS): ReleaseLog | null {
  if (log.status !== "running") return null;
  const last = Date.parse(log.heartbeatAt ?? log.startedAt);
  if (!Number.isFinite(last) || now - last <= staleMs) return null;
  const minutes = Math.max(1, Math.round((now - last) / 60000));
  const fixed: ReleaseLog = { ...log, steps: log.steps.map((st) => ({ ...st })), warnings: [...log.warnings] };
  fixed.status = "failed";
  fixed.endedAt = new Date(last).toISOString();
  delete fixed.heartbeatAt;
  fixed.error = `Server dừng giữa chừng khi đang phát hành: nhật ký không được ghi thêm ${minutes} phút. Có thể app hoặc cửa sổ server đã bị đóng; hãy giữ app mở cho tới khi xong.`;
  for (const st of fixed.steps) {
    if (st.status === "running") {
      st.status = "failed";
      st.output = (st.output ? `${st.output}\n` : "") + "Bị ngắt: server dừng trước khi bước này xong.";
      st.endedAt = fixed.endedAt;
    }
  }
  const bumpDone = fixed.steps.some((st) => st.type === "bump" && st.status === "ok");
  if (bumpDone && fixed.version) {
    fixed.warnings.push(`Đã commit "chore(release): ${fixed.version}" trước khi server dừng; version trong repo đã tăng, cần xử lý thủ công nếu muốn phát hành lại.`);
  }
  return fixed;
}

/** readReleaseLog plus stale repair: an abandoned "running" log is rewritten as failed so the UI stops waiting on it. */
export function readReleaseLogChecked(dataDir: string, id: string, now: number = Date.now()): ReleaseLog | null {
  const log = readReleaseLog(dataDir, id);
  if (!log) return null;
  const fixed = reconcileStaleRelease(log, now);
  if (!fixed) return log;
  try {
    fs.writeFileSync(releaseLogPath(dataDir, id), `${JSON.stringify(fixed, null, 2)}\n`, "utf8");
  } catch {
    /* read-only data dir: still report the repaired view */
  }
  return fixed;
}

export function listReleases(dataDir: string): Array<{ id: string; project: string; status: string; version: string; startedAt: string }> {
  const dir = path.join(dataDir, "releases");
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ id: string; project: string; status: string; version: string; startedAt: string }> = [];
  for (const id of fs.readdirSync(dir)) {
    const l = readReleaseLogChecked(dataDir, id);
    if (l) out.push({ id: l.id, project: l.project, status: l.status, version: l.version, startedAt: l.startedAt });
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface ExecuteInput {
  /** Heartbeat interval in ms (default 15 s); tests shorten it. */
  heartbeatMs?: number;
  dataDir: string;
  /** Pre-generated release id (so the server can return it before the chain finishes). */
  id?: string;
  projectName: string;
  repoPath: string;
  baseBranch: string;
  config: ReleaseConfig;
  branch?: string | null;
  runner?: CommandRunner;
  fetch?: FetchLike;
  exists?: (p: string) => boolean;
  env?: NodeJS.ProcessEnv | undefined;
  healthTimeoutMs?: number;
  /** Override of the project-script time limit (tests); default 30 minutes. */
  scriptTimeoutMs?: number;
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Run the configured chain for real. Stops at the first failing step; later steps are marked skipped. Writes data/releases/<id>/log.json. */
export async function executeRelease(i: ExecuteInput): Promise<ReleaseLog> {
  const runner = i.runner ?? defaultRunner;
  const doFetch: FetchLike = i.fetch ?? ((url, init) => fetch(url, init));
  const exists = i.exists ?? fs.existsSync;
  const env = i.env ?? process.env;
  const id = i.id ?? newReleaseId();
  const startedAt = new Date().toISOString();
  const steps: StepLog[] = i.config.steps.map((s, index) => ({
    index, type: s.type, description: "", argv: [], status: "skipped", exitCode: null, output: "", startedAt: null, endedAt: null,
  }));
  const log: ReleaseLog = { id, project: i.projectName, status: "failed", version: "", startedAt, endedAt: startedAt, steps, warnings: [] };
  const save = () => {
    const f = releaseLogPath(i.dataDir, id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(log, null, 2) + "\n", "utf8");
  };
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const finish = (): ReleaseLog => {
    if (heartbeat) clearInterval(heartbeat);
    delete log.heartbeatAt;
    log.endedAt = new Date().toISOString();
    if (log.status === "running") log.status = "failed";
    save();
    return log;
  };
  const secrets: string[] = [];
  for (const s of i.config.steps) {
    if (s.type === "project-script") secrets.push(s.keyPath, path.resolve(i.repoPath, s.keyPath));
  }

  const pre = runPreconditions({ repoPath: i.repoPath, baseBranch: i.baseBranch, branch: i.branch ?? null });
  if (!pre.ok) {
    log.error = pre.message ?? "";
    return finish();
  }
  let plan: PlannedCommand[];
  let next: string;
  let publishFiles: Array<{ rel: string; content: string }>;
  const iscc = findIscc(env, exists);
  const bashPath = findGitBash(env, exists);
  try {
    const p = planPublish(i.repoPath);
    const bumps = i.config.steps.some((s) => s.type === "bump");
    next = bumps ? p.next : p.previous;
    publishFiles = p.files;
    plan = buildReleasePlan({ repoPath: i.repoPath, baseBranch: i.baseBranch, config: i.config, version: next, isccPath: iscc ?? undefined, bashPath, env });
  } catch (e) {
    log.error = e instanceof Error ? e.message : String(e);
    return finish();
  }
  log.version = next;
  let bumped = false;
  for (const st of steps) {
    const cmds = plan.filter((c) => c.stepIndex === st.index);
    st.description = cmds[0]?.description ?? "";
    st.argv = cmds.map((c) => c.argv.map((a) => redactSecrets(a, secrets)));
  }
  log.status = "running";
  log.heartbeatAt = new Date().toISOString();
  save();
  heartbeat = setInterval(() => {
    log.heartbeatAt = new Date().toISOString();
    try {
      save();
    } catch {
      /* a failed heartbeat write must never break the release */
    }
  }, i.heartbeatMs ?? 15_000);
  heartbeat.unref?.();

  for (const st of steps) {
    const cmds = plan.filter((c) => c.stepIndex === st.index);
    st.startedAt = new Date().toISOString();
    st.status = "running";
    save();
    const cfgStep = i.config.steps[st.index]!;
    let failure: string | null = null;
    let out = "";
    let code: number | null = 0;
    try {
      if (cfgStep.type === "bump") {
        for (const f of publishFiles) fs.writeFileSync(path.join(i.repoPath, f.rel), f.content);
        const commit = commitFiles(i.repoPath, publishFiles.map((f) => f.rel), `chore(release): ${next}`);
        bumped = true;
        out = `commit ${commit}`;
      } else if (cfgStep.type === "healthcheck") {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), i.healthTimeoutMs ?? 15000);
        try {
          const res = await doFetch(cfgStep.url, { signal: ctl.signal, redirect: "manual" });
          code = res.status;
          out = `HTTP ${res.status}`;
          st.health = { ok: res.status === cfgStep.expectStatus, status: res.status };
          if (res.status !== cfgStep.expectStatus) failure = `Healthcheck trả về ${res.status}, cần ${cfgStep.expectStatus}.`;
        } catch (e) {
          st.health = { ok: false, status: null };
          failure = `Healthcheck không kết nối được: ${e instanceof Error ? e.message : String(e)}`;
        } finally {
          clearTimeout(timer);
        }
      } else if (cfgStep.type === "project-script") {
        const remote = i.config.steps.find((t) => t.type === "git-push");
        try {
          checkScriptReady({
            repo: i.repoPath, base: i.baseBranch, remote: remote && remote.type === "git-push" ? remote.remote : "origin",
            scriptPath: cfgStep.scriptPath, target: cfgStep.target, keyPath: cfgStep.keyPath, bashPath, exists,
          });
        } catch (e) {
          failure = e instanceof Error ? e.message : String(e);
        }
        if (!failure && cmds[0]) {
          const keyAbs = path.resolve(i.repoPath, cfgStep.keyPath);
          const sEnv = minimalScriptEnv({ keyEnvName: cfgStep.keyEnvName, keyPath: keyAbs, bashPath: bashPath!, env });
          const limit = i.scriptTimeoutMs ?? Math.min(cfgStep.timeoutMin ?? 30, 30) * 60 * 1000;
          const r = await runner(cmds[0].argv, { cwd: cmds[0].cwd, env: sEnv, timeoutMs: Math.min(limit, SCRIPT_TIMEOUT_MS) });
          out = r.output;
          code = r.exitCode;
          if (r.error === "timeout") failure = "Script quá thời hạn và đã bị dừng; kiểm tra khóa deploy trên máy chủ.";
          else if (r.exitCode !== 0) failure = `Script thất bại (mã ${r.exitCode}).`;
        }
      } else {
        const isInstaller = cfgStep.type === "build" && cfgStep.script === "installer";
        const isPush = cfgStep.type === "git-push";
        if (cfgStep.type === "git-push" && !remoteExists(i.repoPath, cfgStep.remote)) {
          failure = `Remote "${cfgStep.remote}" không tồn tại trong repo; dừng, không đẩy gì lên.`;
        } else if (isInstaller && !iscc) {
          failure = INNO_MISSING_MSG;
        } else {
          for (const c of cmds) {
            const argv = isInstaller ? [iscc!, ...c.argv.slice(1)] : c.argv;
            if (argv.some((a) => a === "--force" || a === "-f" || a === "--force-with-lease")) {
              failure = "Từ chối chạy lệnh có --force.";
              break;
            }
            // git push keeps the machine's credential helper (inherited env) but never prompts.
            const r = await runner(argv, isPush ? { cwd: c.cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0" } } : { cwd: c.cwd });
            out += (out ? "\n" : "") + r.output;
            code = r.exitCode;
            if (r.exitCode !== 0) {
              failure = `Lệnh thất bại (mã ${r.exitCode}): ${redactSecrets(c.argv.slice(0, 4).join(" "))}`;
              break;
            }
          }
          if (!failure && isInstaller) {
            const exe = installerExePath(i.repoPath, next);
            if (!exists(exe) || !fs.existsSync(exe)) failure = `Không thấy file Setup sau khi đóng gói: ${exe}`;
            else log.artifact = { path: exe, size: fs.statSync(exe).size, sha256: sha256File(exe) };
          }
        }
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    st.output = tail(out + (failure ? (out ? "\n" : "") + failure : ""), secrets);
    st.exitCode = code;
    st.endedAt = new Date().toISOString();
    st.status = failure ? "failed" : "ok";
    save();
    if (failure) {
      log.error = redactSecrets(failure);
      if (bumped && cfgStep.type !== "bump") {
        log.warnings.push(`Đã commit "chore(release): ${next}" trước khi bước ${st.index + 1} lỗi; version trong repo đã tăng, cần xử lý thủ công nếu muốn phát hành lại.`);
      } else if (bumped) {
        log.warnings.push("Bước bump lỗi nửa chừng; kiểm tra git status và commit chore(release) trong repo.");
      }
      return finish();
    }
  }
  log.status = "success";
  return finish();
}
