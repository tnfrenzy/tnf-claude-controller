/**
 * Lessons learned from queued commands that failed (docs/PLANNER-QUEUE.md section 2e). One Vietnamese line per lesson in
 * <dataDir>/projects/<project>/lessons.md (separate from the hand-written memory.md); newest kept within ~4 KB, no duplicates.
 * The idea agents (interviewer, splitter, critic) read it as untrusted data.
 */
import fs from "node:fs";
import path from "node:path";

export const LESSONS_MAX_BYTES = 4096;
const LINE_MAX = 300;
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEADER = "# Bài học từ các lần chạy (tự ghi, mới nhất ở cuối)\n";

export function lessonsPath(dataDir: string, project: string): string {
  return path.join(dataDir, "projects", project, "lessons.md");
}

/** Lesson lines ("- ..."), oldest first. Never throws. */
function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.startsWith("- "));
  } catch {
    return [];
  }
}

/** Text of the lesson without its "- YYYY-MM-DD: " prefix (duplicate key). */
function keyOf(line: string): string {
  return line.replace(/^- (?:\d{4}-\d{2}-\d{2}: )?/, "").trim().toLowerCase();
}

/** Content for the prompts, or "" when there is none (or the project name is not a safe folder name). */
export function readLessons(dataDir: string, project: string): string {
  if (!PROJECT_RE.test(project)) return "";
  return readLines(lessonsPath(dataDir, project)).join("\n");
}

/**
 * Append one lesson line. Newlines collapsed, cut to 300 chars, an identical lesson moves to the end instead of being
 * repeated, and the oldest lines are dropped until the file fits LESSONS_MAX_BYTES. Returns false when nothing was written.
 */
export function appendLesson(dataDir: string, project: string, text: string, now: Date = new Date()): boolean {
  if (!PROJECT_RE.test(project)) return false;
  let body = text.replace(/\s+/g, " ").trim();
  if (!body) return false;
  if (body.length > LINE_MAX) body = `${body.slice(0, LINE_MAX - 1).trimEnd()}…`;
  const line = `- ${now.toISOString().slice(0, 10)}: ${body}`;
  const file = lessonsPath(dataDir, project);
  const key = keyOf(line);
  const lines = readLines(file).filter((l) => keyOf(l) !== key);
  lines.push(line);
  while (lines.length > 1 && Buffer.byteLength(HEADER + lines.join("\n") + "\n", "utf8") > LESSONS_MAX_BYTES) lines.shift();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, HEADER + lines.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, file);
  return true;
}

/** Lesson line for a queued command that failed. */
export function lessonForFailure(cmd: { id: string; title: string; ideaTitle?: string; files?: string[]; verify?: string }, reason: string): string {
  const parts = [`Lệnh "${cmd.title}" (${cmd.id}${cmd.ideaTitle ? `, ý tưởng "${cmd.ideaTitle}"` : ""}) lỗi: ${reason.trim() || "không rõ lý do"}.`];
  if (cmd.files?.length) parts.push(`Tệp: ${cmd.files.slice(0, 5).join(", ")}.`);
  if (cmd.verify) parts.push(`verify: ${cmd.verify}.`);
  return parts.join(" ");
}
