/** Pure visibility/lock rules of the two run actions: "Commit vào main" and "Phát hành". */
export interface RunActionInput {
  kind: string;
  status: string;
  merged?: boolean;
}

export interface RunActionState {
  showCommit: boolean;
  commitDisabled: boolean;
  showPublish: boolean;
  publishDisabled: boolean;
  /** Show the "commit to main first" hint next to the disabled publish button. */
  publishNeedsMerge: boolean;
}

export function runActionState(run: RunActionInput, worktreeExists = true): RunActionState {
  const eligible = run.kind === "coding" && run.status === "done";
  const merged = run.merged === true;
  return {
    showCommit: eligible && worktreeExists,
    commitDisabled: merged,
    showPublish: eligible,
    publishDisabled: !merged,
    publishNeedsMerge: eligible && !merged,
  };
}
