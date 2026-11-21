import fs from "node:fs";
import path from "node:path";
import { appendFeature } from "../app/feature-registry.js";
import { checkBodySafety, checkReferences, type QueueBlueprint, type QueueCommandKind, type QueueReference } from "./queue-plan.js";

/** Commands the controller appends to an idea batch itself (queue.splitter.autoIntegrate). */
export type QueueAutoKind = "integrate" | "final-review";

export const CRITIC_ISSUE_KINDS = ["gap", "dependency", "too_big", "file_conflict", "no_verify", "contract"] as const;
export type CriticIssueKind = (typeof CRITIC_ISSUE_KINDS)[number];
export interface CriticIssue {
  commandId?: string;
  kind: CriticIssueKind;
  note: string;
}

/** Per-idea data kept next to the commands (key = the commands' sourceRef). */
export interface IdeaMeta {
  blueprint?: QueueBlueprint;
  /** Issues raised by idea-critic on the first split. */
  criticIssues?: CriticIssue[];
  /** True when the batch stored is the single re-split made after the critic's issues. */
  resplit?: boolean;
  /** Why the re-split was not used (parse error, run failure); the first split was kept. */
  resplitError?: string;
  /** Interview questions and the user's answers (skipped = "Bỏ qua, tự quyết"). */
  interview?: { questions: string[]; answers: string[]; skipped: boolean };
  /** Batch-level warnings (blueprint, critic failures). */
  warnings?: string[];
}

/** Queue command states (docs/PLANNER-QUEUE.md section 8). Values are the spec names. */
export const QUEUE_STATUSES = [
  "chờ duyệt",
  "đã duyệt",
  "đang chạy",
  "đã commit",
  "đã gộp",
  "bỏ qua",
  "lỗi",
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** Allowed transitions; only "đã gộp" is terminal ("bỏ qua" can be undone, "lỗi" can be recovered by hand). */
export const QUEUE_TRANSITIONS: Record<QueueStatus, readonly QueueStatus[]> = {
  "chờ duyệt": ["đã duyệt", "bỏ qua"],
  "đã duyệt": ["đang chạy", "chờ duyệt", "bỏ qua"],
  "đang chạy": ["đã commit", "lỗi"],
  "đã commit": ["đã gộp", "lỗi", "bỏ qua"],
  "đã gộp": [],
  "bỏ qua": ["chờ duyệt"],
  "lỗi": ["chờ duyệt", "đã duyệt", "đã commit", "bỏ qua"],
};

export interface QueueCommand {
  id: string;
  project: string;
  batch: number;
  position: number;
  title: string;
  body: string;
  /** Original text from idea-splitter, never changed after creation. */
  bodyOriginal: string;
  dependsOn: string[];
  files: string[];
  references: QueueReference[];
  warnings: string[];
  source: "manual" | "scout";
  sourceRef: string;
  ideaTitle: string;
  size?: 1 | 2;
  verify?: string;
  parallelGroup?: string;
  consumes?: string[];
  produces?: string[];
  acceptance?: string[];
  kind?: QueueCommandKind;
  /** Set on the commands the controller appended itself. */
  auto?: QueueAutoKind;
  status: QueueStatus;
  runId: string | null;
  branch: string | null;
  estCostUsd: number;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
}

export interface NewQueueCommand {
  id: string;
  title: string;
  body: string;
  batch?: number;
  position?: number;
  dependsOn?: string[];
  files?: string[];
  references?: unknown;
  estCostUsd?: number;
  source?: "manual" | "scout";
  sourceRef?: string;
  ideaTitle?: string;
  size?: 1 | 2;
  verify?: string;
  parallelGroup?: string;
  consumes?: string[];
  produces?: string[];
  acceptance?: string[];
  kind?: QueueCommandKind;
  auto?: QueueAutoKind;
}

export interface QueueTransitionExtra {
  runId?: string | null;
  branch?: string | null;
  estCostUsd?: number;
}

export type QueueErrorCode = "invalid_project" | "no_repo" | "not_found" | "bad_transition" | "already_ran" | "invalid";

/** Error with a Vietnamese message; `conflict` maps to HTTP 409 later. */
export class QueueError extends Error {
  readonly code: QueueErrorCode;
  readonly conflict: boolean;
  constructor(code: QueueErrorCode, message: string, conflict = false) {
    super(message);
    this.name = "QueueError";
    this.code = code;
    this.conflict = conflict;
  }
}

interface QueueFile {
  version: 1;
  commands: QueueCommand[];
  /** Absent in files written before idea meta existed. */
  ideas?: Record<string, IdeaMeta>;
}

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class QueueStore {
  private readonly dataDir: string;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.dataDir = dataDir;
    this.now = now;
  }

  private checkProject(project: string, hasRepo: boolean | undefined): void {
    if (project === "default") {
      throw new QueueError("no_repo", "Môi trường mặc định không gắn repo nên không có hàng đợi lệnh.");
    }
    if (!PROJECT_RE.test(project)) {
      throw new QueueError("invalid_project", `Tên môi trường không hợp lệ: ${project}`);
    }
    if (hasRepo === false) {
      throw new QueueError("no_repo", `Môi trường "${project}" chưa gắn repo nên không có hàng đợi lệnh.`);
    }
  }

  private filePath(project: string): string {
    return path.join(this.dataDir, "projects", project, "queue.json");
  }

  private load(project: string): QueueFile {
    const file = this.filePath(project);
    if (!fs.existsSync(file)) return { version: 1, commands: [] };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<QueueFile>;
    const commands = (Array.isArray(parsed.commands) ? parsed.commands : []).map((c) => ({
      ...c,
      references: Array.isArray(c.references) ? c.references : [],
      warnings: Array.isArray(c.warnings) ? c.warnings : [],
      source: c.source === "scout" ? ("scout" as const) : ("manual" as const),
      sourceRef: typeof c.sourceRef === "string" ? c.sourceRef : "",
      ideaTitle: typeof c.ideaTitle === "string" ? c.ideaTitle.slice(0, 80) : "",
    }));
    const ideas = typeof parsed.ideas === "object" && parsed.ideas !== null && !Array.isArray(parsed.ideas) ? parsed.ideas : {};
    return { version: 1, commands, ideas };
  }

  /** Replace the meta of one idea (sourceRef). */
  setIdeaMeta(project: string, sourceRef: string, meta: IdeaMeta): void {
    this.checkProject(project, undefined);
    const data = this.load(project);
    data.ideas = { ...(data.ideas ?? {}), [sourceRef]: meta };
    this.save(project, data);
  }

  getIdeaMeta(project: string, sourceRef: string): IdeaMeta | null {
    if (project === "default" || !PROJECT_RE.test(project)) return null;
    return this.load(project).ideas?.[sourceRef] ?? null;
  }

  listIdeaMeta(project: string): Record<string, IdeaMeta> {
    if (project === "default" || !PROJECT_RE.test(project)) return {};
    return this.load(project).ideas ?? {};
  }

  private save(project: string, data: QueueFile): void {
    const file = this.filePath(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  /** Add commands to the project's queue; ids made unique within the project by a numeric suffix. */
  addCommands(project: string, commands: NewQueueCommand[], opts: { hasRepo?: boolean } = {}): QueueCommand[] {
    this.checkProject(project, opts.hasRepo);
    const data = this.load(project);
    const used = new Set(data.commands.map((c) => c.id));
    const ts = this.now();
    const added: QueueCommand[] = [];
    commands.forEach((c, i) => {
      const baseId = (c.id ?? "").trim();
      if (!baseId) throw new QueueError("invalid", "Lệnh thiếu id.");
      let id = baseId;
      for (let n = 2; used.has(id); n++) id = `${baseId}-${n}`;
      used.add(id);
      const safety = checkBodySafety(c.body);
      if (safety.errors.length) throw new QueueError("invalid", `Lệnh "${baseId}": ${safety.errors.join(" ")}`);
      const refs = checkReferences(c.references, `Lệnh "${baseId}"`);
      if ("error" in refs) throw new QueueError("invalid", refs.error);
      const cmd: QueueCommand = {
        id,
        project,
        batch: c.batch ?? 1,
        position: c.position ?? data.commands.length + i + 1,
        title: c.title,
        body: c.body,
        bodyOriginal: c.body,
        dependsOn: [...(c.dependsOn ?? [])],
        files: [...(c.files ?? [])],
        references: refs.refs,
        warnings: safety.warnings,
        source: c.source === "scout" ? "scout" : "manual",
        sourceRef: c.sourceRef ?? "",
        ideaTitle: (c.ideaTitle ?? "").slice(0, 80),
        ...(c.size !== undefined ? { size: c.size } : {}),
        ...(c.verify !== undefined ? { verify: c.verify } : {}),
        ...(c.parallelGroup !== undefined ? { parallelGroup: c.parallelGroup } : {}),
        ...(c.consumes?.length ? { consumes: [...c.consumes] } : {}),
        ...(c.produces?.length ? { produces: [...c.produces] } : {}),
        ...(c.acceptance?.length ? { acceptance: [...c.acceptance] } : {}),
        ...(c.kind !== undefined ? { kind: c.kind } : {}),
        ...(c.auto !== undefined ? { auto: c.auto } : {}),
        status: "chờ duyệt",
        runId: null,
        branch: null,
        estCostUsd: c.estCostUsd ?? 0,
        createdAt: ts,
        updatedAt: ts,
        approvedAt: null,
      };
      added.push(cmd);
    });
    data.commands.push(...added);
    this.save(project, data);
    return added.map((c) => ({ ...c }));
  }

  list(project: string): QueueCommand[] {
    if (project === "default" || !PROJECT_RE.test(project)) return [];
    return this.load(project).commands.sort((a, b) => a.batch - b.batch || a.position - b.position);
  }

  /** Delete every command of one idea (sourceRef). Refuses while any of them is running. Returns the deleted ids. */
  deleteIdea(project: string, sourceRef: string): string[] {
    this.checkProject(project, undefined);
    const data = this.load(project);
    const mine = data.commands.filter((c) => c.sourceRef === sourceRef);
    if (mine.length === 0) throw new QueueError("not_found", `Không tìm thấy ý tưởng "${sourceRef}" trong hàng đợi của "${project}".`);
    if (mine.some((c) => c.status === "đang chạy")) {
      throw new QueueError("already_ran", "Ý tưởng có lệnh đang chạy; hãy dừng hoặc chờ xong rồi mới xóa.", true);
    }
    data.commands = data.commands.filter((c) => c.sourceRef !== sourceRef);
    if (data.ideas) delete data.ideas[sourceRef];
    this.save(project, data);
    return mine.map((c) => c.id);
  }

  get(project: string, id: string): QueueCommand | null {
    return this.list(project).find((c) => c.id === id) ?? null;
  }

  private mutate(project: string, id: string, fn: (c: QueueCommand) => void): QueueCommand {
    this.checkProject(project, undefined);
    const data = this.load(project);
    const cmd = data.commands.find((c) => c.id === id);
    if (!cmd) throw new QueueError("not_found", `Không tìm thấy lệnh "${id}" trong hàng đợi của "${project}".`);
    fn(cmd);
    cmd.updatedAt = this.now();
    this.save(project, data);
    return { ...cmd };
  }

  /**
   * Edit title/body/files/dependsOn. Only "chờ duyệt" or "đã duyệt" commands; an approved command
   * goes back to "chờ duyệt". bodyOriginal is never touched.
   */
  editCommand(
    project: string,
    id: string,
    patch: { title?: string; body?: string; files?: string[]; dependsOn?: string[] },
  ): QueueCommand {
    return this.mutate(project, id, (c) => {
      if (c.status !== "chờ duyệt" && c.status !== "đã duyệt") {
        throw new QueueError("already_ran", "Lệnh đã chạy, hãy chạy lại để sửa.", true);
      }
      if (patch.title !== undefined) c.title = patch.title;
      if (patch.body !== undefined) {
        const safety = checkBodySafety(patch.body);
        if (safety.errors.length) throw new QueueError("invalid", `Lệnh "${id}": ${safety.errors.join(" ")}`);
        c.body = patch.body;
        c.warnings = safety.warnings;
      }
      if (patch.files !== undefined) c.files = [...patch.files];
      if (patch.dependsOn !== undefined) c.dependsOn = [...patch.dependsOn];
      if (c.status === "đã duyệt") {
        c.status = "chờ duyệt";
        c.approvedAt = null;
      }
    });
  }

  /** Move to `to` only along QUEUE_TRANSITIONS. */
  transition(project: string, id: string, to: QueueStatus, extra: QueueTransitionExtra = {}): QueueCommand {
    return this.mutate(project, id, (c) => {
      if (!QUEUE_TRANSITIONS[c.status]?.includes(to)) {
        throw new QueueError("bad_transition", `Không thể chuyển lệnh "${id}" từ "${c.status}" sang "${to}".`, true);
      }
      const from = c.status;
      c.status = to;
      if (to === "đã commit" || to === "đã gộp") {
        appendFeature(this.dataDir, project, { title: c.ideaTitle ? `${c.ideaTitle}: ${c.title}` : c.title, ref: c.id });
      }
      if (to === "đã duyệt") {
        c.approvedAt = this.now();
        if (from === "lỗi") {
          c.runId = null;
          c.branch = null;
        }
      }
      if (to === "chờ duyệt") {
        c.approvedAt = null;
        // Re-run after failure creates a new run.
        c.runId = null;
        c.branch = null;
      }
      if (extra.runId !== undefined) c.runId = extra.runId;
      if (extra.branch !== undefined) c.branch = extra.branch;
      if (extra.estCostUsd !== undefined) c.estCostUsd = extra.estCostUsd;
    });
  }
}
