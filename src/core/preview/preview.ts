import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { assertSafeCommandTokens, isCmdShimCommand, type PreviewConfig } from "./preview-config.js";
import { sanitizeEnv } from "../run/billing-guard.js";
import { captureWeb, type ProcHandle, type Shot, type WebDeps } from "./preview-web.js";
import { captureDesktop, compileHelper, cscPath, type DesktopDeps } from "./preview-desktop.js";
import { locateBrowser } from "../app/browser-locator.js";

export interface PreviewJson {
  kind: "web" | "desktop";
  started_at: number;
  finished_at: number;
  status: "ok" | "partial" | "error";
  shots: Shot[];
  error: string | null;
  log_tail: string[];
}
export interface PreviewDeps {
  web: WebDeps;
  desktop: DesktopDeps;
}

export async function runPreview(
  cfg: PreviewConfig,
  ctx: { cwd: string; outDir: string; onStep: (s: string) => void },
  deps: PreviewDeps,
  now: () => number = Date.now,
): Promise<PreviewJson> {
  if (cfg.kind === "none") throw new Error("Môi trường chưa khai báo Xem trước.");
  const started_at = now();
  let r: { shots: Shot[]; error: string | null; logTail: string[] };
  try {
    r = cfg.kind === "web"
      ? await captureWeb(cfg, ctx, deps.web)
      : { ...(await captureDesktop(cfg, ctx, deps.desktop)), logTail: [] as string[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r = { shots: [], error: `Không chụp được: ${msg}`, logTail: [] };
  }
  const okCount = r.shots.filter((s) => s.ok).length;
  const status: PreviewJson["status"] = r.error || okCount === 0 ? "error" : okCount < r.shots.length ? "partial" : "ok";
  return {
    kind: cfg.kind,
    started_at,
    finished_at: now(),
    status,
    shots: r.shots,
    error: r.error ?? (okCount === 0 ? "Không chụp được ảnh nào." : null),
    log_tail: r.logTail,
  };
}

export function readPreviewJson(outDir: string): PreviewJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, "preview.json"), "utf8")) as PreviewJson;
  } catch {
    return null;
  }
}

function logOf(child: ReturnType<typeof spawn>, label: string): { lines: string[]; handle: ProcHandle } {
  const lines: string[] = [];
  const push = (b: Buffer) => {
    for (const l of b.toString("utf8").split(/\r?\n/)) {
      if (l.trim()) {
        lines.push(l.slice(0, 300));
        if (lines.length > 200) lines.shift();
      }
    }
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("error", (e: NodeJS.ErrnoException) => {
    lines.push(e.code === "ENOENT" ? `Không tìm thấy lệnh ${label}.` : `Không chạy được lệnh ${label} (${e.code ?? e.message}).`);
  });
  return {
    lines,
    handle: {
      pid: child.pid,
      onExit: (cb) => {
        child.once("exit", cb);
        child.once("error", () => cb(null));
      },
      log: () => lines.slice(),
    },
  };
}

function killTree(pid: number): void {
  try {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true, timeout: 15000 });
  } catch {
    /* already gone */
  }
}

/** Environment for the dev server / desktop app: the controller's env minus API-billing variables (subscription mode). */
export function previewChildEnv(base: NodeJS.ProcessEnv = process.env, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...sanitizeEnv(base, "subscription"), ...extra };
}

/** npm/npx/pnpm/yarn are .cmd shims on Windows and need cmd.exe; cmd re-parses the line, so tokens are checked first. Pure: spawns nothing. */
export function buildServerSpawn(cmd: string, args: string[]): { exe: string; args: string[] } {
  if (isCmdShimCommand(cmd)) {
    assertSafeCommandTokens([cmd, ...args]);
    return { exe: "cmd.exe", args: ["/d", "/s", "/c", cmd, ...args] };
  }
  return { exe: cmd, args };
}

export function defaultPreviewDeps(dataDir: string, repoRoot: string): PreviewDeps {
  const fileOk = (f: string) => {
    try {
      return fs.statSync(f).size > 0;
    } catch {
      return false;
    }
  };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const runExe = (exe: string, args: string[], timeoutMs: number) =>
    new Promise<{ code: number | null; stderr: string; timedOut: boolean }>((resolve) => {
      const c = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      let timedOut = false;
      c.stderr?.on("data", (b: Buffer) => {
        stderr += b.toString("utf8");
      });
      let grace: NodeJS.Timeout | undefined;
      const t = setTimeout(() => {
        timedOut = true;
        if (c.pid) killTree(c.pid);
        // Resolve even when taskkill fails and the process never reports exit.
        grace = setTimeout(() => resolve({ code: null, stderr, timedOut: true }), 2000);
      }, timeoutMs);
      c.once("exit", (code) => {
        clearTimeout(t);
        if (grace) clearTimeout(grace);
        resolve({ code, stderr, timedOut });
      });
      c.once("error", (e) => {
        clearTimeout(t);
        if (grace) clearTimeout(grace);
        resolve({ code: null, stderr: String(e), timedOut: false });
      });
    });
  const web: WebDeps = {
    browserPath: locateBrowser()?.path ?? null,
    spawnServer: (cmd, args, o) => {
      const plan = buildServerSpawn(cmd, args);
      return logOf(spawn(plan.exe, plan.args, { cwd: o.cwd, env: o.env, windowsHide: true }), cmd).handle;
    },
    killTree,
    probe: async (url) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return r.status;
      } catch {
        return null;
      }
    },
    runBrowser: async (exe, args, ms) => {
      const r = await runExe(exe, args, ms);
      return { code: r.code, timedOut: r.timedOut };
    },
    sleep,
    fileOk,
    tmpProfile: () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prev-")),
    rmDir: (d) => {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
  const desktop: DesktopDeps = {
    helperExe: async () => {
      const src = path.join(repoRoot, "tools", "preview-capture.cs");
      const outExe = path.join(dataDir, "tools", "preview-capture.exe");
      const stamp = outExe + ".stamp";
      const srcHash = createHash("sha256").update(fs.readFileSync(src)).digest("hex");
      if (fs.existsSync(outExe) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === srcHash) return outExe;
      fs.mkdirSync(path.dirname(outExe), { recursive: true });
      compileHelper(
        src,
        outExe,
        (exe, a) => {
          const r = spawnSync(exe, a, { windowsHide: true, encoding: "utf8", timeout: 60000 });
          return { code: r.status, stderr: `${r.stderr ?? ""}${r.stdout ?? ""}` };
        },
        cscPath(),
      );
      fs.writeFileSync(stamp, srcHash);
      return outExe;
    },
    spawnApp: (exe, args) => logOf(spawn(exe, args, { windowsHide: false, stdio: ["ignore", "pipe", "pipe"], env: previewChildEnv() }), exe).handle,
    killTree,
    closeApp: async (pid) => {
      spawnSync("powershell.exe", ["-NoProfile", "-Command", `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }`], { windowsHide: true, timeout: 15000 });
      await sleep(3000);
      killTree(pid);
    },
    runHelper: runExe,
    sleep,
    fileOk,
  };
  return { web, desktop };
}
