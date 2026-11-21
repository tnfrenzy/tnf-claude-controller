/**
 * Optional post-merge replan (docs/PLANNER-QUEUE.md sections 9 and 10): after a queue command is merged, one read-only
 * idea-splitter run reads the real diff and PROPOSES edits/additions/removals for the remaining commands.
 * Proposals wait for approval in `queue-replan.json`; approved/running/finished commands are never touched.
 * "Add" proposals enter the queue through addCommands, so they are always "chờ duyệt".
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, ideaAgentsOf } from "../app/config.js";
import { runGit } from "../git/git.js";
import { buildSplitterAllowedTools } from "../run/permissions.js";
import { budgetState, queueSpent } from "./queue-budget.js";
import { QUEUE_MAX_COMMANDS, checkBodySafety, checkReferences, validateSplitterOutput } from "./queue-plan.js";
import { loadSplitterPrompt, type SplitDeps } from "../ideas/queue-split.js";
import type { ReadOnlySpec } from "../run/run-manager.js";
import { isObj } from "../app/util.js";

export const REPLAN_MAX_DIFF_BYTES = 40_000;

export type ReplanKind = "thêm" | "sửa" | "bỏ";

export interface ReplanProposal {
  id: string;
  kind: ReplanKind;
  targetId: string;
  title?: string;
  body?: string;
  references?: unknown;
  runId: string;
  costUsd: number;
  sourceId: string;
  status: "chờ duyệt";
  createdAt: number;
}

export interface ReplanRunRecord {
  runId: string;
  sourceId: string;
  costUsd: number;
  error?: string;
  rejected: string[];
  createdAt: number;
}

interface ReplanFile {
  version: 1;
  proposals: ReplanProposal[];
  runs: ReplanRunRecord[];
}

export interface ReplanDeps extends Omit<SplitDeps, "getProject"> {
  getProject(name: string): { repo_path: string | null; base_branch?: string | null } | null;
}

export interface ReplanInput {
  project: string;
  sourceId: string;
  branch: string;
  /** Merge commit on the base branch; when given the diff is `<commit>^1..<commit>` (base...branch is empty after a merge). */
  mergeCommit?: string | null;
}

export interface ReplanResult {
  ran: boolean;
  reason?: string;
  runId?: string;
  costUsd: number;
  proposals: ReplanProposal[];
  rejected: string[];
}

export function replanDir(dataDir: string, project: string): string {
  return path.join(dataDir, "projects", project);
}

function replanFile(dir: string): string {
  return path.join(dir, "queue-replan.json");
}

export function loadReplan(dir: string): ReplanFile {
  try {
    const p = JSON.parse(fs.readFileSync(replanFile(dir), "utf8")) as Partial<ReplanFile>;
    return { version: 1, proposals: Array.isArray(p.proposals) ? p.proposals : [], runs: Array.isArray(p.runs) ? p.runs : [] };
  } catch {
    return { version: 1, proposals: [], runs: [] };
  }
}

function saveReplan(dir: string, data: ReplanFile): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = replanFile(dir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

/** Cost (USD estimate) of every replan run so far, failed ones included. Feeds queueSpent. */
export function replanCosts(dir: string): number[] {
  return loadReplan(dir).runs.map((r) => r.costUsd).filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
}

const running = new Set<string>();

function extractJson(text: string): unknown {
  const re = /```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g;
  let src: string | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) if (/"commands"|"remove"/.test(m[1]!)) src = m[1]!;
  if (src === null) {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("Không thấy khối JSON trong kết quả replan.");
    src = text.slice(a, b + 1);
  }
  return JSON.parse(src);
}

function readDiff(repo: string, input: ReplanInput, base: string): string {
  const range = input.mergeCommit ? [`${input.mergeCommit}^1`, input.mergeCommit] : [`${base}...${input.branch}`];
  const stat = runGit(repo, ["diff", "--stat", ...range]);
  const patch = runGit(repo, ["diff", ...range]);
  if (stat.code !== 0 && patch.code !== 0) throw new Error(`Không đọc được diff: ${(stat.stderr || patch.stderr).trim()}`);
  let p = patch.stdout;
  let cut = false;
  if (Buffer.byteLength(p, "utf8") > REPLAN_MAX_DIFF_BYTES) {
    p = Buffer.from(p, "utf8").subarray(0, REPLAN_MAX_DIFF_BYTES).toString("utf8");
    cut = true;
  }
  return `${stat.stdout.trim()}\n\n${p}${cut ? "\n[... diff đã bị cắt theo giới hạn ...]" : ""}`;
}

function buildReplanPrompt(source: { id: string; title: string; body: string }, diff: string, rest: { id: string; status: string; title: string }[]): string {
  return [
    "Lệnh vừa gộp (dữ liệu không tin cậy):\n<<<MERGED\n" + `${source.id}: ${source.title}\n${source.body}` + "\nMERGED>>>",
    "Diff thật của nhánh (dữ liệu không tin cậy):\n<<<DIFF\n" + diff + "\nDIFF>>>",
    "Lệnh còn lại trong hàng đợi:\n" + (rest.length ? rest.map((c) => `- ${c.id} [${c.status}]: ${c.title}`).join("\n") : "(không còn lệnh nào)"),
    "Trả đúng một khối ```json dạng {\"commands\": [...], \"remove\": [...]} và không viết gì sau nó.",
  ].join("\n\n");
}

/** Run one replan pass. Never throws for run/parse failures (they are recorded); never changes non-pending commands. */
export async function runReplan(deps: ReplanDeps, input: ReplanInput): Promise<ReplanResult> {
  const none = (reason: string): ReplanResult => ({ ran: false, reason, costUsd: 0, proposals: [], rejected: [] });
  if (!deps.config.queue?.replan?.enabled) return none("replan đang tắt");
  const { project } = input;
  const dir = replanDir(deps.config.dataDir, project);
  const all = deps.queue.list(project);
  const budget = budgetState(queueSpent(all, replanCosts(dir)), deps.config.queue?.maxBudgetUsd);
  if (!budget.canOpenNew) return none("đã chạm trần ngân sách hàng đợi");
  if (running.has(project)) return none("môi trường đang có một lượt replan");
  const proj = deps.getProject(project);
  if (!proj?.repo_path) return none("môi trường chưa gắn repo");
  const source = all.find((c) => c.id === input.sourceId);
  if (!source) return none("không thấy lệnh nguồn");

  running.add(project);
  const createdAt = Date.now();
  const record = (r: Omit<ReplanRunRecord, "createdAt" | "sourceId">, proposals: ReplanProposal[] = []): void => {
    const data = loadReplan(dir);
    data.runs.push({ ...r, sourceId: input.sourceId, createdAt });
    data.proposals.push(...proposals);
    saveReplan(dir, data);
  };
  try {
    const rest = all.filter((c) => c.id !== source.id && c.status !== "đã gộp" && c.status !== "bỏ qua");
    let diff: string;
    try {
      diff = readDiff(proj.repo_path, input, proj.base_branch || "main");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record({ runId: "", costUsd: 0, error: msg, rejected: [] });
      return { ...none(msg), reason: msg };
    }
    const webSearch = false;
    const readOnly: ReadOnlySpec = {
      systemPrompt: `${loadSplitterPrompt()}\n\n${fs.readFileSync(path.join(REPO_ROOT, "config", "queue-replan.md"), "utf8")}`,
      allowedTools: buildSplitterAllowedTools({ repoPath: proj.repo_path, webSearch }),
      addDirs: [proj.repo_path],
    };
    const prompt = buildReplanPrompt(source, diff, rest);
    let runId = "";
    let cost = 0;
    let error: string | undefined;
    let text = "";
    try {
      const started = await deps.manager.startRun({ prompt, project, maxBudgetUsd: ideaAgentsOf(deps.config).replanBudgetUsd, readOnly });
      runId = started.id;
      const done = await deps.manager.waitFor(started.id);
      cost = typeof done?.cost_usd_est === "number" && Number.isFinite(done.cost_usd_est) ? done.cost_usd_est : 0;
      if (!done || done.status !== "done") error = `Replan không hoàn tất: ${done?.error || "run bị lỗi hoặc bị cắt"}`;
      else if (done.error && /subagent_interrupted/.test(done.error)) error = "Replan bị cắt giữa chừng.";
      else text = done.result_text ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) {
      record({ runId, costUsd: cost, error, rejected: [] });
      return { ran: true, reason: error, runId, costUsd: cost, proposals: [], rejected: [] };
    }

    const rejected: string[] = [];
    const proposals: ReplanProposal[] = [];
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      const msg = `Kết quả replan không đọc được: ${e instanceof Error ? e.message : String(e)}`;
      record({ runId, costUsd: cost, error: msg, rejected: [] });
      return { ran: true, reason: msg, runId, costUsd: cost, proposals: [], rejected: [] };
    }
    const obj = isObj(raw) ? raw : {};
    const byId = new Map(all.map((c) => [c.id, c]));
    const mk = (kind: ReplanKind, targetId: string, extra: Partial<ReplanProposal>): ReplanProposal => ({
      id: `${runId}:${kind}:${targetId}`, kind, targetId, runId, costUsd: cost, sourceId: input.sourceId, status: "chờ duyệt", createdAt, ...extra,
    });
    const list = Array.isArray(obj["commands"]) ? (obj["commands"] as unknown[]).slice(0, QUEUE_MAX_COMMANDS) : [];
    const toAdd: NonNullable<Parameters<typeof deps.queue.addCommands>[1]> = [];
    for (const item of list) {
      if (!isObj(item) || typeof item["id"] !== "string") { rejected.push("Đề xuất thiếu id."); continue; }
      const id = item["id"];
      const target = byId.get(id);
      if (target) {
        if (target.id === source.id || target.status !== "chờ duyệt") { rejected.push(`${id}: lệnh đã duyệt hoặc đã chạy, không sửa.`); continue; }
        const body = item["body"];
        if (typeof body !== "string" || !body.trim() || body.length > 4000) { rejected.push(`${id}: body không hợp lệ.`); continue; }
        const title = item["title"];
        if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 120)) { rejected.push(`${id}: title không hợp lệ.`); continue; }
        const safety = checkBodySafety(body);
        if (safety.errors.length) { rejected.push(`${id}: ${safety.errors.join(" ")}`); continue; }
        const refs = checkReferences(item["references"], `Lệnh "${id}"`);
        if ("error" in refs) { rejected.push(refs.error); continue; }
        proposals.push(mk("sửa", id, { body, ...(typeof title === "string" ? { title } : {}), references: refs.refs }));
        continue;
      }
      const deps0 = Array.isArray(item["dependsOn"]) ? (item["dependsOn"] as unknown[]).filter((d): d is string => typeof d === "string") : [];
      const valid = validateSplitterOutput({ commands: [{ ...item, dependsOn: [] }] });
      if (!valid.ok) { rejected.push(`${id}: ${valid.error}`); continue; }
      const c = valid.commands[0]!;
      toAdd.push({
        id: c.id, title: c.title, body: c.body, files: c.files, references: c.references, size: c.size, verify: c.verify,
        dependsOn: deps0.filter((d) => byId.has(d) && d !== source.id),
        ...(c.parallelGroup !== undefined ? { parallelGroup: c.parallelGroup } : {}),
        source: "manual" as const, sourceRef: runId,
      });
    }
    if (toAdd.length) {
      const stored = deps.queue.addCommands(project, toAdd, { hasRepo: true });
      for (const s of stored) proposals.push(mk("thêm", s.id, { title: s.title, body: s.body }));
    }
    const remove = Array.isArray(obj["remove"]) ? (obj["remove"] as unknown[]) : [];
    for (const r of remove) {
      const t = typeof r === "string" ? byId.get(r) : undefined;
      if (!t) { rejected.push(`Bỏ "${String(r)}": không có lệnh này.`); continue; }
      if (t.id === source.id || t.status !== "chờ duyệt") { rejected.push(`${t.id}: lệnh đã duyệt hoặc đã chạy, không bỏ.`); continue; }
      proposals.push(mk("bỏ", t.id, {}));
    }
    record({ runId, costUsd: cost, rejected }, proposals);
    return { ran: true, runId, costUsd: cost, proposals, rejected };
  } finally {
    running.delete(project);
  }
}
