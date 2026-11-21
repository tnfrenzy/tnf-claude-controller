/**
 * Pure state machine for a skill training session: brief, agent set, rounds,
 * human score 0-100 and feedback. No I/O; every function returns a new object.
 * Error messages are Vietnamese; code is English.
 */
import type { SkillAgent } from "./skill-agent-set.js";
import { SkillError } from "../skill-workshop/package.js";

export const DEFAULT_MAX_ROUNDS = 5;
export const MAX_ROUNDS_LIMIT = 20;
export const MAX_FEEDBACK = 4000;

/** "exhausted" is only read from old data; it is never produced any more. */
export type SessionStatus = "generating" | "awaiting_score" | "paused" | "completed" | "exhausted";

export interface RoundSample {
  files: { format: "docx" | "xlsx" | "pdf" | "html" | "dxf" | "step"; name: string }[];
  summary: string;
  costUsd: number;
  /** Requested formats that could not be built (reason in Vietnamese). */
  notes?: string[];
}

export interface SessionRound {
  n: number;
  startedAt: string;
  feedbackIn?: string;
  score?: number;
  feedback?: string;
  gradedAt?: string;
  sample?: RoundSample;
  error?: string;
}

export interface SkillSession {
  version: 1;
  brief: string;
  agents: SkillAgent[];
  maxRounds: number;
  status: SessionStatus;
  rounds: SessionRound[];
  createdAt: string;
  updatedAt: string;
}

function invalid(message: string): SkillError {
  return new SkillError(message, 400, "session_invalid");
}

export function createSession(input: { brief: string; agents: SkillAgent[]; maxRounds?: number; now: string }): SkillSession {
  const brief = typeof input.brief === "string" ? input.brief.trim() : "";
  if (!brief) throw invalid("Brief không được để trống.");
  const maxRounds = input.maxRounds === undefined ? DEFAULT_MAX_ROUNDS : input.maxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_ROUNDS_LIMIT) {
    throw invalid(`Số vòng tối đa phải là số nguyên từ 1 đến ${MAX_ROUNDS_LIMIT}.`);
  }
  return {
    version: 1,
    brief,
    agents: JSON.parse(JSON.stringify(input.agents ?? [])) as SkillAgent[],
    maxRounds,
    status: "generating",
    rounds: [{ n: 1, startedAt: input.now }],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function noSample(): SkillError {
  return new SkillError("Chưa có tệp mẫu của vòng này để chấm. Hãy chờ tạo xong tệp mẫu.", 400, "session_no_sample");
}

/** Current round must be `generating`; stores the sample and moves to awaiting_score. */
export function attachSample(session: SkillSession, input: { n: number; sample: RoundSample; now: string }): SkillSession {
  if (session.status !== "generating") {
    throw new SkillError("Phiên không ở trạng thái đang tạo tệp mẫu.", 409, "session_not_generating");
  }
  const next: SkillSession = JSON.parse(JSON.stringify(session));
  const last = currentRound(next);
  if (last.n !== input.n) throw invalid("Số vòng không khớp vòng hiện tại.");
  last.sample = JSON.parse(JSON.stringify(input.sample)) as RoundSample;
  delete last.error;
  next.status = "awaiting_score";
  next.updatedAt = input.now;
  return next;
}

export function markPaused(session: SkillSession, input: { reason: string; now: string }): SkillSession {
  if (session.status !== "generating") {
    throw new SkillError("Phiên không ở trạng thái đang tạo tệp mẫu.", 409, "session_not_generating");
  }
  const next: SkillSession = JSON.parse(JSON.stringify(session));
  currentRound(next).error = String(input.reason ?? "").slice(0, 1000);
  next.status = "paused";
  next.updatedAt = input.now;
  return next;
}

export function resumeSession(session: SkillSession, now: string): SkillSession {
  if (session.status !== "paused") {
    throw new SkillError("Phiên không bị tạm dừng.", 409, "session_not_paused");
  }
  const next: SkillSession = JSON.parse(JSON.stringify(session));
  next.status = "generating";
  next.updatedAt = now;
  return next;
}

export function gradeRound(session: SkillSession, input: { score: number; feedback: string; now: string }): SkillSession {
  if (session.status === "completed" || session.status === "exhausted") {
    throw new SkillError("Phiên đã đóng, không thể chấm thêm.", 400, "session_closed");
  }
  if (session.status !== "awaiting_score") throw noSample();
  {
    const cur = session.rounds[session.rounds.length - 1];
    const anySample = session.rounds.some((r) => r.sample);
    if (!cur || (!cur.sample && anySample)) throw noSample();
  }
  const { score } = input;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    throw invalid("Điểm phải là số nguyên từ 0 đến 100.");
  }
  const feedback = (typeof input.feedback === "string" ? input.feedback : "").trim().slice(0, MAX_FEEDBACK);
  if (score < 100 && !feedback) throw invalid("Cần nhận xét khi điểm dưới 100 để làm đầu vào cho vòng sau.");

  const next: SkillSession = JSON.parse(JSON.stringify(session));
  const last = next.rounds[next.rounds.length - 1];
  if (!last) throw invalid("Phiên không có vòng nào để chấm.");
  last.score = score;
  last.feedback = feedback;
  last.gradedAt = input.now;
  next.updatedAt = input.now;
  if (score === 100) {
    next.status = "completed";
  } else {
    // maxRounds is only a reminder threshold; it never blocks another round.
    next.rounds.push({ n: last.n + 1, startedAt: input.now, feedbackIn: feedback });
    next.status = "generating";
  }
  return next;
}

/** A session that reached 100 is reopened for an upgrade: a new round starts with the user's direction as its input. */
export function upgradeSession(session: SkillSession, input: { note: string; now: string }): SkillSession {
  if (session.status !== "completed") {
    throw new SkillError("Chỉ nâng cấp được skill đã đạt 100 điểm.", 409, "session_not_completed");
  }
  const next: SkillSession = JSON.parse(JSON.stringify(session));
  const last = currentRound(next);
  const note = (typeof input.note === "string" ? input.note : "").trim().slice(0, MAX_FEEDBACK);
  next.rounds.push({ n: last.n + 1, startedAt: input.now, feedbackIn: note || UPGRADE_DEFAULT_NOTE });
  next.status = "generating";
  next.updatedAt = input.now;
  return next;
}

export const UPGRADE_DEFAULT_NOTE = "Nâng cấp skill: tìm thêm thông tin mới và làm skill tốt hơn bản đã đạt 100 điểm.";

function corruptSession(why: string): SkillError {
  return new SkillError(`Tệp phiên huấn luyện (session.json) bị hỏng: ${why}.`, 400, "session_corrupt");
}

/** Validate a session read from disk; throws SkillError(session_corrupt). */
export function normalizeSession(raw: unknown): SkillSession {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw corruptSession("không phải đối tượng");
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) throw corruptSession("phiên bản không hợp lệ");
  if (typeof s.brief !== "string" || !s.brief.trim()) throw corruptSession("thiếu brief");
  if (!Array.isArray(s.agents)) throw corruptSession("agents không phải mảng");
  const maxRounds = s.maxRounds;
  if (typeof maxRounds !== "number" || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_ROUNDS_LIMIT) {
    throw corruptSession("maxRounds không hợp lệ");
  }
  if (
    s.status !== "generating" &&
    s.status !== "awaiting_score" &&
    s.status !== "paused" &&
    s.status !== "completed" &&
    s.status !== "exhausted"
  ) {
    throw corruptSession("trạng thái lạ");
  }
  if (typeof s.createdAt !== "string" || typeof s.updatedAt !== "string") throw corruptSession("thiếu mốc thời gian");
  if (!Array.isArray(s.rounds) || s.rounds.length < 1) throw corruptSession("không có vòng nào");
  s.rounds.forEach((r: unknown, i: number) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw corruptSession("vòng không hợp lệ");
    const round = r as Record<string, unknown>;
    if (round.n !== i + 1) throw corruptSession("vòng không đánh số liên tục từ 1");
    if (typeof round.startedAt !== "string") throw corruptSession("vòng thiếu startedAt");
    if (round.score !== undefined) {
      const sc = round.score;
      if (typeof sc !== "number" || !Number.isInteger(sc) || sc < 0 || sc > 100) throw corruptSession("điểm ngoài khoảng 0..100");
    }
  });
  return s as unknown as SkillSession;
}

type SessionBackend = {
  readSession(slug: string): Promise<Record<string, unknown> | null>;
  writeSession(slug: string, data: object): Promise<void>;
};

/**
 * Persist sessions through the skill store. `start` is refused only while a
 * session is still open (awaiting_score); a completed/exhausted session may be
 * replaced by a new one. `grade` calls for one slug are serialized.
 */
export function createSessionStore(store: SessionBackend, opts: { now?: () => string; onCompleted?: (slug: string, session: SkillSession) => Promise<void> } = {}) {
  const clock = opts.now ?? (() => new Date().toISOString());
  const chains = new Map<string, Promise<unknown>>();
  function serial<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(slug) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(slug, run.catch(() => undefined));
    return run;
  }
  async function get(slug: string): Promise<SkillSession | null> {
    const raw = await store.readSession(slug);
    return raw === null ? null : normalizeSession(raw);
  }
  return {
    get,
    start(slug: string, input: { brief: string; agents: SkillAgent[]; maxRounds?: number }): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (existing && isOpen(existing)) {
          throw new SkillError("Skill này đã có phiên đang mở, hãy chấm xong phiên hiện tại trước.", 409, "session_exists");
        }
        const session = createSession({ ...input, now: clock() });
        await store.writeSession(slug, session);
        return session;
      });
    },
    setAgents(slug: string, agents: SkillAgent[]): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (!existing) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
        if (!isOpen(existing)) throw new SkillError("Phiên đã đóng, không thể đổi agent.", 400, "session_closed");
        const next: SkillSession = {
          ...existing,
          agents: JSON.parse(JSON.stringify(agents ?? [])) as SkillAgent[],
          updatedAt: clock(),
        };
        await store.writeSession(slug, next);
        return next;
      });
    },
    attachSample(slug: string, input: { n: number; sample: RoundSample }): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (!existing) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
        const next = attachSample(existing, { ...input, now: clock() });
        await store.writeSession(slug, next);
        return next;
      });
    },
    pause(slug: string, reason: string): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (!existing) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
        const next = markPaused(existing, { reason, now: clock() });
        await store.writeSession(slug, next);
        return next;
      });
    },
    resume(slug: string): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (!existing) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
        const next = resumeSession(existing, clock());
        await store.writeSession(slug, next);
        return next;
      });
    },
    upgrade(slug: string, note: string): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (!existing) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
        const next = upgradeSession(existing, { note, now: clock() });
        await store.writeSession(slug, next);
        return next;
      });
    },
    grade(slug: string, input: { score: number; feedback: string }): Promise<SkillSession> {
      return serial(slug, async () => {
        const existing = await get(slug);
        if (!existing) throw new SkillError("Skill này chưa có phiên huấn luyện.", 404, "session_missing");
        const next = gradeRound(existing, { ...input, now: clock() });
        await store.writeSession(slug, next);
        // Hook is awaited inside the serial chain, so a slow save blocks the next grade of the same slug.
        // Accepted limit: if the hook fails after "completed" was written, the package is lost; rebuild it manually.
        if (next.status === "completed" && opts.onCompleted) {
          try {
            await opts.onCompleted(slug, next);
          } catch (e) {
            console.warn("skill-session onCompleted hook failed:", e instanceof Error ? e.message : e);
          }
        }
        return next;
      });
    },
  };
}

export function currentRound(session: SkillSession): SessionRound {
  const last = session.rounds[session.rounds.length - 1];
  if (!last) throw corruptSession("không có vòng nào");
  return last;
}

export function isOpen(session: SkillSession): boolean {
  return session.status === "generating" || session.status === "awaiting_score" || session.status === "paused";
}

export function bestScore(session: SkillSession): number | null {
  let best: number | null = null;
  for (const r of session.rounds) {
    if (typeof r.score === "number" && (best === null || r.score > best)) best = r.score;
  }
  return best;
}
