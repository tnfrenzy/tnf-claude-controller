/* Pure mapping from controller projects to TNF Tower floors. */

import { pick } from "../lib/lang";

export const MAX_FLOORS = 5;

export type FloorProject = { name: string; running: number; repo_path?: string | null };
export type RunningRunLite = { project: string; prompt?: string };
export type Floor = { id: string; name: string; running: boolean; sub?: string; hasRepo?: boolean };

/** The task queue is shown only for a real project (not the default floor) that has a repo. Pure. */
export function showQueue(projectName: string, repoPath: string | null | undefined): boolean {
  const name = projectName.trim();
  return name !== "" && name !== DEFAULT_FLOOR_ID && !!repoPath && repoPath.trim() !== "";
}

export const DEFAULT_FLOOR_ID = "default";
export const DEFAULT_FLOOR_NAME = "Tầng trệt";

/**
 * Always put the ground floor ("default", not deletable, not counted in MAX_FLOORS) first,
 * then keep the first MAX_FLOORS real projects; a floor is running when ProjectSummary.running > 0.
 * A project literally named "default" is merged into the ground floor.
 */
export function projectsToFloors(projects: readonly FloorProject[], runs: readonly RunningRunLite[] = []): Floor[] {
  const toFloor = (id: string, name: string, p: FloorProject | undefined): Floor => {
    const running = (p?.running ?? 0) > 0;
    const run = running ? runs.find((r) => (r.project || DEFAULT_FLOOR_ID) === id) : undefined;
    const goal = run?.prompt ? run.prompt.replace(/\s+/g, " ").trim() : "";
    const floor: Floor = { id, name, running };
    if (goal) floor.sub = goal.length > 34 ? `${goal.slice(0, 33)}…` : goal;
    if (showQueue(id, p?.repo_path)) floor.hasRepo = true;
    return floor;
  };
  const ground = toFloor(DEFAULT_FLOOR_ID, pick(DEFAULT_FLOOR_NAME, "Ground floor"), projects.find((p) => p.name === DEFAULT_FLOOR_ID));
  const rest = projects.filter((p) => p.name !== DEFAULT_FLOOR_ID).slice(0, MAX_FLOORS).map((p) => toFloor(p.name, p.name, p));
  return [ground, ...rest];
}

export const MAX_SKILL_FLOORS = 5;

export type SkillBadge = "training" | "waiting" | "passed" | "failed" | "idle";
export type SkillFloor = { id: string; name: string; state: string; badge: SkillBadge; score: number | null; running: boolean; sub?: string };
/** Minimal shape of an item of GET /api/skills (SkillMeta or a broken placeholder). */
export type SkillListItem = {
  slug: string;
  title?: string;
  state?: string;
  bestScore?: number | null;
  approvedAt?: string;
  broken?: boolean;
};

/** Unknown states map to "idle". */
export function skillBadge(state: string): SkillBadge {
  switch (state) {
    case "interviewing": case "composing": case "trial": case "grading": return "training";
    case "awaiting_user": return "waiting";
    case "passed": case "awaiting_approval": return "passed";
    case "failed_max_rounds": case "stalled": case "cost_cap": case "stopped": return "failed";
    default: return "idle";
  }
}

/** Broken items are dropped, at most MAX_SKILL_FLOORS kept; bestScore null/0 (not graded yet) gives score null. */
export function skillsToFloors(skills: readonly SkillListItem[]): SkillFloor[] {
  return skills
    .filter((s) => !s.broken)
    .slice(0, MAX_SKILL_FLOORS)
    .map((s) => {
      const state = typeof s.state === "string" ? s.state : "idle";
      const badge = skillBadge(state);
      const floor: SkillFloor = {
        id: s.slug,
        name: s.title || s.slug,
        state,
        badge,
        score: typeof s.bestScore === "number" && s.bestScore > 0 ? s.bestScore : null,
        running: badge === "training"
      };
      if (state === "awaiting_approval" && !s.approvedAt) floor.sub = pick("chờ duyệt", "pending approval");
      return floor;
    });
}

export function canAddSkillFloor(count: number): boolean {
  return count < MAX_SKILL_FLOORS;
}

/** projectCount counts real projects only (the default ground floor is excluded). */
export function canAddFloor(projectCount: number): boolean {
  return projectCount < MAX_FLOORS;
}
