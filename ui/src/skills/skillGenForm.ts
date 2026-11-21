/** Pure helpers for the generative ("Tạo mới") skill train form. No React. */
import type { BriefDraft } from "./skillBrief";
import type { GenState, SkillSession } from "../types";

/** Matches MAX_ROUNDS_LIMIT in src/core/roles/skill-session.ts. */
export const GEN_MAX_ROUNDS = 20;

/** Matches SLUG_RE = /^[a-z0-9-]{1,40}$/ on the server. */
export function slugFromTitle(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 40).replace(/-+$/g, "");
}

export function composeBrief(d: BriefDraft): string {
  const parts: string[] = [];
  const desc = d.description.trim();
  if (desc) parts.push(desc);
  const kws = d.keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length) parts.push(`Từ khoá: ${kws.join(", ")}`);
  if (d.costUsd !== undefined) parts.push(`Chi phí tối đa: ${d.costUsd} USD`);
  if (d.timeMinutes !== undefined) parts.push(`Thời gian tối đa: ${d.timeMinutes} phút`);
  return parts.join("\n");
}

/** Returns a Vietnamese error message, or "" when valid. */
export function validateMaxRounds(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > GEN_MAX_ROUNDS) return `Số vòng tối đa phải là số nguyên từ 1 đến ${GEN_MAX_ROUNDS}.`;
  return "";
}

/** Placeholder only: the brief is deliberately not embedded; the real SKILL.md is written at score 100. */
export function buildSeedSkillMd(slug: string, _brief: string): string {
  return `---\nname: ${slug}\ndescription: ${slug} (bản nháp, đang huấn luyện)\n---\n\n# ${slug}\n\nBản nháp, đang huấn luyện.\n`;
}

export type RoundPhase =
  | "generating"
  | "ready_to_grade"
  | "paused"
  | "finalizing"
  | "done"
  | "final_failed"
  | "legacy_exhausted";

type PhaseSession = Pick<SkillSession, "status" | "rounds">;

export function roundPhase(session: PhaseSession, gen: GenState | null | undefined): RoundPhase {
  switch (session.status) {
    case "exhausted":
      return "legacy_exhausted";
    case "paused":
      return "paused";
    case "generating":
      return "generating";
    case "awaiting_score":
      return "ready_to_grade";
    case "completed": {
      const f = gen?.final;
      if (!f) return "done"; // legacy completed session
      if (f.status === "done") return "done";
      if (f.status === "failed") return "final_failed";
      return "finalizing";
    }
  }
}

/** Grading is only allowed when a sample exists (or an old session without any sample). */
export function canGrade(session: PhaseSession, gen: GenState | null | undefined): boolean {
  if (roundPhase(session, gen) !== "ready_to_grade") return false;
  const cur = session.rounds[session.rounds.length - 1];
  if (cur?.sample) return true;
  return !session.rounds.some((r) => r.sample);
}

export function isFinderBusy(gen: GenState | null | undefined): boolean {
  return gen?.finder.status === "running";
}

export function canDownload(session: Pick<SkillSession, "status"> | null | undefined): boolean {
  return session?.status === "completed";
}

/** True only while the session still awaits the user's grade (not completed, exhausted, generating, paused). */
export function canTrainMore(session: Pick<SkillSession, "status"> | null | undefined): boolean {
  return session?.status === "awaiting_score";
}
