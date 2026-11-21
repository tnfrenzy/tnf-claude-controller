import fs from "node:fs";
import path from "node:path";
import type { RoleAccountMap } from "../shared-types.js";
import { readRoles, type RunManager } from "./run-manager.js";
import { prepareAgyRoleAgents, type AgyRoleDef } from "./providers/agy-agent-files.js";

export type CodingPhaseRole = "analyst" | "planner" | "critic" | "implementer" | "qa" | "debug";

export const DEFAULT_CODING_PHASES: readonly CodingPhaseRole[] = [
  "analyst",
  "planner",
  "critic",
  "implementer",
  "qa",
];

export interface PhasedCodingInput {
  prompt: string;
  project: string;
  /** Ordered phases to run; defaults to analyst -> planner -> critic -> implementer -> qa. */
  phases?: CodingPhaseRole[];
  /** Optional per-phase account/model overrides (falls back to saved roleAccounts, then project/global default). */
  phaseAccounts?: RoleAccountMap;
  /** Max debug->qa fix rounds when QA returns FAIL (default 1). */
  maxDebugRounds?: number;
}

export interface PhaseOutcome {
  phase: CodingPhaseRole;
  runId: string;
  provider: string;
  accountId: string | null;
  model: string | null;
  status: string;
  verdict: string | null;
  text: string;
  error: string | null;
}

export interface PhasedCodingResult {
  ok: boolean;
  project: string;
  rootRunId: string | null;
  worktreePath: string | null;
  branch: string | null;
  phases: PhaseOutcome[];
  error?: string;
}

function loadCodingRoleDefs(agentsFile: string): Record<string, AgyRoleDef> {
  const raw = readRoles(agentsFile);
  const out: Record<string, AgyRoleDef> = {};
  for (const [k, v] of Object.entries(raw)) {
    const prompt = typeof v["prompt"] === "string" ? v["prompt"] : "";
    const description = typeof v["description"] === "string" ? v["description"] : undefined;
    if (prompt) out[k] = { prompt, ...(description ? { description } : {}) };
  }
  return out;
}

function buildPhasePrompt(
  phase: CodingPhaseRole,
  taskPrompt: string,
  handoff: { analysis?: string; plan?: string; critic?: string; qa?: string },
): string {
  const sections: string[] = [`[PHA: ${phase.toUpperCase()}]`, `Yêu cầu gốc:\n${taskPrompt}`];
  if (handoff.analysis && (phase === "planner" || phase === "implementer")) {
    sections.push(`Phân tích hiện trạng (từ analyst):\n${handoff.analysis.slice(0, 8000)}`);
  }
  if (handoff.plan && (phase === "critic" || phase === "implementer" || phase === "qa" || phase === "debug")) {
    sections.push(`Kế hoạch triển khai (từ planner):\n${handoff.plan.slice(0, 8000)}`);
  }
  if (handoff.critic && phase === "planner") {
    sections.push(`Phản biện cần xử lý (từ critic):\n${handoff.critic.slice(0, 4000)}`);
  }
  if (handoff.qa && phase === "debug") {
    sections.push(`Báo cáo lỗi cần sửa (từ qa):\n${handoff.qa.slice(0, 6000)}`);
  }
  return sections.join("\n\n---\n\n");
}

/**
 * Level D: Controller-orchestrated multi-phase coding pipeline.
 * Runs each phase sequentially on the SAME git worktree while allowing each phase
 * to use a different CLI account/provider (e.g., Claude for implementer, Antigravity for critic/qa).
 * Models are automatically distributed per provider when not explicitly pinned.
 */
export async function runPhasedCoding(
  manager: RunManager,
  input: PhasedCodingInput,
): Promise<PhasedCodingResult> {
  const phases = input.phases?.length ? [...input.phases] : [...DEFAULT_CODING_PHASES];
  const roleDefs = loadCodingRoleDefs(manager.config.defaults.coding.agentsFile);
  const maxDebugRounds = Math.max(0, Math.min(3, input.maxDebugRounds ?? 1));

  const outcomes: PhaseOutcome[] = [];
  const handoff: { analysis?: string; plan?: string; critic?: string; qa?: string } = {};
  let rootRunId: string | null = null;
  let lastCodingRunId: string | null = null;
  let worktreePath: string | null = null;
  let branch: string | null = null;

  const execPhase = async (phase: CodingPhaseRole): Promise<PhaseOutcome> => {
    const saved = manager.resolveRoleAssignment(phase);
    const override = input.phaseAccounts?.[phase];
    const accountId = override?.accountId ?? saved.accountId ?? null;
    const explicitModel = override?.model ?? saved.model ?? undefined;

    const acc = manager.cliAccounts.resolveAccount({
      requestedId: accountId,
      projectAccountId: manager.store.getProject(input.project)?.account_id ?? null,
      isCoolingDown: (id) => manager.isAccountCoolingDown(id),
    });

    const phasePrompt = buildPhasePrompt(phase, input.prompt, handoff);
    let tempAgents: ReturnType<typeof prepareAgyRoleAgents> | null = null;

    // If this phase runs on Antigravity inside an existing worktree, materialize `.agents/agents/<phase>/agent.md`.
    if (acc.provider === "antigravity" && worktreePath && roleDefs[phase]) {
      tempAgents = prepareAgyRoleAgents(worktreePath, { [phase]: roleDefs[phase]! });
    }

    try {
      const started = await manager.startRun({
        prompt: phasePrompt,
        project: input.project,
        roles: false,
        accountId: acc.id,
        ...(explicitModel ? { model: explicitModel } : {}),
        ...(lastCodingRunId ? { reuseWorktreeOf: lastCodingRunId } : {}),
        ...(rootRunId ? { threadWith: rootRunId } : {}),
        ...(tempAgents ? { agentName: phase } : {}),
      });
      if (!rootRunId) rootRunId = started.id;
      lastCodingRunId = started.id;
      if (started.worktree_path) worktreePath = started.worktree_path;
      if (started.branch) branch = started.branch;

      const done = await manager.waitFor(started.id);
      const text = done?.result_text ?? "";
      const verdict = done?.verdicts?.[done.verdicts.length - 1]?.verdict ?? null;

      // Save phase handoff notes in the root run_dir/notes/
      if (done?.run_dir && text) {
        try {
          const notesDir = path.join(done.run_dir, "notes");
          fs.mkdirSync(notesDir, { recursive: true });
          if (phase === "analyst") {
            handoff.analysis = text;
            fs.writeFileSync(path.join(notesDir, "analysis.md"), text, "utf8");
          } else if (phase === "planner") {
            handoff.plan = text;
            fs.writeFileSync(path.join(notesDir, "plan.md"), text, "utf8");
          } else if (phase === "critic") {
            handoff.critic = text;
          } else if (phase === "qa") {
            handoff.qa = text;
          }
        } catch {
          /* best effort */
        }
      }

      const out: PhaseOutcome = {
        phase,
        runId: started.id,
        provider: done?.provider ?? acc.provider,
        accountId: done?.account_id ?? acc.id,
        model: done?.model ?? null,
        status: done?.status ?? "error",
        verdict,
        text,
        error: done?.error ?? null,
      };
      outcomes.push(out);
      return out;
    } finally {
      tempAgents?.cleanup();
    }
  };

  try {
    let debugRounds = 0;
    for (const phase of phases) {
      const res = await execPhase(phase);
      if (res.status !== "done") {
        return { ok: false, project: input.project, rootRunId, worktreePath, branch, phases: outcomes, error: res.error ?? `Pha ${phase} thất bại.` };
      }
      if (phase === "critic" && res.verdict === "BLOCKED") {
        return { ok: false, project: input.project, rootRunId, worktreePath, branch, phases: outcomes, error: "Critic trả về VERDICT: BLOCKED." };
      }
      if (phase === "qa" && res.verdict === "FAIL") {
        while (debugRounds < maxDebugRounds) {
          debugRounds++;
          const dbg = await execPhase("debug");
          if (dbg.status !== "done") {
            return { ok: false, project: input.project, rootRunId, worktreePath, branch, phases: outcomes, error: dbg.error ?? "Pha debug thất bại." };
          }
          const qaRetry = await execPhase("qa");
          if (qaRetry.status !== "done") {
            return { ok: false, project: input.project, rootRunId, worktreePath, branch, phases: outcomes, error: qaRetry.error ?? "Pha qa kiểm lại thất bại." };
          }
          if (qaRetry.verdict !== "FAIL") break;
        }
      }
    }
    return { ok: true, project: input.project, rootRunId, worktreePath, branch, phases: outcomes };
  } catch (e) {
    return {
      ok: false,
      project: input.project,
      rootRunId,
      worktreePath,
      branch,
      phases: outcomes,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
