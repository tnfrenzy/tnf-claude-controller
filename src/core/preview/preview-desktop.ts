import fs from "node:fs";
import path from "node:path";
import type { PreviewConfig } from "./preview-config.js";
import type { ProcHandle, Shot } from "./preview-web.js";

export interface DesktopDeps {
  helperExe(): Promise<string>;
  spawnApp(exe: string, args: string[]): ProcHandle;
  killTree(pid: number): void;
  closeApp(pid: number): Promise<void>;
  runHelper(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean }>;
  sleep(ms: number): Promise<void>;
  fileOk(file: string): boolean;
}
export interface DesktopResult { shots: Shot[]; error: string | null }

export const HELPER_EXIT_MESSAGES: Record<number, string> = {
  2: "Không thấy cửa sổ khớp tiêu đề đã khai báo (kiểm tra tiêu đề cửa sổ, hoặc tăng thời gian chờ).",
  3: "Ảnh rỗng (toàn đen hoặc toàn trắng): ứng dụng có thể vẽ bằng GPU nên không chụp được kiểu này.",
  4: "Lỗi khi chụp cửa sổ.",
};

export function cscPath(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = (p) => fs.existsSync(p)): string | null {
  const win = env["WINDIR"] ?? env["SystemRoot"];
  if (!win) return null;
  const p = path.win32.join(win, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  return exists(p) ? p : null;
}

export function compileHelper(
  srcFile: string,
  outExe: string,
  run: (exe: string, args: string[]) => { code: number | null; stderr: string },
  csc: string | null,
): void {
  if (!csc) throw new Error("Không tìm thấy csc.exe của .NET Framework để biên dịch helper chụp cửa sổ.");
  const r = run(csc, ["/nologo", "/target:exe", "/reference:System.Drawing.dll", `/out:${outExe}`, srcFile]);
  if (r.code !== 0) throw new Error(`Không biên dịch được helper chụp cửa sổ: ${r.stderr.trim().slice(0, 300)}`);
}

export async function captureDesktop(
  cfg: Extract<PreviewConfig, { kind: "desktop" }>,
  ctx: { outDir: string; onStep: (s: string) => void },
  deps: DesktopDeps,
): Promise<DesktopResult> {
  let helper: string;
  try {
    helper = await deps.helperExe();
  } catch (e) {
    return { shots: [], error: e instanceof Error ? e.message : String(e) };
  }
  ctx.onStep("Đang mở ứng dụng");
  const app = deps.spawnApp(cfg.exePath, cfg.args);
  try {
    ctx.onStep("Đang đợi cửa sổ vẽ xong");
    await deps.sleep(cfg.settleSec * 1000);
    ctx.onStep("Đang chụp cửa sổ");
    const out = path.join(ctx.outDir, "window.png");
    const r = await deps.runHelper(helper, ["--title", cfg.windowTitle, ...(app.pid !== undefined ? ["--pid", String(app.pid)] : []), "--out", out], 30_000);
    if (r.timedOut) return { shots: [], error: "Chụp cửa sổ quá thời gian." };
    if (r.code !== 0) {
      const msg = HELPER_EXIT_MESSAGES[r.code ?? 4] ?? HELPER_EXIT_MESSAGES[4]!;
      return { shots: [], error: r.stderr.trim() && r.code === 4 ? `${msg} (${r.stderr.trim().slice(0, 200)})` : msg };
    }
    if (!deps.fileOk(out)) return { shots: [], error: "Không tạo được tệp ảnh." };
    return { shots: [{ file: "window.png", label: cfg.windowTitle, width: 0, ok: true }], error: null };
  } finally {
    if (app.pid !== undefined) await deps.closeApp(app.pid);
  }
}
