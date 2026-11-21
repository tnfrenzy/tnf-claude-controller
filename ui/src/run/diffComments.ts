import type { DiffFile } from "../components/run/DiffView.js";

/** A reviewer comment attached to one line of a diff. */
export type DiffComment = {
  file: string;
  line: number;
  side: "new" | "old";
  text: string;
};

export const MAX_COMMENTS = 50;
export const MAX_COMMENT_CHARS = 2000;

export type NumberedLine = DiffFile["lines"][number] & {
  oldLine: number | null;
  newLine: number | null;
};

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Assign old/new line numbers to diff lines using the hunk headers.
 * Does not mutate the input. Lines before a valid hunk header keep null.
 */
export function numberLines(lines: DiffFile["lines"]): NumberedLine[] {
  let oldN: number | null = null;
  let newN: number | null = null;
  return lines.map((l) => {
    if (l.kind === "hunk") {
      const m = HUNK_RE.exec(l.text);
      if (m) {
        oldN = Number(m[1]);
        newN = Number(m[2]);
      } else {
        oldN = null;
        newN = null;
      }
      return { ...l, oldLine: null, newLine: null };
    }
    if (l.kind === "meta" || oldN === null || newN === null) {
      return { ...l, oldLine: null, newLine: null };
    }
    if (l.kind === "ctx") {
      const r = { ...l, oldLine: oldN, newLine: newN };
      oldN++;
      newN++;
      return r;
    }
    if (l.kind === "del") {
      const r = { ...l, oldLine: oldN, newLine: null };
      oldN++;
      return r;
    }
    const r = { ...l, oldLine: null, newLine: newN };
    newN++;
    return r;
  });
}

/** Short FNV-1a 32-bit hash of a patch, as 8 hex chars. */
export function patchFingerprint(patch: string): string {
  let h = 2166136261;
  for (let i = 0; i < patch.length; i++) {
    h ^= patch.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Validate comments; returns Vietnamese error messages (empty = valid). */
export function validateComments(comments: DiffComment[], allowedFiles: string[]): string[] {
  const errors: string[] = [];
  if (comments.length > MAX_COMMENTS) {
    errors.push(`Quá nhiều nhận xét: ${comments.length} (tối đa ${MAX_COMMENTS}).`);
  }
  const allowed = new Set(allowedFiles);
  comments.forEach((c, i) => {
    const where = `${c.file}:${c.line}`;
    if (c.text.trim() === "") errors.push(`Nhận xét #${i + 1} (${where}) đang trống.`);
    if (c.text.length > MAX_COMMENT_CHARS) {
      errors.push(`Nhận xét #${i + 1} (${where}) dài quá ${MAX_COMMENT_CHARS} ký tự.`);
    }
    if (!Number.isInteger(c.line) || c.line <= 0) {
      errors.push(`Nhận xét #${i + 1} (${c.file}) có số dòng không hợp lệ: ${c.line}.`);
    }
    if (!allowed.has(c.file)) {
      errors.push(`Nhận xét #${i + 1} (${where}) trỏ tới file không có trong diff.`);
    }
  });
  return errors;
}

/** A draft comment plus the fingerprint of the diff it was written against. */
export type DraftComment = DiffComment & { fingerprint: string };

const sameKey = (a: DiffComment, file: string, line: number, side: "new" | "old") =>
  a.file === file && a.line === line && a.side === side;

/** Add or replace a draft (same file+line+side replaces). Returns the old list when full and the item is new. */
export function upsertDraft(list: DraftComment[], comment: DiffComment, fingerprint: string): DraftComment[] {
  const next: DraftComment = { ...comment, fingerprint };
  const idx = list.findIndex((d) => sameKey(d, comment.file, comment.line, comment.side));
  if (idx >= 0) return list.map((d, i) => (i === idx ? next : d));
  if (list.length >= MAX_COMMENTS) return list;
  return [...list, next];
}

export function removeDraft(list: DraftComment[], file: string, line: number, side: "new" | "old"): DraftComment[] {
  return list.filter((d) => !sameKey(d, file, line, side));
}

export function isTooLong(text: string): boolean {
  return text.length > MAX_COMMENT_CHARS;
}

/** True when any draft was written against a different diff than the current one. */
export function hasStaleDraft(list: DraftComment[], currentFingerprint: string): boolean {
  return list.some((d) => d.fingerprint !== currentFingerprint);
}

export type SubmitPlan = { errors: string[]; stale: boolean; comments: DiffComment[]; prompt: string };

/** Prepare a follow-up submission from drafts: validation, stale flag, plain comments and prompt. */
export function planSubmit(args: { drafts: DraftComment[]; allowedFiles: string[]; currentFingerprint: string }): SubmitPlan {
  const comments: DiffComment[] = args.drafts.map(({ file, line, side, text }) => ({ file, line, side, text }));
  return {
    errors: validateComments(comments, args.allowedFiles),
    stale: hasStaleDraft(args.drafts, args.currentFingerprint),
    comments,
    prompt: buildFollowupPrompt(comments),
  };
}

/** Build the follow-up prompt text; comment text is kept verbatim as data. */
export function buildFollowupPrompt(comments: DiffComment[]): string {
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
