import fs from "node:fs";
import path from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const NO_VERSION_MSG = "package.json không có trường version hợp lệ, không thể phát hành";

export function bumpPatchVersion(v: string): string | null {
  const m = SEMVER.exec(v);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Replace the first top-level-looking `"version": "x"` in the text, keeping all formatting. Null when absent. */
export function bumpPatchJson(text: string): { text: string; previous: string; next: string } | null {
  const re = /("version"\s*:\s*")([^"]*)(")/;
  const m = re.exec(text);
  if (!m) return null;
  const next = bumpPatchVersion(m[2]!);
  if (!next) return null;
  return { text: text.slice(0, m.index) + m[1] + next + m[3] + text.slice(m.index + m[0].length), previous: m[2]!, next };
}

/** package-lock: root `version` and `packages[""].version` (the first two "version" entries after the name). */
export function bumpLockJson(text: string, previous: string, next: string): string {
  let out = text;
  // root version: first occurrence
  const root = /("version"\s*:\s*")([^"]*)(")/.exec(out);
  if (root && root[2] === previous) out = out.slice(0, root.index) + root[1] + next + root[3] + out.slice(root.index + root[0].length);
  // packages[""] version: first "version" after `"": {`
  const pk = /("packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?"version"\s*:\s*")([^"]*)(")/.exec(out);
  if (pk && pk[2] === previous) out = out.slice(0, pk.index) + pk[1] + next + pk[3] + out.slice(pk.index + pk[0].length);
  return out;
}

export interface PublishPlan {
  previous: string;
  next: string;
  files: Array<{ rel: string; content: string }>;
}

/** Read package.json (+ lock) and compute the new contents without writing. Throws Vietnamese errors. */
export function planPublish(repoPath: string): PublishPlan {
  const pj = path.join(repoPath, "package.json");
  if (!fs.existsSync(pj)) throw new Error("Project không phải Node, chưa hỗ trợ phát hành");
  const raw = fs.readFileSync(pj, "utf8");
  try {
    JSON.parse(raw);
  } catch {
    throw new Error("package.json không đọc được (JSON hỏng), không thể phát hành");
  }
  const b = bumpPatchJson(raw);
  if (!b) throw new Error(NO_VERSION_MSG);
  const files = [{ rel: "package.json", content: b.text }];
  const lk = path.join(repoPath, "package-lock.json");
  if (fs.existsSync(lk)) files.push({ rel: "package-lock.json", content: bumpLockJson(fs.readFileSync(lk, "utf8"), b.previous, b.next) });
  return { previous: b.previous, next: b.next, files };
}
