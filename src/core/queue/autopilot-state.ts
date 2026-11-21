// In-memory autopilot state: enabled flag, schedule and webhook list. Pure: no timers, never starts runs.
import { validateWebhookUrls, type ControllerConfig } from "../app/config.js";
import { parseSchedule, type ScheduleSpec } from "./schedule-spec.js";

export const AUTOPILOT_SCHEDULE_MAX_LEN = 120;

export interface AutopilotSnapshot {
  enabled: boolean;
  schedule: string | null;
  scheduleSpec: ScheduleSpec | null;
  webhooks: string[];
  updatedAt: string;
}

type Now = () => number;

export class AutopilotState {
  private enabled: boolean;
  private schedule: string | null = null;
  private spec: ScheduleSpec | null = null;
  private webhooks: string[];
  private updatedAtMs: number;

  constructor(automation?: ControllerConfig["automation"] | null, private readonly now: Now = Date.now) {
    this.enabled = automation?.enabled === true;
    this.webhooks = [...(automation?.webhooks ?? [])];
    this.updatedAtMs = this.now();
    const sc = automation?.schedule;
    if (typeof sc === "string" && sc.trim() !== "" && sc.length <= AUTOPILOT_SCHEDULE_MAX_LEN) {
      // A 5-field cron from config does not parse as a schedule-spec: leave the schedule unset, never throw.
      const r = parseSchedule(sc);
      if (r.ok) {
        this.schedule = normalize(sc);
        this.spec = r.spec;
      }
    }
  }

  snapshot(): AutopilotSnapshot {
    return {
      enabled: this.enabled,
      schedule: this.schedule,
      scheduleSpec: this.spec ? structuredClone(this.spec) : null,
      webhooks: [...this.webhooks],
      updatedAt: new Date(this.updatedAtMs).toISOString(),
    };
  }

  enable(): void {
    if (!this.enabled) this.touch();
    this.enabled = true;
  }

  disable(): void {
    if (this.enabled) this.touch();
    this.enabled = false;
  }

  /** null or an empty string clears the schedule; otherwise throws on length or syntax errors. */
  setSchedule(input: string | null): void {
    if (input === null || (typeof input === "string" && input.trim() === "")) {
      this.schedule = null;
      this.spec = null;
      this.touch();
      return;
    }
    if (typeof input !== "string") throw new Error("Lịch phải là một chuỗi văn bản hoặc null.");
    if (input.length > AUTOPILOT_SCHEDULE_MAX_LEN) {
      throw new Error(`Lịch tối đa ${AUTOPILOT_SCHEDULE_MAX_LEN} ký tự.`);
    }
    const r = parseSchedule(input);
    if (!r.ok) throw new Error(r.error);
    this.schedule = normalize(input);
    this.spec = r.spec;
    this.touch();
  }

  setWebhooks(urls: unknown): void {
    this.webhooks = validateWebhookUrls(urls);
    this.touch();
  }

  private touch(): void {
    this.updatedAtMs = this.now();
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
