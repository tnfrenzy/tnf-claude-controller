/** Pure helpers for the idea quality UI (interview, critic issues, auto commands). No React, no I/O. */
import type { Dict } from "../i18n";
import type { CriticIssueKind, IdeaMeta, QueueCommand, SplitStatus } from "../types";

type T = Pick<Dict, `iq_${string}` & keyof Dict>;

/** Progress text of a running split job by stage; falls back to the plain "splitting" text. */
export function splitStageText(stage: SplitStatus["stage"], t: T, fallback: string): string {
  switch (stage) {
    case "interview": return t.iq_stage_interview;
    case "split": return t.iq_stage_split;
    case "critic": return t.iq_stage_critic;
    case "resplit": return t.iq_stage_resplit;
    default: return fallback;
  }
}

/** Badge of a command the controller appended, or of a read-only research command; null for a plain command. */
export function commandBadges(cmd: Pick<QueueCommand, "auto" | "kind">, t: T): string[] {
  const out: string[] = [];
  if (cmd.auto === "integrate") out.push(t.iq_auto_integrate);
  if (cmd.auto === "final-review") out.push(t.iq_auto_review);
  if (cmd.kind === "research") out.push(t.iq_kind_research);
  return out;
}

export function issueKindText(kind: CriticIssueKind, t: T): string {
  const map: Record<CriticIssueKind, string> = {
    gap: t.iq_issue_gap, dependency: t.iq_issue_dependency, too_big: t.iq_issue_too_big,
    file_conflict: t.iq_issue_file_conflict, no_verify: t.iq_issue_no_verify, contract: t.iq_issue_contract,
  };
  return map[kind] ?? kind;
}

/** One-line summary of the critic's pass over an idea, or null when there was no issue. */
export function criticSummary(meta: IdeaMeta | undefined, t: T): string | null {
  const n = meta?.criticIssues?.length ?? 0;
  if (n === 0) return null;
  const head = t.iq_critic_title.replace("{n}", String(n));
  return meta?.resplit ? `${head} · ${t.iq_critic_resplit}` : `${head} · ${t.iq_critic_kept}`;
}

/** True when there is something worth showing for an idea's meta box. */
export function hasIdeaMeta(meta: IdeaMeta | undefined): boolean {
  return !!meta && !!(meta.blueprint || meta.criticIssues?.length || meta.interview || meta.warnings?.length || meta.resplitError);
}
