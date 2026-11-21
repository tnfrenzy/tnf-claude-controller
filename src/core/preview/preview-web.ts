import path from "node:path";
import { sanitizeEnv } from "../run/billing-guard.js";
import { pageSlug, splitCommand, type PreviewConfig } from "./preview-config.js";

export interface ProcHandle { pid: number | undefined; onExit(cb: (code: number | null) => void): void; log(): string[] }
export interface WebDeps {
  browserPath: string | null;
  spawnServer(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ProcHandle;
  killTree(pid: number): void;
  probe(url: string): Promise<number | null>;
  runBrowser(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; timedOut: boolean }>;
  sleep(ms: number): Promise<void>;
  fileOk(file: string): boolean;
  tmpProfile(): string;
  rmDir(dir: string): void;
}
export interface Shot { file: string; label: string; width: number; ok: boolean }
export interface WebResult { shots: Shot[]; error: string | null; logTail: string[] }

export const WEB_SIZES = [{ width: 375, height: 812 }, { width: 1280, height: 800 }];

export function edgeScreenshotArgs(profile: string, w: number, h: number, outFile: string, url: string): string[] {
  return ["--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${w},${h}`, "--virtual-time-budget=5000", `--screenshot=${outFile}`, url];
}

export async function waitReady(url: string, timeoutMs: number, deps: Pick<WebDeps, "probe" | "sleep">, serverExited: () => boolean): Promise<boolean> {
  let waited = 0;
  while (waited <= timeoutMs) {
    if (serverExited()) return false;
    const s = await deps.probe(url);
    if (s !== null && s < 500) return true;
    await deps.sleep(500);
    waited += 500;
  }
  return false;
}

export async function captureWeb(
  cfg: Extract<PreviewConfig, { kind: "web" }>,
  ctx: { cwd: string; outDir: string; onStep: (s: string) => void },
  deps: WebDeps,
): Promise<WebResult> {
  if (!deps.browserPath) return { shots: [], error: "Không tìm thấy Edge hoặc Chrome để chụp ảnh.", logTail: [] };
  const [cmd, ...args] = splitCommand(cfg.startCommand);
  if (!cmd) return { shots: [], error: "Thiếu lệnh chạy máy chủ phát triển.", logTail: [] };
  if ((await deps.probe(cfg.url)) !== null) {
    return { shots: [], error: `Đã có máy chủ khác đang chạy ở ${cfg.url}; hãy tắt nó trước khi chụp.`, logTail: [] };
  }
  const port = new URL(cfg.url).port;
  const env: NodeJS.ProcessEnv = { ...sanitizeEnv(process.env, "subscription"), BROWSER: "none", ...(port ? { PORT: port } : {}) };
  ctx.onStep("Đang khởi động máy chủ phát triển");
  const server = deps.spawnServer(cmd, args, { cwd: ctx.cwd, env });
  let exited = false;
  server.onExit(() => { exited = true; });
  const shots: Shot[] = [];
  try {
    ctx.onStep("Đang đợi máy chủ sẵn sàng");
    const ready = await waitReady(cfg.url, cfg.readyTimeoutSec * 1000, deps, () => exited);
    if (!ready) {
      const why = exited ? "Máy chủ phát triển đã thoát trước khi sẵn sàng." : `Máy chủ không phản hồi tại ${cfg.url} sau ${cfg.readyTimeoutSec} giây (kiểm tra lệnh chạy và cổng).`;
      return { shots, error: why, logTail: server.log().slice(-20) };
    }
    const profile = deps.tmpProfile();
    try {
      for (const page of cfg.pages) {
        for (const size of WEB_SIZES) {
          const name = `${pageSlug(page)}-${size.width}.png`;
          const file = path.join(ctx.outDir, name);
          ctx.onStep(`Đang chụp ${page} (${size.width} px)`);
          const r = await deps.runBrowser(deps.browserPath, edgeScreenshotArgs(profile, size.width, size.height, file, cfg.url + page), 40_000);
          shots.push({ file: name, label: page, width: size.width, ok: !r.timedOut && deps.fileOk(file) });
        }
      }
    } finally {
      deps.rmDir(profile);
    }
    return { shots, error: null, logTail: server.log().slice(-20) };
  } finally {
    if (server.pid !== undefined) deps.killTree(server.pid);
  }
}
