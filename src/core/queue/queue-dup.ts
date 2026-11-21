// Pure helpers for queue duplicate detection: text/path normalization and similarity.
import type { NewQueueCommand, QueueCommand, QueueStatus } from "./queue-store.js";

export function normalizeText(s: string): string {
  return s
    .normalize("NFC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of normalizeText(s).split(" ")) {
    if (t.length >= 2 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function normalizePath(p: string): string {
  let r = p.trim().replace(/\\/g, "/").toLowerCase();
  while (r.startsWith("./")) r = r.slice(2);
  while (r.endsWith("/")) r = r.slice(0, -1);
  return r.trim();
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function tokenSimilarity(textA: string, textB: string): number {
  return jaccard(tokenize(textA), tokenize(textB));
}

function pathSet(files: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const n = normalizePath(f);
    if (n !== "") out.add(n);
  }
  return out;
}

export function fileSimilarity(filesA: Iterable<string>, filesB: Iterable<string>): number {
  return jaccard(pathSet(filesA), pathSet(filesB));
}

export type DupLevel = "high" | "medium";

export type DupMatch = {
  id: string;
  title: string;
  score: number;
  tokenScore: number;
  fileScore: number;
  level: DupLevel;
};

export type DupOptions = {
  /** Statuses to compare against. Undefined = default active set; empty array = no status filter. */
  statuses?: QueueStatus[];
  highThreshold?: number;
  mediumThreshold?: number;
};

const DEFAULT_STATUSES: readonly QueueStatus[] = ["chờ duyệt", "đã duyệt", "đang chạy"];

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

export function findDuplicates(
  newCmd: Pick<NewQueueCommand, "title" | "body" | "files"> & { project: string },
  queue: QueueCommand[],
  opts: DupOptions = {},
): DupMatch[] {
  const high = opts.highThreshold ?? 0.8;
  const medium = opts.mediumThreshold ?? 0.5;
  const allowed: readonly QueueStatus[] | null =
    opts.statuses === undefined ? DEFAULT_STATUSES : opts.statuses.length === 0 ? null : opts.statuses;
  const newText = `${newCmd.title} ${newCmd.body}`;
  const newFiles = pathSet(newCmd.files ?? []);
  const out: DupMatch[] = [];
  for (const q of queue) {
    if (q.project !== newCmd.project) continue;
    if (allowed && !allowed.includes(q.status)) continue;
    const tokenScore = round4(tokenSimilarity(newText, `${q.title} ${q.body}`));
    const qFiles = pathSet(q.files ?? []);
    const bothFiles = newFiles.size > 0 && qFiles.size > 0;
    const fileScore = bothFiles ? round4(jaccard(newFiles, qFiles)) : 0;
    const score = round4(bothFiles ? 0.7 * tokenScore + 0.3 * fileScore : tokenScore);
    const level: DupLevel | null = score >= high ? "high" : score >= medium ? "medium" : null;
    if (level) out.push({ id: q.id, title: q.title, score, tokenScore, fileScore, level });
  }
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
