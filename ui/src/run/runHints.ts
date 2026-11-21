/** Pure mapping from a failed run's technical error to Vietnamese troubleshooting i18n keys. */

export type HintAction = "rerun" | "resume" | "raise_budget" | "open_diff" | "contact_support";

export interface RunHint {
  titleKey: string;
  bodyKey: string;
  actions: HintAction[];
  /** Original error string, untouched. */
  technical: string;
}

export interface RunHintInput {
  status: string;
  error: string | null;
}

/** Every i18n key getRunHint can return (titles and bodies). */
export const HINT_KEYS: string[] = [
  "hint.maxTurns.title", "hint.maxTurns.body",
  "hint.maxBudget.title", "hint.maxBudget.body",
  "hint.resultError.title", "hint.resultError.body",
  "hint.interrupted.title", "hint.interrupted.body",
  "hint.billing.title", "hint.billing.body",
  "hint.repoChanged.title", "hint.repoChanged.body",
  "hint.generic.title", "hint.generic.body",
];

const REPO_CHANGED = "repo gốc thay đổi";
const BILLING_MARKERS = ["Cờ --bare", "Chưa đăng nhập Claude Code", "tính phí API", "claude auth status", "Không chạy được claude"];

function make(prefix: string, actions: HintAction[], technical: string): RunHint {
  return { titleKey: `hint.${prefix}.title`, bodyKey: `hint.${prefix}.body`, actions, technical };
}

/** null when the run did not fail (status !== "error"). */
export function getRunHint(run: RunHintInput): RunHint | null {
  if (run.status !== "error") return null;
  const err = run.error ?? "";
  const hasRepoWarn = err.includes(REPO_CHANGED);
  const extra = (a: HintAction[]): HintAction[] => (hasRepoWarn ? [...a, "contact_support"] : a);
  if (err.startsWith("max_turns")) return make("maxTurns", extra(["resume"]), err);
  if (err.startsWith("max_budget")) return make("maxBudget", extra(["raise_budget", "resume"]), err);
  if (err.startsWith("result_error")) return make("resultError", extra(["rerun"]), err);
  if (err.startsWith("subagent_interrupted")) return make("interrupted", extra(["resume"]), err);
  if (BILLING_MARKERS.some((m) => err.includes(m))) return make("billing", ["contact_support"], err);
  if (hasRepoWarn) return make("repoChanged", ["contact_support", "rerun"], err);
  return make("generic", ["rerun", "contact_support"], err);
}
