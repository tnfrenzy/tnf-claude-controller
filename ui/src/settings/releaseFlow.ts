/** Pure helpers for the configurable release flow (dry-run preview, then two confirmations, then run). */
export type ReleasePhase = "idle" | "dryrun" | "confirm1" | "confirm2" | "running";
export type ReleaseAction = "start" | "preview_ok" | "confirm" | "cancel" | "finish";

export function nextReleasePhase(phase: ReleasePhase, action: ReleaseAction): ReleasePhase {
  if (action === "cancel" || action === "finish") return "idle";
  if (action === "start") return phase === "idle" ? "dryrun" : phase;
  if (action === "preview_ok") return phase === "dryrun" ? "confirm1" : phase;
  if (action === "confirm") {
    if (phase === "confirm1") return "confirm2";
    if (phase === "confirm2") return "running";
  }
  return phase;
}

export interface ReleasePlanCommand {
  stepIndex: number;
  type: string;
  description: string;
  argv: string[];
  cwd: string;
}

export interface ReleaseTargetsInfo {
  remote?: string;
  deploy?: string;
  url?: string;
}

/** One display line for a command: arguments with whitespace are quoted. */
export function formatCommandLine(argv: string[]): string {
  return argv.map((a) => (/[\s"]/.test(a) || a === "" ? JSON.stringify(a) : a)).join(" ");
}

/** Destination lines; keys are i18n key suffixes (remote, deploy, url). */
export function formatTargets(targets: ReleaseTargetsInfo | undefined): Array<{ key: "remote" | "deploy" | "url"; value: string }> {
  const out: Array<{ key: "remote" | "deploy" | "url"; value: string }> = [];
  if (!targets) return out;
  if (targets.remote) out.push({ key: "remote", value: targets.remote });
  if (targets.deploy) out.push({ key: "deploy", value: targets.deploy });
  if (targets.url) out.push({ key: "url", value: targets.url });
  return out;
}

export const RELEASE_I18N_KEYS = [
  "rel_btn", "rel_previewing", "rel_preview_title", "rel_targets", "rel_target_remote", "rel_target_deploy", "rel_target_url",
  "rel_confirm1", "rel_confirm2", "rel_yes1", "rel_yes2", "rel_cancel", "rel_running", "rel_done", "rel_failed",
  "rel_no_config", "rel_use_template", "rel_bump_only", "rel_artifact_title", "rel_artifact_path", "rel_artifact_size", "rel_artifact_sha", "rel_copy", "rel_steps", "rel_step_ok", "rel_step_failed", "rel_step_skipped", "rel_step_running", "rel_keep_open", "rel_precond_failed", "rel_long_note",
] as const;

export const RELCFG_I18N_KEYS = [
  "relcfg_title", "relcfg_template", "relcfg_step_bump", "relcfg_step_build", "relcfg_step_tag", "relcfg_step_git_push",
  "relcfg_step_project_script", "relcfg_step_healthcheck", "relcfg_remote", "relcfg_branch", "relcfg_target", "relcfg_key_path",
  "relcfg_key_env", "relcfg_script_path", "relcfg_url", "relcfg_dry_run", "relcfg_run_real", "relcfg_confirm_push",
  "relcfg_cancel_warning", "relcfg_cancel_ack", "relcfg_cancel", "relcfg_progress", "relcfg_log", "relcfg_tunnel_disabled",
  "relcfg_save", "relcfg_err_required", "relcfg_err_remote", "relcfg_err_ref", "relcfg_err_script_path", "relcfg_err_script_ext",
  "relcfg_err_target", "relcfg_err_key_path", "relcfg_err_env_name", "relcfg_err_url",
] as const;

/** Human size of a file: "24,6 MB", "512 KB", "900 B". */
export function formatSize(bytes: number): string {
  if (!(bytes >= 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** First 12 hex characters of a sha256 (enough to compare by eye; the full value stays in the release log). */
export function shortHash(sha: string): string {
  return sha.slice(0, 12);
}

/** "2 ph 05 s" since the running step started (the step's own startedAt is not in the view type, so use the log start). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} ph ${String(s % 60).padStart(2, "0")} s`;
}

export function releaseElapsed(log: { steps: Array<{ index: number; startedAt?: string | null }> }, stepIndex: number, now: number = Date.now()): string {
  const st = log.steps.find((x) => x.index === stepIndex);
  const t = st?.startedAt ? Date.parse(st.startedAt) : NaN;
  return Number.isFinite(t) ? formatElapsed(now - t) : "";
}
