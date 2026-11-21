/**
 * Run inbox (5.5): files the user attaches to a run, stored in `<run-dir>/inbox/`. Pure helpers + small fs I/O,
 * no HTTP. The agents are told the absolute inbox path in the prompt (coding runs have cwd = worktree, not run dir).
 */
import fs from "node:fs";
import path from "node:path";

export const INBOX_MAX_BYTES = 5 * 1024 * 1024;
export const INBOX_MAX_FILES = 20;
export const INBOX_DIR = "inbox";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** ASCII file name only (letters, digits, `.`, `_`, `-`), no path separators, no `..`, no leading dot. Returns a Vietnamese reason or null. */
export function validateInboxName(name: string): string | null {
  if (!name) return "Thiếu tên tệp (header X-File-Name).";
  if (!NAME_RE.test(name)) return "Tên tệp chỉ được chứa chữ cái không dấu, số, dấu chấm, gạch dưới, gạch ngang; không có dấu cách hay đường dẫn.";
  if (name.includes("..")) return "Tên tệp không được chứa \"..\".";
  return null;
}

export interface InboxFile {
  name: string;
  size: number;
  mtime: number;
}

export function listInbox(runDir: string): InboxFile[] {
  const dir = path.join(runDir, INBOX_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const st = fs.statSync(path.join(dir, e.name));
      return { name: e.name, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Write one file into `<runDir>/inbox/`. Throws (Vietnamese message) on a bad name, oversize body or a full inbox. */
export function saveInboxFile(runDir: string, name: string, data: Buffer): InboxFile {
  const bad = validateInboxName(name);
  if (bad) throw new Error(bad);
  if (data.length === 0) throw new Error("Tệp rỗng.");
  if (data.length > INBOX_MAX_BYTES) throw new Error(`Tệp quá lớn (tối đa ${INBOX_MAX_BYTES / 1024 / 1024} MB).`);
  const dir = path.join(runDir, INBOX_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const existing = listInbox(runDir);
  if (!existing.some((f) => f.name === name) && existing.length >= INBOX_MAX_FILES) throw new Error(`Hộp thư đã đủ ${INBOX_MAX_FILES} tệp.`);
  const file = path.join(dir, name);
  // Belt and braces: the resolved path must stay inside the inbox directory.
  if (path.dirname(path.resolve(file)) !== path.resolve(dir)) throw new Error("Tên tệp không hợp lệ.");
  fs.writeFileSync(file, data);
  const st = fs.statSync(file);
  return { name, size: st.size, mtime: st.mtimeMs };
}

/**
 * Move a staging directory's files (`<stageDir>/inbox/*`, as written by `saveInboxFile(stageDir, …)`) into the run
 * inbox, then delete the staging directory. Used when files were attached before the run existed.
 */
export function adoptStagedInbox(stageDir: string, runDir: string): InboxFile[] {
  const src = path.join(stageDir, INBOX_DIR);
  if (!fs.existsSync(src)) return listInbox(runDir);
  const dest = path.join(runDir, INBOX_DIR);
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (!e.isFile() || validateInboxName(e.name)) continue;
    fs.renameSync(path.join(src, e.name), path.join(dest, e.name));
  }
  fs.rmSync(stageDir, { recursive: true, force: true });
  return listInbox(runDir);
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Text appended to the user prompt so the coordinator (and the roles it briefs) know where the attachments are.
 * Empty string when the inbox is empty. Paths use `/` so the Read tool matches them on Windows too.
 */
export function inboxPromptNote(runDir: string): string {
  const files = listInbox(runDir);
  if (files.length === 0) return "";
  const dir = path.join(runDir, INBOX_DIR).replace(/\\/g, "/");
  const lines = files.map((f) => `- ${dir}/${f.name} (${fmtSize(f.size)})`);
  const cadNote = files.some((f) => f.name.toLowerCase().endsWith(".cad.json"))
    ? "\nTệp <tên>.cad.json là bản tóm tắt dạng văn bản (lớp, thực thể, kích thước, hộp bao) của tệp CAD cùng tên; hãy đọc nó thay cho tệp DXF hoặc STEP gốc."
    : "";
  return `\n\n[Tệp đính kèm] Người dùng gửi kèm ${files.length} tệp trong thư mục ${dir} (chỉ đọc bằng Read, không sửa; chuyển đường dẫn này cho vai nào cần):\n${lines.join("\n")}${cadNote}`;
}
