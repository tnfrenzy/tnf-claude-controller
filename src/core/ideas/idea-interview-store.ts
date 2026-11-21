/**
 * Ideas waiting for the user's interview answers ("awaiting_user"), kept on disk so a restart does not lose them:
 * <dataDir>/projects/<project>/interviews/<id>.json, id = the interviewer's run id. Removed once the split succeeds
 * or the user dismisses the idea.
 */
import fs from "node:fs";
import path from "node:path";

export interface PendingInterview {
  id: string;
  project: string;
  idea: string;
  source: "manual" | { scout: true; ref: string };
  webSearch: boolean;
  questions: string[];
  state: "awaiting_user";
  createdAt: number;
  costUsd: number;
  /** Error of the last split attempt after answering (the user may answer again). */
  lastError?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function dirOf(dataDir: string, project: string): string {
  return path.join(dataDir, "projects", project, "interviews");
}

function fileOf(dataDir: string, project: string, id: string): string | null {
  if (!ID_RE.test(id) || !PROJECT_RE.test(project)) return null;
  return path.join(dirOf(dataDir, project), `${id}.json`);
}

function isPending(v: unknown): v is PendingInterview {
  const o = v as Partial<PendingInterview> | null;
  return !!o && typeof o.id === "string" && typeof o.idea === "string" && Array.isArray(o.questions) && o.state === "awaiting_user";
}

export function savePendingInterview(dataDir: string, p: PendingInterview): void {
  const file = fileOf(dataDir, p.project, p.id);
  if (!file) throw new Error(`Mã phỏng vấn không hợp lệ: ${p.id}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function loadPendingInterview(dataDir: string, project: string, id: string): PendingInterview | null {
  const file = fileOf(dataDir, project, id);
  if (!file) return null;
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return isPending(v) && v.id === id ? v : null;
  } catch {
    return null;
  }
}

/** Every idea of the project still waiting for answers, oldest first. Never throws. */
export function listPendingInterviews(dataDir: string, project: string): PendingInterview[] {
  if (!PROJECT_RE.test(project)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dirOf(dataDir, project)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((n) => loadPendingInterview(dataDir, project, n.slice(0, -5)))
    .filter((p): p is PendingInterview => p !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function removePendingInterview(dataDir: string, project: string, id: string): boolean {
  const file = fileOf(dataDir, project, id);
  if (!file || !fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}
