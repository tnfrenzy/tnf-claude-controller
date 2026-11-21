import { redactSecrets } from "../release/redact.js";

/**
 * Webhook notifier. Gate decision: sending depends ONLY on `automation.webhooks` being non-empty
 * (it does not require `automation.enabled`, which is the autopilot switch). Never throws, never awaited on the main path.
 */
export interface WebhookOptions {
  urls: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  redactExtra?: string[];
}

export interface FinishedRun {
  id: string;
  status: "done" | "error";
  prompt: string;
  project?: string | null;
  duration_ms?: number | null;
  error?: string | null;
}

export interface QueueSummary {
  committed: string[];
  failed: string[];
  blocked: string[];
}

const TITLE_MAX = 80;

export class WebhookNotifier {
  private readonly urls: string[];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly extra: string[];
  private readonly sent = new Set<string>();
  failures = 0;

  constructor(opts: WebhookOptions) {
    this.urls = Array.isArray(opts.urls) ? [...opts.urls] : [];
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.fetchImpl = opts.fetchImpl;
    this.extra = opts.redactExtra ?? [];
  }

  private clean(s: string): string {
    return redactSecrets(s, this.extra);
  }

  /** Redact first, then truncate, so a secret cut in half at the boundary cannot slip through. */
  private title(prompt: string): string {
    const red = this.clean(String(prompt ?? "").replace(/\s+/g, " ").trim());
    return red.length > TITLE_MAX ? red.slice(0, TITLE_MAX) : red;
  }

  buildRunPayload(run: FinishedRun): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      event: run.status === "done" ? "run.done" : "run.error",
      run_id: this.clean(run.id),
      status: run.status,
      project: run.project ? this.clean(run.project) : null,
      title: this.title(run.prompt),
      duration_ms: typeof run.duration_ms === "number" ? run.duration_ms : null,
      at: new Date().toISOString(),
    };
    if (run.status === "error" && run.error) {
      const kind = run.error.split(":")[0]!.trim().slice(0, 40);
      if (/^[A-Za-z0-9_.-]+$/.test(kind)) payload["error_kind"] = kind;
    }
    return payload;
  }

  buildQueuePayload(project: string, s: QueueSummary): Record<string, unknown> {
    return {
      event: "queue.completed",
      project: this.clean(project),
      committed: s.committed.length,
      failed: s.failed.length,
      blocked: s.blocked.length,
      at: new Date().toISOString(),
    };
  }

  async runFinished(run: FinishedRun): Promise<void> {
    try {
      if (this.sent.has(run.id)) return;
      this.sent.add(run.id);
      await this.send(this.buildRunPayload(run));
    } catch {
      this.failures++;
    }
  }

  async queueCompleted(project: string, summary: QueueSummary): Promise<void> {
    try {
      await this.send(this.buildQueuePayload(project, summary));
    } catch {
      this.failures++;
    }
  }

  private validUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && u.username === "" && u.password === "";
    } catch {
      return false;
    }
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    if (this.urls.length === 0) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      this.urls.map(async (url) => {
        try {
          if (!this.validUrl(url)) return;
          const f = this.fetchImpl ?? globalThis.fetch;
          await f(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            redirect: "error",
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch {
          this.failures++;
        }
      }),
    );
  }
}
