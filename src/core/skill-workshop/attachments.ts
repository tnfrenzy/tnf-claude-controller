/**
 * Example attachments of a skill (files next to a training pair). Stored OUTSIDE the text pack
 * (`examples/train-<n>/input|expected/<name>`, same for holdout-<n>), see store.ts.
 * NOTE: the text-extension list and the name rule are copied in ui/src/skills/skillCreate.ts; keep both in sync.
 */
import { validateInboxName } from "../run/inbox.js";
import { SkillError } from "./package.js";

export const ATTACH_LIMITS = {
  fileBytes: 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
  filesPerSide: 10,
  promptFileBytes: 8 * 1024,
  promptPairBytes: 24 * 1024
} as const;

export const ATTACH_RE = /^examples\/(train|holdout)-[1-9][0-9]*\/(input|expected)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".html"] as const;

export type AttachSide = "input" | "expected";

export interface AttachedFileInfo {
  name: string;
  size: number;
  text?: string;
}

export function isTextAttachment(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function validateAttachmentName(name: string): string {
  const reason = validateInboxName(name);
  if (reason) throw new SkillError(`Tên tệp đính kèm "${name}" không hợp lệ: ${reason}`, 400, "attach_bad_name");
  return name;
}

export function attachmentRel(pair: string, side: string, name: string): string {
  const rel = `examples/${pair}/${side}/${name}`;
  if (!/^(train|holdout)-[1-9][0-9]*$/.test(pair)) throw new SkillError(`Tên cặp mẫu không hợp lệ: "${pair}".`, 400, "attach_bad_pair");
  if (side !== "input" && side !== "expected") throw new SkillError(`Phía tệp đính kèm không hợp lệ: "${side}" (chỉ input hoặc expected).`, 400, "attach_bad_side");
  validateAttachmentName(name);
  if (!ATTACH_RE.test(rel)) throw new SkillError("Đường dẫn tệp đính kèm không hợp lệ.", 400, "attach_bad_path");
  return rel;
}

function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function clip(text: string, max: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  return buf.subarray(0, max).toString("utf8").replace(/�+$/, "") + "\n…(đã cắt)";
}

/** Markdown block for a prompt: text files embedded (cut), binary files listed by name and size only. */
export function renderAttachmentsForPrompt(files: AttachedFileInfo[]): string {
  if (!files.length) return "";
  const parts: string[] = [];
  const binary: AttachedFileInfo[] = [];
  let budget: number = ATTACH_LIMITS.promptPairBytes;
  for (const f of files) {
    if (f.text === undefined) {
      binary.push(f);
      continue;
    }
    const take = Math.max(0, Math.min(ATTACH_LIMITS.promptFileBytes, budget));
    const body = take > 0 ? clip(f.text, take) : "…(đã cắt)";
    budget -= Math.min(Buffer.byteLength(f.text, "utf8"), take);
    parts.push(`#### ${f.name} (${fmtSize(f.size)})\n\`\`\`\n${body}\n\`\`\``);
  }
  if (binary.length) {
    parts.push(
      "Tệp nhị phân (agent không đọc được nội dung, chỉ ghi nhận tên và dung lượng):\n" +
        binary.map((f) => `- ${f.name} (${fmtSize(f.size)})`).join("\n")
    );
  }
  return parts.join("\n\n");
}
