// App-level automation processor: on each tick, when autopilot is enabled and its schedule is due,
// start "run all" for every project that has approved queue commands. Never approves commands itself.
import fs from "node:fs";
import path from "node:path";
import { isDue, type ScheduleSpec } from "./schedule-spec.js";

export const AUTOMATION_STATE_FILE = "automation-state.json";
export const AUTOMATION_DEFAULT_INTERVAL_MS = 60_000;

export interface AutomationDeps {
  now(): number;
  utcOffsetMinutes(nowMs: number): number;
  snapshot(): { enabled: boolean; scheduleSpec: ScheduleSpec | null };
  /** Names of projects that have a repo_path. */
  projects(): string[];
  hasApproved(project: string): boolean;
  isActive(project: string): boolean;
  startRunAll(project: string): Promise<unknown>;
  loadLastRunAt(): number | null;
  saveLastRunAt(ms: number): void;
  log?(msg: string): void;
}

/**
 * - off: autopilot disabled
 * - no_schedule: enabled but no schedule set
 * - seeded: first sight of a schedule without lastRunAt; lastRunAt = now, nothing started
 * - not_due: schedule not due yet
 * - ran: due; lastRunAt saved, eligible projects started
 * - busy: a previous tick is still running (overlapping tick skipped)
 */
export type AutomationTickStatus = "off" | "no_schedule" | "seeded" | "not_due" | "ran" | "busy";

export interface AutomationTickResult {
  status: AutomationTickStatus;
  started: string[];
  errors: { project: string; message: string }[];
}

export class AutomationProcessor {
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: AutomationDeps) {}

  async tick(): Promise<AutomationTickResult> {
    if (this.busy) return { status: "busy", started: [], errors: [] };
    this.busy = true;
    try {
      return await this.runTick();
    } finally {
      this.busy = false;
    }
  }

  private async runTick(): Promise<AutomationTickResult> {
    const d = this.deps;
    const snap = d.snapshot();
    if (!snap.enabled) return { status: "off", started: [], errors: [] };
    if (!snap.scheduleSpec) return { status: "no_schedule", started: [], errors: [] };
    const now = d.now();
    const last = d.loadLastRunAt();
    if (last === null) {
      d.saveLastRunAt(now);
      return { status: "seeded", started: [], errors: [] };
    }
    if (!isDue(snap.scheduleSpec, now, last, d.utcOffsetMinutes(now))) {
      return { status: "not_due", started: [], errors: [] };
    }
    // Save before starting so a crash mid-start never re-triggers the same slot.
    d.saveLastRunAt(now);
    const started: string[] = [];
    const errors: { project: string; message: string }[] = [];
    for (const p of d.projects()) {
      try {
        if (!d.hasApproved(p) || d.isActive(p)) continue;
        await d.startRunAll(p);
        started.push(p);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ project: p, message });
        d.log?.(`[automation] ${p}: ${message}`);
      }
    }
    return { status: "ran", started, errors };
  }

  start(intervalMs = AUTOMATION_DEFAULT_INTERVAL_MS): void {
    if (this.timer || !(intervalMs > 0)) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.deps.log?.(`[automation] tick: ${e instanceof Error ? e.message : String(e)}`));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

export function readLastRunAt(dataDir: string): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, AUTOMATION_STATE_FILE), "utf8")) as unknown;
    const v = raw && typeof raw === "object" ? (raw as { lastRunAt?: unknown }).lastRunAt : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeLastRunAt(dataDir: string, ms: number): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, AUTOMATION_STATE_FILE), JSON.stringify({ lastRunAt: ms }), "utf8");
}
