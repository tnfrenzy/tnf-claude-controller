/**
 * Routes under /api/skills-gen: skill-generation sessions (brief -> agents -> score loop -> package).
 * `handle` returns a result or null (no match); errors are thrown (SkillError / BodyError) and
 * caught by the caller in http.ts. Gen state lives in <dataDir>/skills-gen/<slug>.json (atomic write)
 * and every read-modify-write for one slug is serialized through a promise chain.
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { createSessionStore } from "../core/roles/skill-session.js";
import { SkillError, validateSlug } from "../core/skill-workshop/package.js";
import { matchRoles, type RoleMatch, type MatchRole } from "../core/roles/role-match.js";
import { buildSkillAgentSet, type NewAgentInput } from "../core/roles/skill-agent-set.js";
import { buildFinderPrompt, parseFinderResults, isPermissiveLicense, type FinderRepo } from "../core/roles/agent-finder.js";
import type { SkillStore } from "../core/skill-workshop/store.js";
import { buildSingleFile, buildSkillPackageZip, type SourceNote } from "../core/skill-workshop/export.js";
import type { RunStep } from "../core/skill-workshop/runner.js";
import { buildSamplePrompt, parseSampleResult, buildFinalSkillPrompt, parseFinalSkillResult, type FeedbackEntry } from "../core/skill-workshop/sample-steps.js";
import { buildDocx, buildXlsx } from "../core/skill-workshop/sample-files.js";
import { DEFAULT_OUTPUTS, OUTPUT_FORMATS, buildDxf, buildHtml, formatInfo, parseOutputs, type OutputFormat } from "../core/skill-workshop/output-formats.js";
import { renderPdf, renderStep } from "../core/skill-workshop/sample-render.js";

export interface GenState {
  roles: RoleMatch[];
  repos: FinderRepo[];
  finder: StepState;
  sample: StepState;
  /** Absent only for gen files written before sample rounds existed (legacy: zip allowed as before). */
  final?: StepState;
  costUsd: number;
  costCapUsd: number;
  /** Formats the user wants to open to grade (absent = Word + Excel). */
  outputs?: OutputFormat[];
}

export interface StepState {
  status: "idle" | "running" | "done" | "failed";
  error?: string;
}

export const DEFAULT_COST_CAP_USD = 3;
const FINDER_WAIT_MS = 5 * 60 * 1000;
export const MAX_COST_CAP_USD = 20;

export interface SkillsGenResult {
  status: number;
  body?: unknown;
  zip?: { data: Buffer; filename: string };
  file?: { data: Buffer; filename: string; contentType: string };
}

type SessionBackend = Parameters<typeof createSessionStore>[0] & Pick<SkillStore, "readZipEntries">;

export interface SkillsGenDeps {
  store: SessionBackend;
  dataDir: string;
  readBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  listRoles: () => MatchRole[];
  finder: (prompt: string) => Promise<{ ok: boolean; text: string }>;
  /** Text-only agent step (no tools). Optional so tests that never sample can omit it. */
  runStep?: RunStep;
  /** python.exe of the CAD venv (tools.cad.python), used to build STEP files. */
  cadPython?: string | null;
}

/**
 * One note per found repo (excerpt may be empty). The finder parser already strips excerpt and
 * agentPrompt for non-permissive licenses; re-checked here so stored gen files cannot leak them.
 */
export function buildSourceNotes(repos: FinderRepo[]): SourceNote[] {
  return repos.map((r) => {
    const ok = isPermissiveLicense(r.license);
    const used = [r.reason, ...(Array.isArray(r.features) ? r.features : [])]
      .filter((s) => typeof s === "string" && s.trim() !== "")
      .join("; ")
      .slice(0, 600);
    const note: SourceNote = { url: r.url, excerpt: ok ? (r.excerpt ?? "") : "", used };
    if (r.license) note.license = r.license;
    if (ok && r.agentPrompt) note.agentPrompt = r.agentPrompt;
    return note;
  });
}

export const defaultGen =(): GenState => ({
  roles: [],
  repos: [],
  finder: { status: "idle" },
  sample: { status: "idle" },
  final: { status: "idle" },
  costUsd: 0,
  costCapUsd: DEFAULT_COST_CAP_USD,
});

function stepState(v: unknown): StepState | null {
  if (!v || typeof v !== "object") return null;
  const s = (v as { status?: unknown }).status;
  return s === "idle" || s === "running" || s === "done" || s === "failed" ? (v as StepState) : null;
}

export function createSkillsGen(deps: SkillsGenDeps) {
  const sessions = createSessionStore(deps.store, {});
  const genDir = path.join(deps.dataDir, "skills-gen");
  const chains = new Map<string, Promise<unknown>>();

  function genFile(slug: string): string {
    return path.join(genDir, `${slug}.json`);
  }

  async function readGenRaw(slug: string): Promise<GenState> {
    try {
      const raw = JSON.parse(await fs.promises.readFile(genFile(slug), "utf8")) as Partial<GenState>;
      const d = defaultGen();
      const out: GenState = {
        roles: Array.isArray(raw.roles) ? raw.roles : d.roles,
        repos: Array.isArray(raw.repos) ? raw.repos : d.repos,
        finder: stepState(raw.finder) ?? d.finder,
        sample: stepState(raw.sample) ?? d.sample,
        costUsd: typeof raw.costUsd === "number" && Number.isFinite(raw.costUsd) ? raw.costUsd : 0,
        costCapUsd: typeof raw.costCapUsd === "number" && raw.costCapUsd > 0 ? raw.costCapUsd : DEFAULT_COST_CAP_USD,
      };
      const outs = parseOutputs(raw.outputs);
      if (outs) out.outputs = outs;
      const fin = stepState(raw.final);
      if (fin) out.final = fin;
      return out;
    } catch {
      return defaultGen();
    }
  }

  async function writeGenRaw(slug: string, gen: GenState): Promise<void> {
    await fs.promises.mkdir(genDir, { recursive: true });
    const file = genFile(slug);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(gen, null, 2), "utf8");
    await fs.promises.rename(tmp, file);
  }

  /** Serialized read-modify-write of the gen state of one slug. */
  function updateGen<T>(slug: string, fn: (gen: GenState) => T | Promise<T>): Promise<T> {
    const prev = chains.get(slug) ?? Promise.resolve();
    const run = prev.then(async () => {
      const gen = await readGenRaw(slug);
      const out = await fn(gen);
      await writeGenRaw(slug, gen);
      return out;
    });
    chains.set(slug, run.catch(() => undefined));
    return run;
  }

  function readGen(slug: string): Promise<GenState> {
    const prev = chains.get(slug) ?? Promise.resolve();
    return prev.then(() => readGenRaw(slug));
  }

  function parseSlug(raw: string): string {
    try {
      return validateSlug(decodeURIComponent(raw));
    } catch (e) {
      if (e instanceof SkillError) throw e;
      throw new SkillError("Slug không hợp lệ.", 400, "bad_slug");
    }
  }

  async function handle(req: IncomingMessage, parts: string[], method: string): Promise<SkillsGenResult | null> {
    // parts: ["api","skills-gen","sessions", slug?, ...]
    if (parts[2] !== "sessions") return null;
    if (parts.length === 3 && method === "POST") {
      const body = await deps.readBody(req);
      const slug = parseSlug(typeof body["slug"] === "string" ? body["slug"] : "");
      const brief = typeof body["brief"] === "string" ? body["brief"].trim() : "";
      if (!brief) throw new SkillError("Brief không được để trống.", 400, "session_invalid");
      const input: { brief: string; agents: never[]; maxRounds?: number } = { brief, agents: [] };
      if (body["maxRounds"] !== undefined) input.maxRounds = body["maxRounds"] as number;
      let costCapUsd = DEFAULT_COST_CAP_USD;
      if (body["costCapUsd"] !== undefined) {
        const c = body["costCapUsd"];
        if (typeof c !== "number" || !Number.isFinite(c) || c <= 0 || c > MAX_COST_CAP_USD) {
          throw new SkillError(`Trần chi phí phải là số trong khoảng 0 đến ${MAX_COST_CAP_USD} USD.`, 400, "session_invalid");
        }
        costCapUsd = c;
      }
      const session = await sessions.start(slug, input);
      // A new session resets the gen state (roles, repos, finder, sample, cost) left by an earlier one.
      await updateGen(slug, (gen) => {
        Object.assign(gen, defaultGen(), { costCapUsd });
      });
      return { status: 201, body: session };
    }
    if (parts.length === 5 && parts[4] === "outputs" && method === "PUT") {
      const slug = parseSlug(parts[3]!);
      await requireSession(slug);
      const body = await deps.readBody(req);
      const outs = parseOutputs(body["formats"]);
      if (!outs) throw new SkillError(`Chọn ít nhất một định dạng hợp lệ (${OUTPUT_FORMATS.map((f) => f.id).join(", ")}).`, 400, "bad_formats");
      await updateGen(slug, (gen) => {
        gen.outputs = outs;
      });
      return { status: 200, body: { outputs: outs } };
    }
    if (parts.length === 4 && method === "GET") {
      const slug = parseSlug(parts[3]!);
      const session = await sessions.get(slug);
      if (!session) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
      return { status: 200, body: { session, gen: await readGen(slug) } };
    }
    if (parts.length === 5 && parts[4] === "upgrade" && method === "POST") {
      // A skill at 100 points is trained again: search for more information, then build a better sample.
      const slug = parseSlug(parts[3]!);
      const body = await deps.readBody(req);
      if (body["note"] !== undefined && typeof body["note"] !== "string") throw new SkillError("Hướng nâng cấp phải là chuỗi.", 400, "session_invalid");
      const upgraded = await sessions.upgrade(slug, typeof body["note"] === "string" ? body["note"] : "");
      const note = upgraded.rounds[upgraded.rounds.length - 1]?.feedbackIn ?? "";
      await updateGen(slug, (gen) => {
        gen.sample = { status: "idle" };
        gen.finder = { status: "running" };
        gen.final = { status: "idle" };
        gen.costCapUsd = gen.costUsd + DEFAULT_COST_CAP_USD;
      });
      void runFinder(slug, `${upgraded.brief}

Hướng nâng cấp: ${note}`);
      try {
        await startSampleRound(slug);
      } catch {
        // reported through gen state; the upgrade round stays saved
      }
      return { status: 202, body: upgraded };
    }
    if (parts.length === 5 && parts[4] === "grade" && method === "POST") {
      const slug = parseSlug(parts[3]!);
      const body = await deps.readBody(req);
      const score = body["score"];
      if (typeof score !== "number") throw new SkillError("Điểm phải là số.", 400, "session_invalid");
      const feedback = body["feedback"] === undefined ? "" : body["feedback"];
      if (typeof feedback !== "string") throw new SkillError("Nhận xét phải là chuỗi.", 400, "session_invalid");
      const graded = await sessions.grade(slug, { score, feedback });
      if (graded.status === "generating") {
        try {
          await startSampleRound(slug);
        } catch {
          // a round already running or a missing runner is reported through gen state; grading stays saved
        }
      } else if (graded.status === "completed") {
        await startFinalize(slug);
      }
      return { status: 200, body: graded };
    }
    if (parts.length === 6 && parts[4] === "steps" && method === "POST") {
      const slug = parseSlug(parts[3]!);
      if (parts[5] === "find-roles") {
        const session = await requireSession(slug);
        const matches = matchRoles(session.brief, deps.listRoles());
        await updateGen(slug, (gen) => {
          gen.roles = matches;
        });
        return { status: 200, body: { matches } };
      }
      if (parts[5] === "create-agents") {
        const body = await deps.readBody(req);
        const newAgents = body["newAgents"];
        if (newAgents !== undefined && !Array.isArray(newAgents)) {
          throw new SkillError("newAgents phải là mảng.", 400, "bad_request");
        }
        const session = await requireSession(slug);
        const roles = deps.listRoles();
        const matches = await updateGen(slug, (gen) => {
          if (gen.roles.length === 0) gen.roles = matchRoles(session.brief, roles);
          return gen.roles;
        });
        const built = buildSkillAgentSet({ matches, roles, newAgents: (newAgents ?? []) as NewAgentInput[] });
        if (!built.ok) {
          const err = new SkillError(built.errors.join(" "), 400, "bad_agents");
          err.fields = Object.fromEntries(built.errors.map((m, i) => [`agent-${i}`, m]));
          throw err;
        }
        const updated = await sessions.setAgents(slug, built.agents);
        return { status: 200, body: { session: updated, warnings: built.warnings, missing: built.missing } };
      }
      if (parts[5] === "find-github") {
        const session = await requireSession(slug);
        const started = await updateGen(slug, (gen) => {
          if (gen.finder.status === "running") return false;
          gen.finder = { status: "running" };
          return true;
        });
        if (!started) throw new SkillError("Bước tìm GitHub đang chạy.", 409, "already_running");
        void runFinder(slug, session.brief);
        return { status: 202, body: { finder: { status: "running" } } };
      }
      if (parts[5] === "finalize") {
        const session = await requireSession(slug);
        if (session.status !== "completed") {
          throw new SkillError("Phiên chưa đạt 100 điểm.", 409, "session_not_completed");
        }
        if (!(await startFinalize(slug))) throw new SkillError("Đang tạo SKILL.md hoàn chỉnh.", 409, "already_running");
        return { status: 202, body: { final: { status: "running" } } };
      }
      if (parts[5] === "generate-sample") {
        await startSampleRound(slug);
        return { status: 202, body: { sample: { status: "running" } } };
      }
      return null;
    }
    if (parts.length === 8 && parts[4] === "rounds" && parts[6] === "sample" && method === "GET") {
      const slug = parseSlug(parts[3]!);
      const format = parts[7]!;
      const info = formatInfo(format);
      if (!info) throw new SkillError("Định dạng tệp mẫu không hợp lệ.", 400, "bad_format");
      const contentType = info.contentType;
      if (!/^[1-9][0-9]{0,5}$/.test(parts[5]!)) throw new SkillError("Số vòng không hợp lệ.", 400, "bad_round");
      const n = Number(parts[5]);
      const file = path.join(genDir, slug, `round-${n}`, `sample.${format}`);
      let data: Buffer;
      try {
        data = await fs.promises.readFile(file);
      } catch {
        throw new SkillError("Chưa có tệp mẫu cho vòng này.", 404, "sample_missing");
      }
      return { status: 200, file: { data, filename: `${slug}-round-${n}.${format}`, contentType } };
    }
    if (parts.length === 5 && parts[4] === "zip" && method === "GET") {
      const slug = parseSlug(parts[3]!);
      const session = await requireSession(slug);
      const gen = await readGen(slug);
      if (session.status === "completed" && gen.final && gen.final.status !== "done") {
        throw new SkillError("SKILL.md hoàn chỉnh chưa sẵn sàng.", 409, "final_not_ready");
      }
      let skillMdOverride: string | undefined;
      const extraEntries: { name: string; data: Buffer }[] = [];
      if (gen.final?.status === "done") {
        try {
          skillMdOverride = await fs.promises.readFile(path.join(genDir, slug, "final", "SKILL.md"), "utf8");
        } catch {
          throw new SkillError("SKILL.md hoàn chỉnh chưa sẵn sàng.", 409, "final_not_ready");
        }
        const last = session.rounds[session.rounds.length - 1];
        if (last) {
          for (const format of OUTPUT_FORMATS.map((f) => f.id)) {
            try {
              const data = await fs.promises.readFile(path.join(genDir, slug, `round-${last.n}`, `sample.${format}`));
              extraEntries.push({ name: `samples/round-${last.n}.${format}`, data });
            } catch {
              // sample file absent; skip
            }
          }
        }
      }
      const zipExtras: { references: never[]; sources: string[]; skillMdOverride?: string; extraEntries: { name: string; data: Buffer }[] } = {
        references: [],
        sources: gen.repos.map((r) => r.url),
        extraEntries,
      };
      if (skillMdOverride) zipExtras.skillMdOverride = skillMdOverride;
      const data = await buildSkillPackageZip(deps.store, slug, session, zipExtras);
      return { status: 200, zip: { data, filename: `${slug}.zip` } };
    }
    if (parts.length === 5 && parts[4] === "md" && method === "GET") {
      const slug = parseSlug(parts[3]!);
      const session = await requireSession(slug);
      if (session.status !== "completed") {
        throw new SkillError("Phiên chưa đạt 100 điểm nên chưa xuất được skill.", 409, "session_not_completed");
      }
      const gen = await readGen(slug);
      if (gen.final && gen.final.status !== "done") {
        throw new SkillError("SKILL.md hoàn chỉnh chưa sẵn sàng.", 409, "final_not_ready");
      }
      let skillMd = "";
      if (gen.final?.status === "done") {
        try {
          skillMd = await fs.promises.readFile(path.join(genDir, slug, "final", "SKILL.md"), "utf8");
        } catch {
          throw new SkillError("SKILL.md hoàn chỉnh chưa sẵn sàng.", 409, "final_not_ready");
        }
      } else {
        const found = (await deps.store.readZipEntries(slug)).find((e) => e.name === "SKILL.md");
        skillMd = found ? found.data.toString("utf8") : "";
      }
      const file = buildSingleFile({
        slug,
        skillMd,
        session,
        references: [],
        sources: gen.repos.map((r) => r.url),
        sourceNotes: buildSourceNotes(gen.repos),
      });
      return { status: 200, file: { data: file.data, filename: file.name, contentType: "text/markdown; charset=utf-8" } };
    }
    return null;
  }

  /** Background finder run; never rejects. Status writes go through updateGen (serialized). */
  async function runFinder(slug: string, brief: string): Promise<void> {
    let next: GenState["finder"];
    let repos: FinderRepo[] | null = null;
    try {
      const out = await deps.finder(buildFinderPrompt(brief, "vi"));
      if (!out.ok) {
        next = { status: "failed", error: "Bước tìm GitHub không hoàn tất." };
      } else {
        const parsed = parseFinderResults(out.text);
        if (parsed.ok) {
          repos = parsed.repos;
          next = { status: "done" };
        } else {
          next = { status: "failed", error: parsed.errors.join(" ") };
        }
      }
    } catch (e) {
      next = { status: "failed", error: `Bước tìm GitHub lỗi: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      await updateGen(slug, (gen) => {
        if (repos) gen.repos = repos;
        gen.finder = next;
      });
    } catch {
      // state write failed; nothing more to do
    }
  }

  /** Claims the final slot and runs finalizeSkill in the background; false when already running. */
  async function startFinalize(slug: string): Promise<boolean> {
    const claimed = await updateGen(slug, (gen) => {
      if (gen.final?.status === "running") return false;
      gen.final = { status: "running" };
      return true;
    });
    if (claimed) void finalizeSkill(slug);
    return claimed;
  }

  /** Background final SKILL.md run; never rejects. */
  async function finalizeSkill(slug: string): Promise<void> {
    const setFinal = async (final: StepState, cost = 0): Promise<void> => {
      try {
        await updateGen(slug, (gen) => {
          gen.final = final;
          gen.costUsd += cost;
        });
      } catch {
        // nothing more to do
      }
    };
    try {
      if (!deps.runStep) return await setFinal({ status: "failed", error: "Chưa cấu hình bước chạy agent." });
      const session = await requireSession(slug);
      const last = session.rounds[session.rounds.length - 1];
      const history: FeedbackEntry[] = session.rounds
        .filter((r) => typeof r.score === "number")
        .map((r) => ({ n: r.n, score: r.score as number, feedback: r.feedback ?? "" }));
      const basePrompt = buildFinalSkillPrompt({
        brief: session.brief,
        agents: session.agents,
        feedbackHistory: history,
        lastSummary: last?.sample?.summary,
        sourceNotes: buildSourceNotes((await readGen(slug)).repos),
      });
      let prompt = basePrompt;
      let cost = 0;
      let md: string | null = null;
      let lastError = "không có kết quả";
      for (let attempt = 0; attempt < 2 && md === null; attempt++) {
        const out = await deps.runStep("soan-skill", prompt);
        cost += out.costUsd;
        if (!out.ok) return await setFinal({ status: "failed", error: `Bước tạo SKILL.md không hoàn tất${out.error ? `: ${out.error}` : "."}` }, cost);
        const parsed = parseFinalSkillResult(out.text, session.brief);
        if (parsed.ok) md = parsed.value;
        else {
          lastError = parsed.error;
          prompt = `${basePrompt}\n\nLần trả lời trước không dùng được: ${parsed.error}\nHãy trả lại đúng một khối \`\`\`markdown hợp lệ.`;
        }
      }
      if (md === null) return await setFinal({ status: "failed", error: `Không đọc được SKILL.md từ agent: ${lastError}` }, cost);
      const dir = path.join(genDir, slug, "final");
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, "SKILL.md");
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, md, "utf8");
      await fs.promises.rename(tmp, file);
      await setFinal({ status: "done" }, cost);
    } catch (e) {
      await setFinal({ status: "failed", error: `Bước tạo SKILL.md lỗi: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** Claims the sample slot, resumes a paused session, then runs the round in the background. */
  async function startSampleRound(slug: string): Promise<void> {
    const session = await requireSession(slug);
    if (session.status !== "generating" && session.status !== "paused") {
      throw new SkillError("Phiên không ở trạng thái đang tạo tệp mẫu.", 409, "session_not_generating");
    }
    const claimed = await updateGen(slug, (gen) => {
      if (gen.sample.status === "running") return false;
      gen.sample = { status: "running" };
      return true;
    });
    if (!claimed) throw new SkillError("Đang tạo tệp mẫu cho vòng này.", 409, "already_running");
    try {
      if (session.status === "paused") await sessions.resume(slug);
    } catch (e) {
      await updateGen(slug, (gen) => {
        gen.sample = { status: "idle" };
      });
      throw e;
    }
    void runSampleRound(slug);
  }

  /** Background sample run; never rejects. Failure or cost overrun pauses the session (never exhausts it). */
  async function runSampleRound(slug: string): Promise<void> {
    const fail = async (reason: string): Promise<void> => {
      try {
        await sessions.pause(slug, reason);
      } catch {
        // session state unavailable; the gen state below still reports the failure
      }
      try {
        await updateGen(slug, (gen) => {
          gen.sample = { status: "failed", error: reason };
        });
      } catch {
        // nothing more to do
      }
    };
    try {
      const session = await requireSession(slug);
      const round = session.rounds[session.rounds.length - 1]!;
      // The GitHub scan (started with the session) feeds the sources; wait for it, at most FINDER_WAIT_MS.
      const waitUntil = Date.now() + FINDER_WAIT_MS;
      let gen0 = await readGen(slug);
      while (gen0.finder.status === "running" && Date.now() < waitUntil) {
        await new Promise((r) => setTimeout(r, 1000));
        gen0 = await readGen(slug);
      }
      if (!deps.runStep) return await fail("Chưa cấu hình bước chạy agent.");
      const history: FeedbackEntry[] = session.rounds
        .filter((r) => typeof r.score === "number")
        .map((r) => ({ n: r.n, score: r.score as number, feedback: r.feedback ?? "" }));
      const prev = [...session.rounds].reverse().find((r) => r.n < round.n && r.sample);
      const basePrompt = buildSamplePrompt({
        brief: session.brief,
        agents: session.agents,
        round: round.n,
        feedbackHistory: history,
        prevSummary: prev?.sample?.summary,
        sources: gen0.repos.map((r) => r.url),
        outputs: gen0.outputs ?? DEFAULT_OUTPUTS,
        upgradeNote: session.rounds.find((r) => r.n === round.n - 1)?.score === 100 ? round.feedbackIn : undefined,
      });
      let prompt = basePrompt;
      let cost = 0;
      let parsed: ReturnType<typeof parseSampleResult> | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await deps.runStep("soan-skill", prompt);
        cost += out.costUsd;
        if (!out.ok) return await fail(`Bước tạo tệp mẫu không hoàn tất${out.error ? `: ${out.error}` : "."}`);
        parsed = parseSampleResult(out.text, gen0.outputs ?? DEFAULT_OUTPUTS);
        if (parsed.ok) break;
        prompt = `${basePrompt}\n\nLần trả lời trước không dùng được: ${parsed.error}\nHãy trả lại đúng một khối \`\`\`json hợp lệ.`;
      }
      const total = gen0.costUsd + cost;
      await updateGen(slug, (gen) => {
        gen.costUsd = total;
      });
      if (!parsed || !parsed.ok) return await fail(`Không đọc được mẫu từ agent: ${parsed && !parsed.ok ? parsed.error : "không có kết quả"}`);
      if (total > gen0.costCapUsd) {
        return await fail(`Chi phí ước tính ${total.toFixed(2)} USD vượt trần ${gen0.costCapUsd} USD; hãy tiếp tục nếu muốn chạy thêm.`);
      }
      const dir = path.join(genDir, slug, `round-${round.n}`);
      await fs.promises.mkdir(dir, { recursive: true });
      const files: { format: OutputFormat; name: string }[] = [];
      const notes: string[] = [];
      const wanted = gen0.outputs ?? DEFAULT_OUTPUTS;
      const put = async (format: OutputFormat, data: Buffer | string): Promise<void> => {
        const name = `sample.${format === "step" ? "step" : format}`;
        const file = path.join(dir, name);
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, file);
        files.push({ format, name });
      };
      const { doc, drawing, solids } = parsed.value;
      for (const format of wanted) {
        const label = formatInfo(format)?.label ?? format;
        try {
          if (format === "docx") await put(format, buildDocx(doc));
          else if (format === "xlsx") await put(format, buildXlsx(doc));
          else if (format === "html") await put(format, buildHtml(doc, drawing ?? null));
          else if (format === "dxf") await put(format, buildDxf(drawing!));
          else if (format === "pdf") {
            const target = path.join(dir, "sample.pdf");
            const r = await renderPdf(buildHtml(doc, drawing ?? null), target);
            if (r.ok) files.push({ format, name: "sample.pdf" });
            else notes.push(`${label}: ${r.error}`);
          } else if (format === "step") {
            const target = path.join(dir, "sample.step");
            const r = await renderStep(solids!, target, { configured: deps.cadPython ?? null });
            if (r.ok) files.push({ format, name: "sample.step" });
            else notes.push(`${label}: ${r.error}`);
          }
        } catch (e) {
          notes.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (files.length === 0) return await fail(`Không dựng được tệp nào: ${notes.join(" ")}`);
      await sessions.attachSample(slug, { n: round.n, sample: { files, summary: parsed.value.summary, costUsd: cost, ...(notes.length ? { notes } : {}) } });
      await updateGen(slug, (gen) => {
        gen.sample = { status: "done" };
      });
    } catch (e) {
      await fail(`Bước tạo tệp mẫu lỗi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function requireSession(slug: string) {
    const session = await sessions.get(slug);
    if (!session) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
    return session;
  }

  return { handle, sessions, updateGen, readGen };
}
