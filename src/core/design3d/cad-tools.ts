import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../app/config.js";

/** Folder with the Python scripts (tools/cad in the repo, <app>/tools/cad in the installed app). */
export const CAD_TOOLS_DIR = path.join(REPO_ROOT, "tools", "cad");
export const CAD_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const CAD_TIMEOUT_MS = 120_000;
const CAD_MAX_OUTPUT = 1_500_000;

/** Where the CAD venv lives by default: outside any workspace folder, so cleaning a workspace never removes it. */
export const CAD_DEFAULT_PYTHON = "D:\\tnf-cad-tools\\cad-venv\\Scripts\\python.exe";

export const CAD_PYTHON_MISSING_MSG =
  "Chưa có Python cho công cụ CAD. Cài Python 3.12, tạo môi trường ảo tại D:\\tnf-cad-tools\\cad-venv (py -3.12 -m venv D:\\tnf-cad-tools\\cad-venv) " +
  "rồi chạy: D:\\tnf-cad-tools\\cad-venv\\Scripts\\python.exe -m pip install ezdxf cadquery trimesh pillow usd-core " +
  "(thêm fast-simplification nếu muốn bản GLB nhẹ cho điện thoại). Venv ở chỗ khác thì đặt đường dẫn python.exe vào tools.cad.python " +
  "trong controller.json hoặc biến TNF_CAD_PYTHON. Xem docs/CAD-TOOLS.md.";

export type CadKind = "dxf" | "step";

/** What the file extension means: a supported kind, "dwg" (closed format, needs ODA File Converter) or null. */
export function cadKind(name: string): CadKind | "dwg" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".dxf")) return "dxf";
  if (n.endsWith(".step") || n.endsWith(".stp")) return "step";
  if (n.endsWith(".dwg")) return "dwg";
  return null;
}

const SCRIPT: Record<CadKind, string> = { dxf: "dxf_info.py", step: "step_info.py" };

/** First python.exe that exists: TNF_CAD_PYTHON, the configured path, then the usual venv locations. */
export function findCadPython(
  env: NodeJS.ProcessEnv = process.env,
  configured: string | null | undefined = null,
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  const w = path.win32;
  const candidates = [
    env["TNF_CAD_PYTHON"],
    configured ?? undefined,
    CAD_DEFAULT_PYTHON,
    "D:\\tnf-claude-workspace\\tools\\cad-venv\\Scripts\\python.exe", // earlier location: a workspace folder may be cleaned up
    env["LOCALAPPDATA"] ? w.join(env["LOCALAPPDATA"], "TNF", "Controller", "tools", "cad-venv", "Scripts", "python.exe") : undefined,
  ];
  for (const c of candidates) if (c && exists(c)) return c;
  return null;
}

export interface CadRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
export type CadRunner = (python: string, args: string[], timeoutMs: number) => Promise<CadRunResult>;

/** After a timeout kill, wait at most this long for the pipes to close before giving up on the process. */
const KILL_GRACE_MS = 10_000;

/**
 * Kill a child and everything it started. A venv python.exe is a launcher that starts the real python.exe as its own
 * child; killing only the launcher leaves the real one running (holding outputs/ open). On Windows `taskkill /T /F`
 * (spawned without a shell, same as render.ts) kills the tree; elsewhere a plain kill.
 */
export function killTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    k.on("error", () => child.kill());
  } else {
    child.kill();
  }
}

/** spawn without a shell; stdout is capped; the whole process tree is killed on timeout. */
export const defaultCadRunner: CadRunner = (python, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(python, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let grace: NodeJS.Timeout | undefined;
    const finish = (r: CadRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      resolve(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // A grandchild that survived would keep the pipes open and "close" would never come.
      grace = setTimeout(() => finish({ code: null, stdout, stderr, timedOut }), KILL_GRACE_MS);
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < CAD_MAX_OUTPUT) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 20_000) stderr += d.toString("utf8");
    });
    child.on("error", (e) => finish({ code: null, stdout, stderr: stderr + String(e), timedOut }));
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
  });

export interface CadDeps {
  env?: NodeJS.ProcessEnv;
  /** `tools.cad.python` from controller.json. */
  configuredPython?: string | null;
  exists?: (p: string) => boolean;
  run?: CadRunner;
  toolsDir?: string;
  timeoutMs?: number;
}

export interface CadStatus {
  available: boolean;
  python: string | null;
  ezdxf: string | null;
  cadquery: string | null;
  message: string;
}

/** Versions of the CAD libraries (runs check_env.py once; the first cadquery import can take several seconds). */
export async function cadStatus(d: CadDeps = {}): Promise<CadStatus> {
  const python = findCadPython(d.env, d.configuredPython, d.exists);
  if (!python) return { available: false, python: null, ezdxf: null, cadquery: null, message: CAD_PYTHON_MISSING_MSG };
  const script = path.join(d.toolsDir ?? CAD_TOOLS_DIR, "check_env.py");
  const r = await (d.run ?? defaultCadRunner)(python, [script], d.timeoutMs ?? CAD_TIMEOUT_MS);
  if (r.timedOut) return { available: false, python, ezdxf: null, cadquery: null, message: "Kiểm tra công cụ CAD quá thời gian." };
  try {
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? "") as { ezdxf: string | null; cadquery: string | null; errors?: Record<string, string> };
    const missing = [j.ezdxf ? null : "ezdxf", j.cadquery ? null : "cadquery"].filter((x): x is string => x !== null);
    const message = missing.length ? `Thiếu thư viện trong môi trường Python: ${missing.join(", ")} (pip install ${missing.join(" ")}).` : "Sẵn sàng.";
    return { available: j.ezdxf !== null || j.cadquery !== null, python, ezdxf: j.ezdxf, cadquery: j.cadquery, message };
  } catch {
    return { available: false, python, ezdxf: null, cadquery: null, message: `Không chạy được Python của công cụ CAD: ${(r.stderr || "không có đầu ra").trim().slice(0, 200)}` };
  }
}

export type InspectResult = { ok: true; kind: CadKind; summary: unknown; json: string } | { ok: false; error: string };

/** Summarise one DXF or STEP file as JSON text an agent can read. Never throws; errors are Vietnamese messages. */
export async function inspectCad(file: string, d: CadDeps = {}): Promise<InspectResult> {
  const kind = cadKind(file);
  if (kind === "dwg") return { ok: false, error: "DWG là định dạng đóng: cần đổi sang DXF bằng ODA File Converter (chưa cài) rồi mới đọc được." };
  if (kind === null) return { ok: false, error: "Chỉ đọc được tệp .dxf, .step hoặc .stp." };
  const exists = d.exists ?? fs.existsSync;
  if (!exists(file)) return { ok: false, error: "Không thấy tệp CAD." };
  try {
    if (fs.statSync(file).size > CAD_MAX_FILE_BYTES) return { ok: false, error: `Tệp CAD quá lớn (tối đa ${CAD_MAX_FILE_BYTES / 1024 / 1024} MB).` };
  } catch {
    /* injected exists() without a real file: let the runner decide */
  }
  const python = findCadPython(d.env, d.configuredPython, d.exists);
  if (!python) return { ok: false, error: CAD_PYTHON_MISSING_MSG };
  const script = path.join(d.toolsDir ?? CAD_TOOLS_DIR, SCRIPT[kind]);
  const r = await (d.run ?? defaultCadRunner)(python, [script, file], d.timeoutMs ?? CAD_TIMEOUT_MS);
  if (r.timedOut) return { ok: false, error: "Đọc tệp CAD quá thời gian và đã bị dừng." };
  if (r.code !== 0) {
    const err = r.stderr;
    if (/ModuleNotFoundError|No module named/.test(err)) {
      const lib = kind === "dxf" ? "ezdxf" : "cadquery";
      return { ok: false, error: `Môi trường Python chưa có ${lib} (pip install ${lib}).` };
    }
    if (/DXFStructureError|Invalid DXF|not a DXF/i.test(err)) return { ok: false, error: "Tệp DXF hỏng hoặc không đọc được." };
    return { ok: false, error: `Không đọc được tệp CAD: ${err.trim().split(/\r?\n/).pop()?.slice(0, 200) ?? "lỗi không rõ"}` };
  }
  const text = r.stdout.trim();
  try {
    return { ok: true, kind, summary: JSON.parse(text), json: text };
  } catch {
    return { ok: false, error: "Công cụ CAD trả về kết quả không phải JSON." };
  }
}

export const CAD_SUMMARY_SUFFIX = ".cad.json";

/**
 * For every .dxf/.step/.stp in `dir` without a `<name>.cad.json` next to it, write that JSON summary so an agent (which can
 * only Read text) understands the drawing. Best effort: failures are skipped. Returns the summary files written.
 */
export async function addCadSummaries(dir: string, d: CadDeps = {}, maxFiles = 20): Promise<string[]> {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const written: string[] = [];
  for (const name of names) {
    const kind = cadKind(name);
    if (kind === null || kind === "dwg" || name.toLowerCase().endsWith(CAD_SUMMARY_SUFFIX)) continue;
    const out = path.join(dir, name + CAD_SUMMARY_SUFFIX);
    if (fs.existsSync(out) || names.length + written.length >= maxFiles) continue;
    const r = await inspectCad(path.join(dir, name), d);
    if (!r.ok) continue;
    try {
      fs.writeFileSync(out, r.json + "\n", "utf8");
      written.push(path.basename(out));
    } catch {
      /* ignore a failed write */
    }
  }
  return written;
}
