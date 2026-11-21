// Training loop (compose -> trial -> grade) over an injected runStep, persisting to the skill store.
// The pure state machine lives in trainer.ts; every step is one separate run (runStep).
import crypto from "node:crypto";
import type { SkillStore, AttachmentInfo } from "./store.js";
import { SkillError } from "./package.js";
import { computeScore, type Rubric, type RubricCheck } from "./rubric.js";
import {
  applyHumanGrade, approve as approveSnap, initialSnapshot, isRunning, requestPause, resolveConfig,
  resume as resumeSnap, stop as stopSnap, TrainerError, type TrainerSnapshot, type TrainerState
} from "./trainer.js";
import { isTextAttachment, type AttachedFileInfo, type AttachSide } from "./attachments.js";
import {
  buildComposePrompt, buildGradePrompt, salvageComposedFiles, buildTrialPrompt, parseComposeResult, parseGradeResult, parseTrialResult,
  type Parsed, type RoundRecord
} from "./round-steps.js";

export type StepRole = "soan-skill" | "chay-thu";
export interface StepResult {
  runId: string;
  costUsd: number;
  text: string;
  ok: boolean;
  error?: string;
}
export type RunStep = (role: StepRole, prompt: string) => Promise<StepResult>;

export interface SkillTrainerDeps {
  store: SkillStore;
  runStep: RunStep;
  now: () => string;
  log?: (msg: string) => void;
  /** Cancels the run in flight (used by stop). */
  cancelActive?: () => void | Promise<void>;
  /** Optional: saves per-sample markdown as report.md of the chay-thu run (overwrites). */
  saveRunReport?: (runId: string, markdown: string) => Promise<void> | void;
}

interface Sample {
  input: unknown;
  expected?: string;
  inputFiles?: AttachedFileInfo[];
  expectedFiles?: AttachedFileInfo[];
}
interface Cur {
  rec: RoundRecord;
  phase: "compose" | "trial" | "grade";
  rubric?: Rubric;
  skillMd?: string;
  rulesMd?: string | undefined;
  samples: Sample[];
  idx: number;
  outputs: string[];
  /** runId of the last successfully parsed step (set by step()). */
  lastRunId?: string;
  /** runId of the successful chay-thu attempt per sample index. */
  runIds: (string | undefined)[];
  graded: Record<string, { ratio: number; reason: string }>[];
}
interface Job {
  slug: string;
  snap: TrainerSnapshot;
  records: RoundRecord[];
  cur: Cur | null;
  stopRequested: boolean;
  parked: boolean;
  lastError?: string;
  restoredFrom?: { round: number; version: number; newVersion: number };
}

const AGENT_LIMIT_ERR = "Vòng huấn luyện bị dừng vì lỗi không mong đợi";

function sha(files: Record<string, string>): string {
  const h = crypto.createHash("sha256");
  for (const k of Object.keys(files).filter((f) => f !== "rounds.json" && f !== "meta.json").sort()) h.update(k + "\0" + files[k] + "\0");
  return h.digest("hex").slice(0, 12);
}

function evalCheck(check: RubricCheck | undefined, output: string): number {
  if (!check) return 0;
  try {
    switch (check.type) {
      case "contains": return output.includes(check.value) ? 1 : 0;
      case "not-contains": return output.includes(check.value) ? 0 : 1;
      case "regex": return new RegExp(check.pattern, check.flags).test(output) ? 1 : 0;
      case "max-length": return output.length <= check.max ? 1 : 0;
      case "min-length": return output.length >= check.min ? 1 : 0;
      case "section-present": {
        const esc = check.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`^#{1,6}\\s*${esc}\\s*$`, "mi").test(output) ? 1 : 0;
      }
      case "json-schema": {
        const j = JSON.parse(output) as unknown;
        if (!j || typeof j !== "object") return 0;
        const req = (check.schema as Record<string, unknown>)["required"];
        if (!Array.isArray(req) || req.length === 0) return 1;
        return req.filter((k): k is string => typeof k === "string" && k in (j as Record<string, unknown>)).length / req.length;
      }
    }
  } catch {
    return 0;
  }
  return 0;
}

function stripHoldout(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripHoldout);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!/holdout/i.test(k)) out[k] = stripHoldout(x);
    return out;
  }
  if (typeof v === "string" && /examples\/holdout-/i.test(v)) return "[ẩn]";
  return v;
}

function trialMarkdown(round: number, idx: number, s: Sample, output: string): string {
  const parts = [`# Vòng ${round} - mẫu ${idx + 1}`, "", "## Đầu vào", "", "```json", JSON.stringify(stripHoldout(s.input) ?? null, null, 2), "```"];
  if (s.inputFiles?.length) parts.push("", "Tệp đính kèm: " + s.inputFiles.map((f) => f.name).join(", "));
  if (s.expected) parts.push("", "## Kết quả mong đợi", "", s.expected);
  parts.push("", "## Đầu ra chạy thử", "", output, "");
  return parts.join("\n");
}

export function createSkillTrainer(deps: SkillTrainerDeps) {
  const { store, runStep, now } = deps;

  async function loadSide(slug: string, all: AttachmentInfo[], pair: string, side: AttachSide): Promise<AttachedFileInfo[]> {
    const out: AttachedFileInfo[] = [];
    for (const a of all.filter((x) => x.pair === pair && x.side === side).sort((x, y) => x.name.localeCompare(y.name))) {
      const info: AttachedFileInfo = { name: a.name, size: a.size };
      if (isTextAttachment(a.name)) {
        try {
          const buf = await store.readAttachment(slug, pair, side, a.name);
          info.text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          /* unreadable or not UTF-8: listed as binary */
        }
      }
      out.push(info);
    }
    return out;
  }
  const locks = new Map<string, Promise<void>>();
  const jobs = new Map<string, Job>();

  async function persist(job: Job): Promise<void> {
    const { snap, slug } = job;
    const live = job.cur ? job.cur.rec.costUsdEstimate : 0;
    await store.writeRounds(slug, { version: 1, rounds: job.records, ...(job.restoredFrom ? { restoredFrom: job.restoredFrom } : {}) });
    await store.updateMeta(slug, {
      state: snap.state,
      bestScore: snap.bestScore ?? 0,
      bestRound: snap.bestRound ?? 0,
      costUsdEstimate: snap.totalCostUsd + live,
      paused: snap.paused,
      lastError: job.lastError ?? null,
      config: snap.config
    });
  }

  async function loadSnapshot(slug: string): Promise<{ snap: TrainerSnapshot; records: RoundRecord[] }> {
    const { meta } = await store.get(slug);
    const data = await store.readRounds(slug);
    const records = data.rounds as RoundRecord[];
    const scored = records.filter((r) => typeof r.score === "number");
    const legacy = (meta.state as string) === "grading";
    if (legacy) {
      await store.updateMeta(slug, { state: "stopped", lastError: "Vòng cũ do AI chấm đã bị bỏ; bấm huấn luyện lại để chạy vòng mới do bạn chấm." });
    }
    const snap: TrainerSnapshot = {
      state: legacy ? "stopped" : (meta.state as TrainerState),
      round: scored.length + 1,
      rounds: scored.map((r) => ({ n: r.n, score: r.score as number, costUsd: r.costUsdEstimate })),
      totalCostUsd: meta.costUsdEstimate,
      bestScore: scored.length ? meta.bestScore : null,
      bestRound: scored.length ? meta.bestRound : null,
      config: resolveConfig(meta.config),
      paused: meta.paused === true,
      ...(meta.approvedAt ? { approvedAt: meta.approvedAt } : {})
    };
    return { snap, records };
  }

  // ---- step plumbing -------------------------------------------------------------------------

  /** True when the next step may run. Otherwise the job is parked (pause) or finished (stop / cost cap). */
  function gate(job: Job): boolean {
    if (job.stopRequested) {
      job.snap = { ...job.snap, state: "stopped", paused: false };
      return false;
    }
    if (job.snap.paused) {
      job.parked = true;
      return false;
    }
    const partial = job.cur?.rec.costUsdEstimate ?? 0;
    if (job.snap.totalCostUsd + partial >= job.snap.config.costCapUsd) {
      job.snap = { ...job.snap, state: "cost_cap", totalCostUsd: job.snap.totalCostUsd + partial };
      if (job.cur) {
        job.cur.rec.endedAt = deps.now();
        job.cur = null;
      }
      return false;
    }
    return true;
  }

  function fail(job: Job, message: string): null {
    job.lastError = message;
    job.snap = { ...job.snap, state: "stopped", paused: false };
    if (job.cur) {
      const partial = job.cur.rec.costUsdEstimate;
      job.snap = { ...job.snap, totalCostUsd: job.snap.totalCostUsd + partial };
      job.cur.rec.errors.push(message);
      job.cur.rec.endedAt = deps.now();
      job.cur = null;
    }
    return null;
  }

  /** Run one step (with one retry on a bad reply). Returns null when the loop must halt. */
  async function step<T>(job: Job, role: StepRole, prompt: string, parse: (text: string) => Parsed<T>): Promise<T | null> {
    const cur = job.cur as Cur;
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!gate(job)) return null;
      const p = attempt === 0 ? prompt : `${prompt}\n\nLần trước phản hồi không hợp lệ: ${lastErr} Trả lại đúng định dạng yêu cầu.`;
      const r = await runStep(role, p);
      cur.rec.steps.push({ role, runId: r.runId, costUsdEstimate: r.costUsd, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
      cur.rec.costUsdEstimate += r.costUsd;
      if (!job.records.includes(cur.rec)) job.records.push(cur.rec);
      await persist(job);
      if (job.stopRequested) {
        gate(job);
        return null;
      }
      if (!r.ok) return fail(job, `Bước ${role} thất bại: ${r.error ?? "run không hoàn tất"}. Chi phí chỉ là ước tính.`);
      const parsed = parse(r.text);
      if (parsed.ok) {
        cur.lastRunId = r.runId;
        return parsed.value;
      }
      lastErr = parsed.error;
    }
    return fail(job, `Phản hồi của vai ${role} không hợp lệ sau 2 lần thử: ${lastErr}`);
  }

  // ---- loop ------------------------------------------------------------------------------------

  function buildCritique(rubric: Rubric, perCriterion: { id: string; points: number }[], reasons: Record<string, string[]>): string {
    return rubric.criteria
      .map((c) => {
        const pc = perCriterion.find((p) => p.id === c.id);
        const why = (reasons[c.id] ?? []).slice(0, 2).join(" | ");
        return `- ${c.id}: ${Math.round((pc?.points ?? 0) * 10) / 10}/${c.weight}${why ? `. Lý do chấm: ${why}` : ""}`;
      })
      .join("\n");
  }

  function newCur(job: Job): Cur {
    const n = job.snap.round;
    job.records = job.records.filter((r) => !(r.n === n && r.score === undefined));
    const rec: RoundRecord = { n, startedAt: deps.now(), skillVersion: 0, skillSha: "", steps: [], criteria: [], errors: [], costUsdEstimate: 0 };
    return { rec, phase: "compose", samples: [], idx: 0, outputs: [], runIds: [], graded: [] };
  }

  async function loop(job: Job): Promise<void> {
    for (;;) {
      if (!job.cur) job.cur = newCur(job);
      const c = job.cur;
      if (c.phase === "compose") {
        job.snap = { ...job.snap, state: "composing" };
        const rec0 = await store.get(job.slug);
        let rubricCriteria: { id: string; label: string; weight: number }[] = [];
        try {
          const parsed = JSON.parse(rec0.files["eval/rubric.json"] ?? "{}") as { criteria?: Array<{ id: string; label: string; weight: number }> };
          rubricCriteria = (parsed.criteria ?? []).map((x) => ({ id: x.id, label: x.label, weight: x.weight }));
        } catch {
          rubricCriteria = [];
        }
        const prev = [...job.records].reverse().find((r) => typeof r.score === "number" && r.skillSha === sha(rec0.files)) ?? [...job.records].reverse().find((r) => typeof r.score === "number");
        const files = await step(job, "soan-skill",
          buildComposePrompt({ goal: rec0.meta.goal, files: rec0.files, critique: prev?.critique, criteria: rubricCriteria }),
          parseComposeResult);
        if (!files) return;
        const salvaged = salvageComposedFiles(files, rec0.meta.goal);
        c.rec.errors.push(...salvaged.notes);
        for (const n of salvaged.notes) deps.log?.(n);
        let updated;
        try {
          updated = await store.update(job.slug, { files: { ...rec0.files, ...salvaged.files } });
        } catch (e) {
          if (!(e instanceof SkillError)) throw e;
          // The step was already paid for: keep it recorded and say how to recover instead of a vague crash.
          fail(job, `Gói skill do agent soạn bị từ chối: ${e.message} Bản skill hiện tại được giữ nguyên; bấm huấn luyện lại để soạn lại.`);
          await persist(job);
          return;
        }
        c.rec.skillVersion = updated.meta.version;
        c.rec.skillSha = sha(updated.files);
        await persist(job); // store.update rewrote rounds.json from the pre-step copy
        c.phase = "trial";
        c.idx = 0;
      }
      if (c.phase === "trial") {
        job.snap = { ...job.snap, state: "trial" };
        if (!c.rubric) {
          const cur = await store.get(job.slug);
          let rubric: Rubric;
          try {
            rubric = JSON.parse(cur.files["eval/rubric.json"] ?? "");
            if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) throw new Error("rỗng");
          } catch {
            fail(job, "Skill chưa có rubric hợp lệ (eval/rubric.json) để chấm điểm.");
            return;
          }
          c.rubric = rubric;
          c.skillMd = cur.files["SKILL.md"] ?? "";
          c.rulesMd = cur.files["rules.md"];
          const trains = Object.keys(cur.files).filter((k) => /^examples\/train-[1-9][0-9]*\.json$/.test(k)).sort();
          c.samples = [];
          // Only train-<n> attachments are read here; holdout-<n> files are never loaded.
          let allAtt: AttachmentInfo[] = [];
          try {
            allAtt = await store.listAttachments(job.slug);
          } catch {
            /* no attachments */
          }
          for (const k of trains) {
            try {
              const j = JSON.parse(cur.files[k] as string);
              const pair = (k.match(/^examples\/(train-[1-9][0-9]*)\.json$/) as RegExpMatchArray)[1] as string;
              const inputFiles = await loadSide(job.slug, allAtt, pair, "input");
              const expectedFiles = await loadSide(job.slug, allAtt, pair, "expected");
              c.samples.push({
                input: j.input ?? j,
                ...(typeof j.expected === "string" ? { expected: j.expected } : {}),
                ...(inputFiles.length ? { inputFiles } : {}),
                ...(expectedFiles.length ? { expectedFiles } : {})
              });
            } catch {
              /* skip unreadable sample */
            }
          }
          if (c.samples.length === 0) {
            let input: unknown = {};
            try {
              input = JSON.parse(cur.files["inputs.json"] ?? "{}");
            } catch {
              /* keep {} */
            }
            c.samples = [{ input }];
          }
        }
        while (c.idx < c.samples.length) {
          let prompt: string;
          try {
            prompt = buildTrialPrompt({ skillMd: c.skillMd as string, rulesMd: c.rulesMd, input: (c.samples[c.idx] as Sample).input, inputFiles: (c.samples[c.idx] as Sample).inputFiles });
          } catch (e) {
            fail(job, e instanceof SkillError ? e.message : String(e));
            return;
          }
          delete c.lastRunId;
          const out = await step(job, "chay-thu", prompt, parseTrialResult);
          if (!out) return;
          c.outputs[c.idx] = out.output;
          c.runIds[c.idx] = c.lastRunId;
          c.idx++;
        }
        // Write each trial output to a file for the human grader; no AI grading step.
        const names: string[] = [];
        await store.clearTrialOutputs(job.slug, c.rec.n);
        for (let i = 0; i < c.samples.length; i++) {
          const sample = c.samples[i] as Sample;
          const output = c.outputs[i] ?? "";
          const name = await store.writeTrialOutput(job.slug, c.rec.n, i, trialMarkdown(c.rec.n, i, sample, output));
          names.push(name);
          const runId = c.runIds[i];
          if (deps.saveRunReport && runId) {
            try {
              const md = trialMarkdown(c.rec.n, i, sample, output) + `\nTệp đã lưu: trials/round-${c.rec.n}/${name}\n`;
              await deps.saveRunReport(runId, md);
            } catch (e) {
              deps.log?.(`Không ghi được report.md cho lượt ${runId}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        c.rec.outputFiles = names;
        job.snap = { ...job.snap, state: "awaiting_score", round: c.rec.n };
        job.cur = null;
        if (!job.records.includes(c.rec)) job.records.push(c.rec);
        job.snap = { ...job.snap, totalCostUsd: job.snap.totalCostUsd + c.rec.costUsdEstimate };
        await persist(job);
        return;
      }
    }
  }

  async function restoreBest(job: Job): Promise<void> {
    const best = job.records.find((r) => r.n === job.snap.bestRound && typeof r.score === "number");
    if (!best) return;
    const cur = await store.get(job.slug);
    if (sha(cur.files) === best.skillSha) return;
    try {
      const restored = await store.restoreVersion(job.slug, best.skillVersion);
      job.restoredFrom = { round: best.n, version: best.skillVersion, newVersion: restored.meta.version };
    } catch (e) {
      deps.log?.(`Không khôi phục được bản tốt nhất: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function run(job: Job): Promise<void> {
    job.parked = false;
    try {
      await loop(job);
    } catch (e) {
      deps.log?.(`${AGENT_LIMIT_ERR}: ${e instanceof Error ? e.message : String(e)}`);
      fail(job, `${AGENT_LIMIT_ERR}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      if (job.parked) {
        await persist(job);
        return;
      }
      if (!isRunning(job.snap.state)) {
        job.snap = { ...job.snap, paused: false };
        if (["stalled", "failed_max_rounds", "cost_cap"].includes(job.snap.state)) await restoreBest(job);
        jobs.delete(job.slug);
      }
      await persist(job);
    } catch (e) {
      deps.log?.(`Không ghi được trạng thái huấn luyện: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function launch(job: Job): void {
    jobs.set(job.slug, job);
    const p = run(job).finally(() => {
      if (locks.get(job.slug) === p) locks.delete(job.slug);
    });
    locks.set(job.slug, p);
  }

  function alreadyRunning(): SkillError {
    return new SkillError("Skill này đang được huấn luyện.", 409, "already_running");
  }

  // ---- public API --------------------------------------------------------------------------------

  return {
    async train(slug: string, overrides?: Record<string, unknown> | null) {
      if (locks.has(slug) || jobs.has(slug)) throw alreadyRunning();
      const { meta } = await store.get(slug);
      const snap = initialSnapshot({ ...(meta.config ?? {}), ...(overrides ?? {}) });
      const job: Job = { slug, snap, records: [], cur: null, stopRequested: false, parked: false };
      await store.updateMeta(slug, { approvedAt: null, lastError: null, paused: false, state: "composing", config: snap.config });
      await store.writeRounds(slug, { version: 1, rounds: [] });
      launch(job);
      return { state: snap.state as TrainerState };
    },

    async pause(slug: string) {
      const job = jobs.get(slug);
      if (job) {
        job.snap = requestPause(job.snap);
        return { state: job.snap.state, paused: job.snap.paused };
      }
      const { snap } = await loadSnapshot(slug);
      return { state: snap.state, paused: snap.paused };
    },

    async resume(slug: string, overrides?: Record<string, unknown> | null) {
      const job = jobs.get(slug);
      if (job) {
        job.snap = resumeSnap(job.snap);
        if (job.parked && !locks.has(slug)) {
          await store.updateMeta(slug, { paused: false });
          launch(job);
        }
        return { state: job.snap.state, paused: job.snap.paused };
      }
      if (locks.has(slug)) throw alreadyRunning();
      const { snap, records } = await loadSnapshot(slug);
      const base = isRunning(snap.state) ? { ...snap, state: "stopped" as TrainerState } : snap;
      const next = resumeSnap(base, overrides);
      if (next.state !== "composing") return { state: snap.state, paused: snap.paused };
      const nj: Job = { slug, snap: next, records, cur: null, stopRequested: false, parked: false };
      await store.updateMeta(slug, { state: "composing", paused: false, lastError: null, config: next.config });
      launch(nj);
      return { state: next.state, paused: false };
    },

    async stop(slug: string) {
      const job = jobs.get(slug);
      if (job) {
        job.stopRequested = true;
        job.snap = stopSnap(job.snap);
        if (locks.has(slug)) {
          try {
            await deps.cancelActive?.();
          } catch {
            /* best effort */
          }
        } else {
          job.snap = { ...job.snap, state: "stopped", paused: false };
          jobs.delete(slug);
          await persist(job);
        }
        return { state: "stopped" as TrainerState };
      }
      const { snap, records } = await loadSnapshot(slug);
      const next = stopSnap(snap);
      if (next !== snap) {
        const j: Job = { slug, snap: next, records, cur: null, stopRequested: true, parked: false };
        await persist(j);
      }
      return { state: next.state };
    },

    async approve(slug: string) {
      const { snap } = await loadSnapshot(slug);
      if (snap.approvedAt && snap.state === "awaiting_approval") return { state: snap.state, approvedAt: snap.approvedAt };
      try {
        const next = approveSnap(snap, now());
        await store.updateMeta(slug, { approvedAt: next.approvedAt });
        return { state: next.state, approvedAt: next.approvedAt as string };
      } catch (e) {
        if (e instanceof TrainerError) throw new SkillError(e.message, 409, e.code);
        throw e;
      }
    },

    async grade(slug: string, input: { score: unknown; feedback?: unknown }) {
      const prior = locks.get(slug);
      if (prior) await prior;
      const { snap, records } = await loadSnapshot(slug);
      const job: Job = { slug, snap, records, cur: null, stopRequested: false, parked: false };
      let next: TrainerSnapshot;
      try {
        next = applyHumanGrade(snap, { score: input.score as number, feedback: typeof input.feedback === "string" ? input.feedback : "" }, 0);
      } catch (e) {
        if (e instanceof TrainerError) throw new SkillError(e.message, e.code === "not_awaiting_score" ? 409 : 400, e.code);
        throw e;
      }
      const rec = [...records].reverse().find((r) => r.score === undefined && r.n === snap.round);
      const feedback = (typeof input.feedback === "string" ? input.feedback : "").trim().slice(0, 2000);
      if (rec) {
        rec.score = input.score as number;
        rec.feedback = feedback;
        rec.critique = feedback;
        rec.gradedBy = "human";
        rec.endedAt = now();
      }
      job.snap = next;
      await persist(job);
      if (next.state === "composing") launch(job);
      return { state: next.state as TrainerState, score: input.score as number };
    },

    async getRounds(slug: string) {
      const { meta } = await store.get(slug);
      const data = await store.readRounds(slug);
      const clean = stripHoldout(data) as { version: number; rounds: unknown[] };
      return { ...clean, bestScore: meta.bestScore, bestRound: meta.bestRound, state: meta.state };
    },

    whenIdle(slug: string): Promise<void> {
      return locks.get(slug) ?? Promise.resolve();
    }
  };
}

export type SkillTrainer = ReturnType<typeof createSkillTrainer>;
