import fs from "node:fs";
import path from "node:path";
import { projectSlug } from "../run/context-scan.js";

/**
 * Per-project registry of features that already exist: `<dataDir>/projects/<slug>/features.md`.
 * Scout proposals, the idea-splitter and coding runs read it and drop anything already listed; the controller appends
 * a line whenever a queue command or run is committed/merged. Never throws (a broken registry must not stop a run).
 */
export const FEATURES_MAX_BYTES = 12 * 1024;

export function featuresPath(dataDir: string, project: string): string {
  return path.join(dataDir, "projects", projectSlug(project), "features.md");
}

const HEADER = (project: string) =>
  `# Tính năng đã có - ${project}\n\nDanh sách để loại trừ: đề xuất hoặc ý tưởng nào trùng một dòng dưới đây thì bỏ qua. Controller tự ghi thêm khi một tính năng được commit hoặc gộp; có thể sửa tay.\n\n`;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function clean(s: string, max: number): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function today(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function readFeatures(dataDir: string, project: string): string {
  try {
    return fs.readFileSync(featuresPath(dataDir, project), "utf8");
  } catch {
    return "";
  }
}

/** Append `- [date] title (ref)` unless the same title is already listed. Returns true when a line was added. */
export function appendFeature(dataDir: string, project: string, f: { title: string; ref?: string }, now: number = Date.now()): boolean {
  try {
    const title = clean(f.title, 160);
    if (!title) return false;
    const file = featuresPath(dataDir, project);
    const cur = readFeatures(dataDir, project);
    const key = normalize(title);
    if (cur.split("\n").some((l) => normalize(l.replace(/^-\s*\[[^\]]*\]\s*/, "").replace(/\s*\([^)]*\)\s*$/, "")) === key)) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = `- [${today(now)}] ${title}${f.ref ? ` (${clean(f.ref, 60)})` : ""}\n`;
    fs.writeFileSync(file, (cur || HEADER(project)) + (cur && !cur.endsWith("\n") ? "\n" : "") + line, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Features block for prompts: the file's tail (newest lines) within `maxBytes`; empty when there is none. */
export function featuresPromptBlock(dataDir: string, project: string, maxBytes: number = FEATURES_MAX_BYTES): string {
  const text = readFeatures(dataDir, project).trim();
  if (!text) return "";
  const buf = Buffer.from(text, "utf8");
  return buf.length <= maxBytes ? text : "...(đã cắt bớt dòng cũ)\n" + buf.subarray(buf.length - maxBytes).toString("utf8").replace(/^[^\n]*\n/, "");
}
