// src/core/workshop3d/runner.ts — non-stop session runner: one background loop per session, checkpoint after every step.
// Every role call goes through `step()`; build, assemble, render and the PARAMS patch are injected so tests use fakes.
import fs from "node:fs";
import path from "node:path";
import type { Parsed } from "../skill-workshop/round-steps.js";
import type { BuildOptions, BuildResult } from "./build.js";
import type { W3DColorDeps } from "./palette.js";
import type { PatchResult } from "./patch-params.js";
import { buildPrompt, type W3DPromptCtx } from "./prompts.js";
import {
  parseArt, parseIntake, parseMaterials, parseModel, parsePlan, parsePresent, parseVerdict,
  type RenderPlan, type W3DPlan,
} from "./role-output.js";
import {
  applyStepResult, atStep, crossCheckMaterials, intakeMustAsk, isTransientFailure, isValidSnapshot, isWorking, keepNotes, mergeBrief, promptCtx,
  W3D_IMAGE_RE, withCost, withCostWarning, type CtxInput,
} from "./runner-helpers.js";
import {
  buildingStep, colorDeltaFor, errText, hqMaterialsStep, hqRenderStep, hqReviewStep, modelPartsOutsidePlan, okWith, paletteFor, optimizingStep, presenterRenders, renderingStep, reviewSection, W3D_FILES,
  type CtxOf, type StepKit, type W3DHqDeps,
} from "./runner-steps.js";
import { BLENDER_GLB, hqRenderFiles } from "./blender.js";
import {
  afterIntake, afterReview, afterStepFailed, afterStepOk, answered, initialSnapshot, nonGeometry, pause as pauseState, quotaReady,
  resume as resumeState, reviewModeOf, reviewTotal, shouldUseBest, stop as stopState, W3DError, waitQuota, type W3DLoopLimits,
} from "./state.js";
import { slashes, type W3DRunStep, type W3DStepResult } from "./step-adapter.js";
import type { W3DRecord, W3DStore } from "./store.js";
import { cadSkillsText } from "./cad-skills.js";
import { buildPresentation } from "./presentation.js";
import { safeRel } from "./store.js";
import { W3D_BRIEF_LIMITS, type W3DBrief, type W3DHqMode, type W3DSnapshot, type W3DState, type Workshop3DRole } from "./types.js";

export interface W3DRunnerDeps {
  store: W3DStore;
  runStep: W3DRunStep;
  build: (slug: string, plan: W3DPlan, opts?: BuildOptions) => Promise<BuildResult>;
  /** Re-assemble GLB/USDZ from the existing parts (wraps runAssemble); with maxTriangles/texturePx it also writes model-mobile.glb. */
  assemble: (slug: string, opts: BuildOptions) => Promise<BuildResult>;
  render: (slug: string, plan: RenderPlan) => Promise<{ ok: boolean; files: string[]; error?: string }>;
  /** Rewrite the PARAMS literal of model.py (wraps patchParams with the CAD python). */
  patchParams: (scriptPath: string, params: Record<string, string | number>) => Promise<PatchResult>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Epoch ms when the subscription window resets, or null when unknown. */
  quotaResetAt: () => number | null;
  /** From createW3DRunStep: kill running role runs (stop) and clear the sticky cancel flag (start/resume). */
  cancelActive?: () => void;
  resetCancel?: () => void;
  log?: (msg: string) => void;
  costWarnUsd?: number;
  /** Loop limits of new sessions (fix rounds, rounds without improvement, automatic resumes); defaults in state.ts. */
  limits?: W3DLoopLimits;
  /** Blender high-quality step (absent = never: the old single-phase flow). */
  hq?: W3DHqDeps;
  /** Colours measured by code (reference palette, render colour delta); absent = skipped. */
  color?: W3DColorDeps;
  /** Blender mode of a NEW session ("off" when Blender is missing or disabled); existing sessions keep theirs. */
  hqMode?: () => W3DHqMode;
  /** Recent build failures of earlier sessions, for the cad-modeler prompt ("" = none). */
  lessons?: () => string;
  /** Records one build failure line (lessons file); never throws into the session. */
  lesson?: (text: string) => void;
  /** Mirrors the deliverables into the Settings output folder (delivery.ts); a failure never fails the session. */
  deliver?: (slug: string) => void;
}

/** File content of an attachment: text, or the exact bytes of a binary file (images). */
export type W3DAttachmentContent = string | Buffer;

export interface W3DRunner {
  start(brief: W3DBrief, files?: Record<string, W3DAttachmentContent>): string;
  answer(slug: string, text: string): void;
  pause(slug: string): void;
  resume(slug: string): void;
  stop(slug: string): void;
  rebuild(slug: string, newParams?: Record<string, string | number>): void;
  /** "Dựng tiếp": a finished session runs ONE more round (modeling, build, materials, render, review, Blender) around the user's notes. */
  continueWith(slug: string, text: string): void;
  recover(): string[];
  idle(slug?: string): Promise<void>;
}

export const QUOTA_FALLBACK_MS = 30 * 60_000;
export const SLEEP_CHUNK_MS = 60_000;
export const MIN_QUOTA_WAIT_MS = 60_000;
/** Identical snapshots on consecutive loop iterations before the session is failed instead of spinning. */
export const MAX_NO_PROGRESS = 3;
const MAX_REBUILD_PARAMS = 50;
const MAX_PARAM_KEY = 60;
const MAX_PARAM_TEXT = 200;
const MAX_CANCELLED_RETRIES = 3;
const MAX_ANSWER = 4000;
const F = W3D_FILES;
/** Reference images given to the roles (the HTTP route accepts at most this many). */
export const MAX_REFERENCE_IMAGES = 5;
/** Copy of the best-scored version (restored when the fix loop ends on a worse round). */
export const BEST_DIR = "best";
const BEST_FILES = [F.model, F.materials, F.renderPlan, F.renders, F.review] as const;

type IntakeAnswer = { questions: string[]; answer: string };
type Entry = { done: Promise<void> };

export function createW3DRunner(deps: W3DRunnerDeps): W3DRunner {
  const { store } = deps;
  const warnUsd = deps.costWarnUsd ?? 20;
  const active = new Map<string, Entry>();
  const lastErrors = new Map<string, { state: W3DState; text: string }>();
  const cancelStreak = new Map<string, number>();
  const log = (m: string): void => deps.log?.(m);

  const abs = (slug: string, rel: string): string => path.join(store.dir(slug), rel);
  const has = (slug: string, rel: string): boolean => fs.existsSync(abs(slug, rel));
  const remove = (slug: string, rel: string): void => fs.rmSync(abs(slug, rel), { force: true });
  const readJson = <T>(slug: string, rel: string): T | null => {
    const t = store.readFile(slug, rel);
    if (t === null) return null;
    try {
      return JSON.parse(t) as T;
    } catch {
      return null;
    }
  };
  const writeJson = (slug: string, rel: string, v: unknown): void => store.writeFile(slug, rel, JSON.stringify(v, null, 2));

  function load(slug: string): W3DRecord {
    const rec = store.get(slug);
    if (!rec) throw new W3DError("Không tìm thấy phiên dựng 3D.");
    return rec;
  }
  /** Checkpoint: notes are never lost and the cost warning is added once. */
  function save(slug: string, prev: W3DSnapshot, next: W3DSnapshot): void {
    store.saveSnapshot(slug, withCostWarning({ ...next, note: keepNotes(prev.note, next.note) }, warnUsd));
  }
  /** Apply a step result against the snapshot re-read from the store (see applyStepResult); files are written only when applied. */
  function commit(slug: string, state: W3DState, cost: number, fn: (s: W3DSnapshot) => W3DSnapshot, write?: () => void): boolean {
    const cur = store.get(slug)?.snapshot;
    if (!cur) return false;
    const r = applyStepResult(cur, state, cost, fn);
    if (r.applied) write?.();
    if (r.next !== cur) save(slug, cur, r.next);
    return r.applied;
  }
  /** A failed step; `transient` (interruption, temporary infrastructure error) may resume by itself after a delay. */
  function fail(slug: string, state: W3DState, cost: number, message: string, transient = false): void {
    commit(slug, state, cost, (s) => afterStepFailed(withCost(s, cost), message, { transient, now: deps.now() }));
  }

  /** The single place where a role is called. */
  async function step(slug: string, role: Workshop3DRole, ctx: W3DPromptCtx): Promise<W3DStepResult> {
    try {
      return await deps.runStep(role, buildPrompt(role, ctx), store.dir(slug));
    } catch (e) {
      return { runId: "", costUsd: 0, text: "", ok: false, interrupted: false, rateLimited: false, cancelled: false, error: errText(e) };
    }
  }

  /** Run one role and parse it. Returns null when the outcome (failure, quota, cancel, stop) was already handled. */
  async function runRole<T>(slug: string, s: W3DSnapshot, role: Workshop3DRole, ctx: Omit<W3DPromptCtx, "round">, parse: (text: string) => Parsed<T>): Promise<{ value: T; cost: number } | null> {
    const state = s.state;
    const le = lastErrors.get(slug);
    const r = await step(slug, role, { ...ctx, round: s.round, ...(le && le.state === state ? { lastError: le.text } : {}) });
    const cost = r.costUsd;
    if (r.text) {
      try {
        store.appendRound(slug, s.round, role, r.text);
      } catch (e) {
        log(`workshop3d ${slug}: không ghi được rounds/${s.round}/${role}.txt: ${errText(e)}`);
      }
    }
    if (r.cancelled) {
      const n = (cancelStreak.get(slug) ?? 0) + 1;
      cancelStreak.set(slug, n);
      if (!atStep(store.get(slug)?.snapshot, state)) {
        commit(slug, state, cost, (x) => x); // stopped: drop, count the cost
        return null;
      }
      // Another session's stop cancelled this run: clear the sticky flag and run the step again.
      deps.resetCancel?.();
      if (n < MAX_CANCELLED_RETRIES) {
        commit(slug, state, cost, (x) => withCost(x, cost));
        return null;
      }
    }
    cancelStreak.delete(slug);
    if (r.rateLimited) {
      // A reset time in the past (stale clock, wrong parse) must not turn into an immediate retry: always wait a real minute.
      const until = Math.max(deps.quotaResetAt() ?? deps.now() + QUOTA_FALLBACK_MS, deps.now() + MIN_QUOTA_WAIT_MS);
      commit(slug, state, cost, (x) => waitQuota(withCost(x, cost), until));
      return null;
    }
    if (!r.ok) {
      fail(slug, state, cost, `Vai ${role} ${r.interrupted ? "bị ngắt" : "lỗi"}: ${(r.error ?? "không rõ lý do").slice(0, 500)}`, isTransientFailure(r));
      return null;
    }
    const p = parse(r.text);
    if (!p.ok) {
      lastErrors.set(slug, { state, text: p.error });
      fail(slug, state, cost, `Vai ${role} trả kết quả không hợp lệ: ${p.error}`);
      return null;
    }
    lastErrors.delete(slug);
    return { value: p.value, cost };
  }

  const kit: StepKit = { deps, store, abs, has, remove, readJson, writeJson, commit, fail, runRole };
  // Forward slashes: the role's Read allow rule is `Read(<dir with />/**)` (step-adapter).
  const renderPaths = (slug: string): string[] => (readJson<string[]>(slug, F.renders) ?? []).map((r) => slashes(abs(slug, r)));
  /** Reference images the user attached (inbox/, image types only, files that really exist). */
  const referencePaths = (slug: string, brief: W3DBrief): string[] =>
    brief.attachments.filter((n) => W3D_IMAGE_RE.test(n) && has(slug, `inbox/${n}`)).slice(0, MAX_REFERENCE_IMAGES).map((n) => slashes(abs(slug, `inbox/${n}`)));

  /** Copy the files of the current version (script, materials, build outputs, renders, review) to best/. */
  function saveBest(slug: string): void {
    try {
      fs.rmSync(abs(slug, BEST_DIR), { recursive: true, force: true });
      fs.mkdirSync(abs(slug, BEST_DIR), { recursive: true });
      for (const rel of BEST_FILES) if (has(slug, rel)) fs.copyFileSync(abs(slug, rel), abs(slug, `${BEST_DIR}/${rel}`));
      if (has(slug, "outputs")) fs.cpSync(abs(slug, "outputs"), abs(slug, `${BEST_DIR}/outputs`), { recursive: true });
      for (const r of readJson<string[]>(slug, F.renders) ?? []) {
        const rel = safeRel(r);
        if (!has(slug, rel)) continue;
        fs.mkdirSync(path.dirname(abs(slug, `${BEST_DIR}/${rel}`)), { recursive: true });
        fs.copyFileSync(abs(slug, rel), abs(slug, `${BEST_DIR}/${rel}`));
      }
    } catch (e) {
      log(`workshop3d ${slug}: không lưu được bản tốt nhất: ${errText(e)}`);
    }
  }
  /** Put the saved best version back (the loop ended on a worse round). Returns false when there is nothing to restore. */
  function restoreBest(slug: string): boolean {
    if (!has(slug, `${BEST_DIR}/${F.model}`)) return false;
    try {
      for (const rel of BEST_FILES) if (has(slug, `${BEST_DIR}/${rel}`)) fs.copyFileSync(abs(slug, `${BEST_DIR}/${rel}`), abs(slug, rel));
      if (has(slug, `${BEST_DIR}/outputs`)) {
        fs.rmSync(abs(slug, "outputs"), { recursive: true, force: true });
        fs.cpSync(abs(slug, `${BEST_DIR}/outputs`), abs(slug, "outputs"), { recursive: true });
      }
      if (has(slug, `${BEST_DIR}/renders`)) fs.cpSync(abs(slug, `${BEST_DIR}/renders`), abs(slug, "renders"), { recursive: true });
      return true;
    } catch (e) {
      log(`workshop3d ${slug}: không khôi phục được bản tốt nhất: ${errText(e)}`);
      return false;
    }
  }

  async function advance(slug: string, rec: W3DRecord): Promise<void> {
    const s = rec.snapshot;
    const brief = rec.brief;
    const plan = readJson<W3DPlan>(slug, F.spec) ?? undefined;
    const references = referencePaths(slug, brief);
    const base: CtxInput = {
      brief, plan, art: readJson<NonNullable<CtxInput["art"]>>(slug, F.art) ?? undefined, buildStats: store.readFile(slug, F.buildStats),
      ...(references.length > 0 ? { references } : {}),
    };
    const ctx: CtxOf = (extra) => promptCtx({ ...base, ...extra });
    const modelingSkills = (): string => cadSkillsText(`${JSON.stringify(brief)} ${(plan?.parts ?? []).map((p) => `${p.name} ${p.material}`).join(" ")}`);
    const needPlan = (): boolean => {
      if (plan) return true;
      fail(slug, s.state, 0, "Thiếu hoặc hỏng spec.json (bảng chi tiết).");
      return false;
    };
    switch (s.state) {
      case "intake": {
        const answers = readJson<IntakeAnswer[]>(slug, F.answers) ?? [];
        const truncated = brief.object.length > W3D_BRIEF_LIMITS.object;
        // A first-round brief with "chưa rõ" values (or a cut request) goes back to the role as an error: it must ask.
        const parse = (text: string) => {
          const p = parseIntake(text);
          if (!p.ok) return p;
          const must = intakeMustAsk(p.value, { answered: answers.length, truncated });
          return must ? { ok: false as const, error: must } : p;
        };
        const out = await runRole(slug, s, "tiep-nhan-3d", ctx({ answers }), parse);
        if (!out) return;
        const v = out.value;
        commit(slug, s.state, out.cost, (x) => afterIntake(x, v, out.cost), () => {
          if (v.done && v.brief) store.saveBrief(slug, mergeBrief(store.get(slug)?.brief ?? brief, v.brief));
        });
        return;
      }
      case "art": {
        const out = await runRole(slug, s, "art-director", ctx({}), parseArt);
        if (out) commit(slug, s.state, out.cost, okWith(afterStepOk, out.cost), () => writeJson(slug, F.art, out.value));
        return;
      }
      case "planning": {
        const out = await runRole(slug, s, "detail-planner", ctx({}), parsePlan);
        if (out) commit(slug, s.state, out.cost, okWith(afterStepOk, out.cost), () => writeJson(slug, F.spec, out.value));
        return;
      }
      case "modeling": {
        if (!needPlan()) return;
        // The last round scored below the best one: the next patch starts from the best version, not from the worse one.
        if (s.round > 1 && typeof s.bestRound === "number" && s.bestRound !== s.round - 1) restoreBest(slug);
        // Material/render issues of a mixed review wait for the material step (state keeps them).
        const out = await runRole(slug, s, "cad-modeler", ctx({ issues: s.issues.filter((i) => i.target === "geometry"), script: store.readFile(slug, F.model), skills: modelingSkills(), lessons: deps.lessons?.() ?? "", ...(typeof s.bestScore === "number" && typeof s.bestRound === "number" ? { best: { score: s.bestScore, round: s.bestRound } } : {}) }), parseModel);
        if (out) commit(slug, s.state, out.cost, okWith(afterStepOk, out.cost), () => store.writeFile(slug, F.model, `${out.value.script}\n`));
        return;
      }
      case "building":
        return buildingStep(kit, slug, s, plan);
      case "materials": {
        if (!needPlan()) return;
        const modelParts = modelPartsOutsidePlan(store.dir(slug), plan);
        const parse = (text: string) => {
          const p = parseMaterials(text);
          return p.ok ? crossCheckMaterials(plan!, p.value.materials, modelParts) : p;
        };
        const palette = await paletteFor(kit, slug, references);
        const out = await runRole(slug, s, "material-artist", ctx({ issues: nonGeometry(s.issues), modelParts, palette }), parse);
        if (out) commit(slug, s.state, out.cost, okWith(afterStepOk, out.cost, out.value.note), () => writeJson(slug, F.materials, { materials: out.value.materials }));
        return;
      }
      case "rendering":
        return renderingStep(kit, slug, s, ctx);
      case "reviewing": {
        // geometry-only review (phase 1 of a Blender session) ignores colours: no delta table there
        const colorDelta = reviewModeOf(s) === "geometry" ? null : await colorDeltaFor(kit, slug, renderPaths(slug), "fast");
        const out = await runRole(slug, s, "visual-reviewer", ctx({ renders: renderPaths(slug), reviewMode: reviewModeOf(s), colorDelta }), parseVerdict);
        if (!out) return;
        const v = out.value;
        let decided: W3DSnapshot | null = null;
        commit(slug, s.state, out.cost, (x) => (decided = afterReview(x, v, out.cost)), () => {
          writeJson(slug, F.review, v);
          const d = decided;
          // This round is the best so far: keep a copy, the loop may end on a worse round later.
          if (d && d.bestRound === s.round && d.bestScore === reviewTotal(v.scores)) saveBest(slug);
          // An approved round is kept as it is; only a loop that ended without approval goes back to the best version.
          if (d && !v.ok && d.state === "optimizing" && shouldUseBest(d) && restoreBest(slug)) {
            log(`workshop3d ${slug}: dùng lại bản tốt nhất (vòng ${d.bestRound}).`);
            return;
          }
          // A render complaint asks render-director for a new plan in the next round.
          if (!v.ok && v.issues.some((i) => i.target === "render")) remove(slug, F.renderPlan);
        });
        return;
      }
      case "hqrender":
        return hqRenderStep(kit, slug, s);
      case "hqreview":
        return hqReviewStep(kit, slug, s, ctx);
      case "hqmaterials":
        return hqMaterialsStep(kit, slug, s, ctx, plan);
      case "optimizing":
        return optimizingStep(kit, slug, s, ctx);
      case "presenting": {
        let viewNote: string | null = null;
        // 360-degree panorama from inside the cabin (Blender, checkpointed): a failure only drops it from the page.
        if (s.hqMode && s.hqMode !== "off" && deps.hq?.available() && deps.hq.panorama) {
          try {
            const pano = await deps.hq.panorama(slug, { shouldContinue: () => store.get(slug)?.snapshot.state === "presenting" });
            if (pano.aborted) return;
            if (pano.error) viewNote = [viewNote, pano.error].filter(Boolean).join(" ");
          } catch (e) {
            viewNote = [viewNote, `Không tạo được ảnh 360°: ${errText(e).slice(0, 160)}`].filter(Boolean).join(" ");
          }
          if (!atStep(store.get(slug)?.snapshot, "presenting")) return;
        }
        const out = await runRole(slug, s, "render-presenter", ctx({ renders: presenterRenders(kit, slug) }), parsePresent);
        if (!out) return;
        // Sessions with a Blender phase get a fixed review section (both phases, images, backlog) after the presenter's text.
        const cur = store.get(slug)?.snapshot ?? s;
        const tail = cur.hqMode && cur.hqMode !== "off"
          ? reviewSection(cur, readJson<{ scores?: W3DSnapshot["finalScores"] & object }>(slug, F.review), hqRenderFiles(store.dir(slug)), has(slug, BLENDER_GLB))
          : "";
        commit(slug, s.state, out.cost, okWith(afterStepOk, out.cost, viewNote), () => store.writeFile(slug, F.report, `${out.value.summary}\n${tail}`));
        // Offline presentation page (outputs/trinh-bay): a failure here never fails the session.
        try {
          buildPresentation(store.dir(slug));
        } catch {
          // the presentation button rebuilds it on demand
        }
        try {
          deps.deliver?.(slug);
        } catch {
          // the results strip copies again on demand
        }
        return;
      }
      default:
        return;
    }
  }

  async function waitForQuota(slug: string, s: W3DSnapshot): Promise<void> {
    const until = s.waitUntil ?? deps.now();
    while (deps.now() < until) {
      await deps.sleep(Math.min(SLEEP_CHUNK_MS, until - deps.now()));
      const cur = store.get(slug)?.snapshot;
      if (!cur || cur.state !== "waiting_quota" || cur.waitUntil !== until) return; // paused, stopped or changed: the loop re-reads
    }
    const cur = store.get(slug)?.snapshot;
    if (cur?.state === "waiting_quota" && cur.waitUntil === until) save(slug, cur, quotaReady(cur));
  }

  function ensureLoop(slug: string): void {
    if (active.has(slug)) return;
    const entry: Entry = { done: Promise.resolve() };
    active.set(slug, entry);
    const exit = (): void => {
      if (active.get(slug) === entry) active.delete(slug);
    };
    entry.done = (async () => {
      await Promise.resolve();
      let last = "";
      let same = 0;
      try {
        for (;;) {
          const rec = store.get(slug);
          // Read and exit decision in the same tick: a resume() after this sees no active loop and starts a new one.
          if (!rec) return exit();
          if (!isValidSnapshot(rec.snapshot)) {
            log(`workshop3d ${slug}: state.json không hợp lệ, dừng vòng chạy.`);
            return exit();
          }
          if (!isWorking(rec.snapshot.state)) return exit();
          const key = JSON.stringify(rec.snapshot);
          same = key === last ? same + 1 : 0;
          last = key;
          if (same >= MAX_NO_PROGRESS) {
            const error = `Phiên không tiến triển sau ${MAX_NO_PROGRESS + 1} vòng liên tiếp ở bước "${rec.snapshot.state}"; đã dừng để tránh chạy vòng vô hạn.`;
            log(`workshop3d ${slug}: ${error}`);
            save(slug, rec.snapshot, { ...rec.snapshot, state: "failed", resumeState: rec.snapshot.state === "waiting_quota" ? rec.snapshot.resumeState : rec.snapshot.state, waitUntil: null, error });
            return exit();
          }
          if (rec.snapshot.state === "waiting_quota") await waitForQuota(slug, rec.snapshot);
          else await advance(slug, rec);
        }
      } catch (e) {
        log(`workshop3d ${slug}: lỗi bất ngờ: ${errText(e)}`);
        try {
          const cur = store.get(slug)?.snapshot;
          if (cur && isValidSnapshot(cur) && isWorking(cur.state)) save(slug, cur, { ...cur, state: "failed", resumeState: cur.state === "waiting_quota" ? cur.resumeState : cur.state, waitUntil: null, error: `Lỗi bất ngờ: ${errText(e).slice(0, 500)}` });
        } catch {
          /* nothing more to do */
        }
        exit();
      }
    })();
  }

  function kick(slug: string): void {
    lastErrors.delete(slug);
    cancelStreak.delete(slug);
    deps.resetCancel?.();
    ensureLoop(slug);
  }

  return {
    start(brief, files = {}) {
      // Never cut the request silently: a longer description is refused with the limit (HTTP and CLI check it too).
      if (brief.object.length > W3D_BRIEF_LIMITS.object) {
        throw new W3DError(`Mô tả vật thể dài ${brief.object.length} ký tự, vượt giới hạn ${W3D_BRIEF_LIMITS.object} ký tự: hãy rút gọn hoặc đưa bớt chi tiết vào bảng tham số.`);
      }
      const names = Object.keys(files).map((n) => {
        const base = path.basename(n.replace(/\\/g, "/"));
        try {
          return safeRel(base);
        } catch {
          throw new W3DError(`Tên tệp đính kèm không hợp lệ: ${n.slice(0, 80)}`);
        }
      });
      const slug = store.create({ ...brief, attachments: [...new Set([...brief.attachments, ...names])] }, initialSnapshot({ ...(deps.limits ?? {}), hqMode: deps.hqMode?.() ?? "off" }));
      Object.values(files).forEach((content, i) => store.writeFile(slug, `inbox/${names[i]}`, content));
      kick(slug);
      return slug;
    },
    answer(slug, text) {
      const t = text.trim();
      if (!t) throw new W3DError("Câu trả lời đang trống.");
      const s = load(slug).snapshot;
      const next = answered(s);
      const prev = readJson<IntakeAnswer[]>(slug, F.answers) ?? [];
      writeJson(slug, F.answers, [...prev, { questions: s.questions, answer: t.slice(0, MAX_ANSWER) }]);
      save(slug, s, next);
      kick(slug);
    },
    pause(slug) {
      const s = load(slug).snapshot;
      save(slug, s, pauseState(s));
    },
    resume(slug) {
      const s = load(slug).snapshot;
      save(slug, s, resumeState(s));
      kick(slug);
    },
    stop(slug) {
      const s = load(slug).snapshot;
      save(slug, s, stopState(s));
      // cancelActive kills every running role run; only use it when no other session is running a step.
      if ([...active.keys()].every((k) => k === slug)) deps.cancelActive?.();
    },
    continueWith(slug, text) {
      const rec = load(slug);
      const notes = typeof text === "string" ? text.trim() : "";
      if (!notes) throw new W3DError("Hãy ghi chỗ chưa hài lòng hoặc nội dung cần sửa.");
      if (notes.length > MAX_ANSWER) throw new W3DError(`Nội dung dài quá ${MAX_ANSWER} ký tự.`);
      const st = rec.snapshot.state;
      if (active.has(slug) || !(st === "done" || st === "stopped" || st === "failed")) throw new W3DError("Chỉ dựng tiếp được phiên đã xong (hoặc đã dừng, bị lỗi).");
      if (!has(slug, F.model) || !has(slug, F.buildOk) || !has(slug, F.spec)) throw new W3DError("Chưa có lần dựng thành công nào nên chưa dựng tiếp được.");
      const s = rec.snapshot;
      const note = `Dựng tiếp theo ý bạn: ${notes.replace(/\s+/g, " ").slice(0, 300)}`;
      // One round only: fixRounds at the maximum lets the review approve or add a note, never loop. The user's notes go to the
      // CAD modeler (geometry) and to the material artist; the old best version must never overwrite what the user asked for.
      save(slug, s, {
        ...s, state: "modeling", resumeState: null, buildRetries: 0, fixRounds: s.maxFixRounds, round: s.round + 1, stepFailures: 0,
        issues: [{ target: "geometry", text: notes }, { target: "material", text: notes }], questions: [], error: null,
        waitUntil: null, waitReason: null, autoResumes: 0, bestScore: null, bestRound: null, noImprove: 0,
        bestFinalScore: null, bestFinalRound: null, hqFixRounds: 0, hqRedo: null, backlog: [], note: note,
      });
      // Images and extras of the old model are stale: Blender renders, panorama, viewing GLB and best copies are made again.
      for (const rel of [BEST_DIR, "best-final", "renders/hq", "renders/pano", "renders/view", "review-final.json", "outputs/model-view.glb", "outputs/model-view-open.glb", "outputs/model-blender.glb", "outputs/trinh-bay"]) {
        fs.rmSync(abs(slug, rel), { recursive: true, force: true });
      }
      deps.resetCancel?.();
      kick(slug);
    },
    rebuild(slug, newParams) {
      const rec = load(slug);
      if (active.has(slug) || isWorking(rec.snapshot.state)) throw new W3DError("Phiên đang chạy: hãy tạm dừng hoặc dừng trước khi dựng lại.");
      if (!has(slug, F.model)) throw new W3DError("Chưa có model.py: phiên chưa tới bước dựng mô hình nên chưa dựng lại được.");
      if (!has(slug, F.buildOk) || !has(slug, F.spec)) throw new W3DError("Chưa có lần dựng thành công nào nên chưa dựng lại được.");
      const entries = Object.entries(newParams ?? {});
      if (entries.length > MAX_REBUILD_PARAMS) throw new W3DError(`Tối đa ${MAX_REBUILD_PARAMS} tham số mỗi lần dựng lại.`);
      const params: Record<string, string | number> = {};
      for (const [k, v] of entries) {
        if (!k || k.length > MAX_PARAM_KEY) throw new W3DError(`Tên tham số phải từ 1 đến ${MAX_PARAM_KEY} ký tự.`);
        if (!(typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) throw new W3DError(`Tham số ${k} phải là số hữu hạn hoặc chuỗi.`);
        if (typeof v === "string" && v.length > MAX_PARAM_TEXT) throw new W3DError(`Giá trị của tham số ${k} dài quá ${MAX_PARAM_TEXT} ký tự.`);
        params[k] = v;
      }
      // brief.params is updated by the building step only after the patch succeeded (brief and model.py stay consistent).
      writeJson(slug, F.rebuild, { params });
      const s = rec.snapshot;
      // A rebuild is build + render only: with fixRounds at the maximum the review can approve or add a note, never loop.
      // New parameters start a new comparison: the old best version must never overwrite the user's rebuild.
      save(slug, s, {
        ...s, state: "building", resumeState: null, buildRetries: 0, fixRounds: s.maxFixRounds, stepFailures: 0, issues: [], questions: [], error: null,
        waitUntil: null, waitReason: null, autoResumes: 0, bestScore: null, bestRound: null, noImprove: 0,
      });
      fs.rmSync(abs(slug, BEST_DIR), { recursive: true, force: true });
      kick(slug);
    },
    recover() {
      const started: string[] = [];
      for (const item of store.list()) {
        if (active.has(item.slug)) continue;
        const rec = store.get(item.slug);
        if (!rec || !isValidSnapshot(rec.snapshot)) {
          log(`workshop3d ${item.slug}: bỏ qua khi khôi phục vì state.json không hợp lệ.`);
          continue;
        }
        if (isWorking(rec.snapshot.state)) started.push(item.slug);
      }
      if (started.length > 0) deps.resetCancel?.();
      for (const slug of started) ensureLoop(slug);
      return started;
    },
    async idle(slug) {
      for (;;) {
        const entries = slug ? [active.get(slug)].filter((e): e is Entry => !!e) : [...active.values()];
        if (entries.length === 0) return;
        await Promise.all(entries.map((e) => e.done));
      }
    },
  };
}
