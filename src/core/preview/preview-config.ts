import fs from "node:fs";
import path from "node:path";

export type PreviewConfig =
  | { kind: "none" }
  | { kind: "web"; startCommand: string; url: string; pages: string[]; readyTimeoutSec: number }
  | { kind: "desktop"; exePath: string; args: string[]; windowTitle: string; settleSec: number };

export const NO_PREVIEW: PreviewConfig = { kind: "none" };

const ASCII = /^[\x20-\x7E]+$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function intIn(v: unknown, def: number, min: number, max: number, label: string): number {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} phải là số nguyên từ ${min} đến ${max}.`);
  return n;
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** npm/npx/pnpm/yarn are .cmd shims on Windows and must go through cmd.exe. */
export function isCmdShimCommand(cmd: string): boolean {
  return /^(npm|npx|pnpm|yarn)(\.cmd)?$/i.test(cmd);
}

export function validatePreview(raw: unknown, exists: (p: string) => boolean = isFile): PreviewConfig {
  if (raw === undefined || raw === null) return NO_PREVIEW;
  const r = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = r["kind"];
  if (kind === undefined || kind === "none") return NO_PREVIEW;
  if (kind === "web") {
    const startCommand = str(r["startCommand"]);
    if (!startCommand) throw new Error("Thiếu lệnh chạy máy chủ phát triển.");
    if (startCommand.length > 300) throw new Error("Lệnh chạy quá dài.");
    const startTokens = splitCommand(startCommand);
    if (startTokens.length === 0) throw new Error("Thiếu lệnh chạy máy chủ phát triển.");
    if (isCmdShimCommand(startTokens[0]!)) assertSafeCommandTokens(startTokens);
    const url = str(r["url"]).replace(/\/+$/, "");
    let u: URL;
    try { u = new URL(url); } catch { throw new Error("Địa chỉ trang không hợp lệ."); }
    if (u.protocol !== "http:") throw new Error("Địa chỉ trang phải dùng http (máy chủ phát triển cục bộ).");
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new Error("Địa chỉ trang chỉ được là localhost hoặc 127.0.0.1.");
    const pagesIn = Array.isArray(r["pages"]) ? (r["pages"] as unknown[]).map(str).filter(Boolean) : [];
    const pages = pagesIn.length ? pagesIn : ["/"];
    if (pages.length > 12) throw new Error("Tối đa 12 trang.");
    for (const p of pages) {
      if (!p.startsWith("/")) throw new Error(`Đường dẫn trang "${p}" phải bắt đầu bằng "/".`);
      if (p.startsWith("//")) throw new Error(`Đường dẫn trang "${p}" không được bắt đầu bằng "//".`);
      if (p.split("/").includes("..")) throw new Error('Đường dẫn trang không được chứa "..".');
      if (p.split("/").some((seg) => /^(%2e)+$/i.test(seg))) throw new Error(`Đường dẫn trang "${p}" không được chứa đoạn %2e (dấu chấm mã hóa).`);
      if (!ASCII.test(p) || p.length > 200) throw new Error(`Đường dẫn trang "${p}" chỉ dùng ký tự ASCII, tối đa 200 ký tự.`);
    }
    return { kind: "web", startCommand, url, pages, readyTimeoutSec: intIn(r["readyTimeoutSec"], 60, 5, 300, "Thời gian đợi máy chủ (giây)") };
  }
  if (kind === "desktop") {
    const exePath = str(r["exePath"]);
    if (!exePath) throw new Error("Thiếu đường dẫn tệp .exe.");
    if (!path.win32.isAbsolute(exePath)) throw new Error("Đường dẫn .exe phải là đường dẫn tuyệt đối.");
    if (!ASCII.test(exePath)) throw new Error("Đường dẫn .exe chỉ nên dùng ký tự ASCII không dấu (quy ước của app).");
    if (!/\.exe$/i.test(exePath)) throw new Error("Tệp phải có đuôi .exe.");
    if (!exists(exePath)) throw new Error("Tệp .exe không tồn tại.");
    const windowTitle = str(r["windowTitle"]);
    if (!windowTitle) throw new Error("Thiếu tiêu đề cửa sổ để tìm cửa sổ cần chụp.");
    const args = Array.isArray(r["args"]) ? (r["args"] as unknown[]).map(String) : [];
    if (args.length > 10) throw new Error("Tối đa 10 đối số.");
    return { kind: "desktop", exePath, args, windowTitle, settleSec: intIn(r["settleSec"], 3, 1, 30, "Thời gian chờ cửa sổ vẽ xong (giây)") };
  }
  throw new Error("Giá trị kind không hợp lệ: loại xem trước phải là web, desktop hoặc none.");
}

/** Whitespace split; "double quoted" parts may contain spaces. No escapes, no shell semantics. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]!);
  return out;
}

export function pageSlug(page: string): string {
  const s = page.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return s || "home";
}

const UNSAFE_TOKEN_CHARS = /[&|<>^%!"()\r\n]/;

/** cmd.exe re-parses its command line, so tokens must not carry shell metacharacters. */
export function assertSafeCommandTokens(tokens: string[]): void {
  if (tokens.length === 0 || !tokens[0]) throw new Error("Thiếu lệnh chạy máy chủ phát triển.");
  for (const t of tokens) {
    if (UNSAFE_TOKEN_CHARS.test(t)) {
      throw new Error('Lệnh chạy máy chủ không được chứa ký tự điều khiển của shell (& | < > ^ % ! " ( ) hoặc xuống dòng). Chỉ ghi lệnh và đối số thường.');
    }
  }
}
