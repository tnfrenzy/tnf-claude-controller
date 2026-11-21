import fs from "node:fs";
import path from "node:path";

export type DiffComment = {
  file: string;
  line: number;
  side: "new" | "old";
  text: string;
};

export const MAX_COMMENTS = 50;
export const MAX_COMMENT_CHARS = 2000;

export type ValidateResult =
  | { ok: true; comments: DiffComment[] }
  | { ok: false; message: string };

/** Decode a git C-quoted string body (without the surrounding quotes). */
function unquoteGit(body: string): string {
  const bytes: number[] = [];
  const push = (s: string) => {
    for (const b of Buffer.from(s, "utf8")) bytes.push(b);
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    if (ch !== "\\" || i === body.length - 1) {
      push(ch);
      continue;
    }
    const n = body[i + 1] ?? "";
    if (/[0-7]/.test(n)) {
      let oct: string = n;
      let j = i + 2;
      while (j < body.length && oct.length < 3 && /[0-7]/.test(body[j] ?? "")) {
        oct += body[j] ?? "";
        j++;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
      i = j - 1;
      continue;
    }
    i++;
    if (n === "t") bytes.push(9);
    else if (n === "n") bytes.push(10);
    else if (n === "r") bytes.push(13);
    else push(n);
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Read one quoted token at the start of s; returns [decoded, rest] or null. */
function readQuoted(s: string): [string, string] | null {
  if (!s.startsWith('"')) return null;
  let i = 1;
  while (i < s.length) {
    if (s[i] === "\\") i += 2;
    else if (s[i] === '"') break;
    else i++;
  }
  if (i >= s.length) return null;
  return [unquoteGit(s.slice(1, i)), s.slice(i + 1)];
}

/** Extract the b/ path from the part of a "diff --git" line after the prefix. */
function parseDiffGitLine(rest: string): string | null {
  const q = readQuoted(rest);
  if (q) {
    const after = q[1].replace(/^ /, "");
    const qb = readQuoted(after);
    const b = qb ? qb[0] : after;
    return b.startsWith("b/") ? b.slice(2) : null;
  }
  const quotedB = rest.lastIndexOf(' "b/');
  if (quotedB >= 0 && rest.endsWith('"')) {
    const qb = readQuoted(rest.slice(quotedB + 1));
    if (qb && qb[0].startsWith("b/")) return qb[0].slice(2);
  }
  if (!rest.startsWith("a/")) return null;
  // Same name on both sides (also handles spaces in the name).
  let idx = rest.indexOf(" b/");
  let lastIdx = -1;
  while (idx >= 0) {
    lastIdx = idx;
    const left = rest.slice(2, idx);
    const right = rest.slice(idx + 3);
    if (left === right) return right;
    idx = rest.indexOf(" b/", idx + 1);
  }
  // Rename or unknown shape: take the last " b/" split.
  if (lastIdx >= 0) return rest.slice(lastIdx + 3);
  return null;
}

function filesOfPatch(text: string, into: Set<string>): void {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith("diff --git ")) continue;
    const f = parseDiffGitLine(line.slice("diff --git ".length));
    if (f) into.add(f);
  }
}

/** Files touched by a run's diff.patch (required) and uncommitted.patch (optional). */
export function diffFilesOfRun(runDir: string): Set<string> {
  const files = new Set<string>();
  const mainPatch = path.join(runDir, "diff.patch");
  if (!fs.existsSync(mainPatch)) {
    throw new Error("Run gốc chưa có diff.patch nên chưa thể nhận xét theo dòng.");
  }
  filesOfPatch(fs.readFileSync(mainPatch, "utf8"), files);
  const extra = path.join(runDir, "uncommitted.patch");
  if (fs.existsSync(extra)) {
    filesOfPatch(fs.readFileSync(extra, "utf8"), files);
  }
  return files;
}

function badPath(file: string): boolean {
  return (
    file.startsWith("/") ||
    /^[A-Za-z]:/.test(file) ||
    file.includes("..") ||
    file.includes("\\")
  );
}

export function validateDiffComments(
  input: unknown,
  allowedFiles: Set<string> | string[]
): ValidateResult {
  const allowed = allowedFiles instanceof Set ? allowedFiles : new Set(allowedFiles);
  if (!Array.isArray(input)) {
    return { ok: false, message: "Nhận xét phải là một danh sách." };
  }
  if (input.length === 0) {
    return { ok: false, message: "Danh sách nhận xét đang trống." };
  }
  if (input.length > MAX_COMMENTS) {
    return { ok: false, message: `Tối đa ${MAX_COMMENTS} nhận xét mỗi lần.` };
  }
  const out: DiffComment[] = [];
  for (let i = 0; i < input.length; i++) {
    const n = i + 1;
    const c = input[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return { ok: false, message: `Nhận xét #${n} không hợp lệ.` };
    }
    if (typeof c.file !== "string" || c.file === "") {
      return { ok: false, message: `Nhận xét #${n} thiếu tên file.` };
    }
    if (badPath(c.file)) {
      return { ok: false, message: `Nhận xét #${n} có đường dẫn file không hợp lệ.` };
    }
    if (!allowed.has(c.file)) {
      return { ok: false, message: `Nhận xét #${n} trỏ tới file không có trong diff.` };
    }
    if (typeof c.line !== "number" || !Number.isInteger(c.line) || c.line < 1) {
      return { ok: false, message: `Nhận xét #${n} có số dòng không hợp lệ.` };
    }
    if (typeof c.text !== "string" || c.text.trim() === "") {
      return { ok: false, message: `Nhận xét #${n} chưa có nội dung.` };
    }
    if (c.text.length > MAX_COMMENT_CHARS) {
      return {
        ok: false,
        message: `Nhận xét #${n} dài quá ${MAX_COMMENT_CHARS} ký tự.`,
      };
    }
    let side: "new" | "old" = "new";
    if (c.side !== undefined) {
      if (c.side !== "new" && c.side !== "old") {
        return { ok: false, message: `Nhận xét #${n} có phía diff không hợp lệ.` };
      }
      side = c.side;
    }
    out.push({ file: c.file, line: c.line, side, text: c.text });
  }
  return { ok: true, comments: out };
}

export function formatCommentsPrompt(comments: DiffComment[]): string {
  const sorted = comments.slice().sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line
  );
  const items = sorted.map((c) => {
    const label = c.side === "old" ? " (cũ)" : "";
    const body = c.text.split("\n").join("\n  ");
    return `- ${c.file}:${c.line}${label} — ${body}`;
  });
  return [
    "Hãy sửa đúng các chỗ được chỉ ra dưới đây trong diff hiện tại, không sửa chỗ khác:",
    "",
    ...items,
  ].join("\n");
}

export type PrepareResult = { ok: true; prompt: string } | { ok: false; message: string };

/** Validate comments against the parent run's diff and build the follow-up prompt. */
export function prepareCommentsFollowup(
  parentRunDir: string,
  parentKind: string,
  input: unknown
): PrepareResult {
  if (parentKind !== "coding") {
    return { ok: false, message: "Chỉ run lập trình mới nhận nhận xét theo dòng." };
  }
  let files: Set<string>;
  try {
    files = diffFilesOfRun(parentRunDir);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const v = validateDiffComments(input, files);
  if (!v.ok) return v;
  return { ok: true, prompt: formatCommentsPrompt(v.comments) };
}
